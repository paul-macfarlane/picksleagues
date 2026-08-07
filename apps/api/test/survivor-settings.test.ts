import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueSeasons, survivorPicks } from "@picksleagues/db";
import {
  MEMBER_ROLE,
  PICK_TYPE,
  SURVIVOR_PUSH_TIE_RESOLUTION,
  type SurvivorSettings,
  type SurvivorSettingsInput,
} from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import {
  DEFAULT_SURVIVOR_SETTINGS,
  insertLeague,
  membersOf,
  seedSeason,
  type SeededWeek,
} from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF, withCookie } from "./setup/league-app";
import { insertSurvivorPick, seedSurvivorLeague } from "./setup/survivor-league";
import { resetDb } from "./setup/reset-db";

/**
 * The Survivor half of ADR-0015 decision 3: a pre-start settings change that
 * would strand picks clears them inside the settings transaction, and is
 * refused once any pick has locked. Pick'em's own reset behaviour is pinned by
 * `pickem-picks.test.ts` and is deliberately not restated here — those tests
 * passing unchanged is what proves this delivery left it alone.
 */

const { db, auth, app, appAfterKickoff, getSurvivorPickSummary, putSurvivorPick } =
  makeLeagueTestHarness();

type App = typeof app;

const WEEK2_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000);

/** Two regular weeks, both entirely ahead of the harness's pre-start clock. */
const TWO_WEEK_SLATE: SeededWeek[] = [
  { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
  { weekNumber: 2, kickoffs: [{ kickoffAt: WEEK2_KICKOFF }] },
];

function patchLeague(
  cookie: string | undefined,
  leagueId: string,
  body: Record<string, unknown>,
  on: App = app,
) {
  return on.request(`/api/leagues/${leagueId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify(body),
  });
}

function settingsWith(overrides: Partial<SurvivorSettingsInput> = {}): SurvivorSettingsInput {
  return {
    pickType: DEFAULT_SURVIVOR_SETTINGS.pickType,
    pushTieResolution: DEFAULT_SURVIVOR_SETTINGS.pushTieResolution,
    ...overrides,
  };
}

/** Total Survivor pick rows on a league's current season instance. */
async function pickCountFor(leagueId: string): Promise<number> {
  const [season] = await db
    .select()
    .from(leagueSeasons)
    .where(eq(leagueSeasons.leagueId, leagueId));
  if (!season) return 0;
  const rows = await db
    .select()
    .from(survivorPicks)
    .where(eq(survivorPicks.leagueSeasonId, season.id));
  return rows.length;
}

async function storedSettingsFor(leagueId: string): Promise<SurvivorSettings> {
  const [season] = await db
    .select()
    .from(leagueSeasons)
    .where(eq(leagueSeasons.leagueId, leagueId));
  return season!.settings as SurvivorSettings;
}

/** Two members, each holding one pick in week 1 — both legal under the seeded straight-up settings. */
async function seedLeagueWithPicks() {
  const seeded = await seedSurvivorLeague(db, auth, {
    weeks: TWO_WEEK_SLATE,
    members: [{ username: "member_a" }, { username: "member_b" }],
  });
  const [memberA, memberB] = seeded.users as [
    (typeof seeded.users)[number],
    (typeof seeded.users)[number],
  ];
  const week1 = seeded.weekIds.get("regular:1")!;
  const [week1Game] = seeded.gameIds.get("regular:1") as [string];

  for (const [member, teamId] of [
    [memberA, seeded.teamIds.home],
    [memberB, seeded.teamIds.away],
  ] as const) {
    const res = await putSurvivorPick(member.cookie, seeded.league.id, week1, {
      gameId: week1Game,
      teamId,
      spread: null,
    });
    expect(res.status).toBe(200);
  }

  return { ...seeded, memberA, memberB };
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("PATCH /api/leagues/:leagueId — Survivor settings reset picks", () => {
  it("clears every pick on the instance when Pick Type changes, and commits the settings write with it", async () => {
    const { league, memberA } = await seedLeagueWithPicks();
    expect(await pickCountFor(league.id)).toBe(2);

    const res = await patchLeague(memberA.cookie, league.id, {
      settings: settingsWith({ pickType: PICK_TYPE.AGAINST_THE_SPREAD }),
    });

    expect(res.status).toBe(200);
    expect(await pickCountFor(league.id)).toBe(0);
    expect((await storedSettingsFor(league.id)).pickType).toBe(PICK_TYPE.AGAINST_THE_SPREAD);
  });

  it("clears nothing when only Push/Tie Resolution changes — settlement reads it at grading time", async () => {
    const { league, memberA } = await seedLeagueWithPicks();

    const res = await patchLeague(memberA.cookie, league.id, {
      settings: settingsWith({ pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE }),
    });

    expect(res.status).toBe(200);
    expect(await pickCountFor(league.id)).toBe(2);
    const stored = await storedSettingsFor(league.id);
    expect(stored.pushTieResolution).toBe(SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE);
    expect(stored.pickType).toBe(PICK_TYPE.STRAIGHT_UP);
  });

  it("409s picks_locked — and leaves both the pick and the settings untouched — when a locked pick would be stranded", async () => {
    // The league's start week (week 1) holds no games, so `leagueStartAt` is
    // null and `isPreStart` reports true regardless of the clock — the
    // commissioner keeps pre-start powers even though a later week's game has
    // already kicked off and locked a pick (ADR-0015: trusting the pre-start
    // boundary here would let a settings edit delete picks already locked and
    // revealed to the league).
    const seeded = await seedSurvivorLeague(db, auth, {
      weeks: [
        { weekNumber: 1, kickoffs: [] },
        { weekNumber: 2, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
      ],
      members: [{ username: "member_a" }],
    });
    const memberA = seeded.users[0]!;
    const [week2Game] = seeded.gameIds.get("regular:2") as [string];
    // Inserted directly: the pick endpoint would refuse a game that has already
    // kicked off, which is precisely the state this test needs to arrange.
    await insertSurvivorPick(db, {
      leagueSeasonId: seeded.leagueSeasonId,
      leagueMemberId: seeded.members.get(memberA.user.id)!,
      weekId: seeded.weekIds.get("regular:2")!,
      gameId: week2Game,
      teamId: seeded.teamIds.home,
    });

    const res = await patchLeague(
      memberA.cookie,
      seeded.league.id,
      { settings: settingsWith({ pickType: PICK_TYPE.AGAINST_THE_SPREAD }) },
      appAfterKickoff,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "picks_locked" });
    // The reset and the settings write share one transaction: a refusal must
    // roll the whole thing back, not merely skip the clear.
    expect(await pickCountFor(seeded.league.id)).toBe(1);
    expect((await storedSettingsFor(seeded.league.id)).pickType).toBe(PICK_TYPE.STRAIGHT_UP);
  });
});

describe("GET /api/leagues/:leagueId/survivor/pick-summary", () => {
  it("401s without a session", async () => {
    const { league } = await seedLeagueWithPicks();

    const res = await getSurvivorPickSummary(undefined, league.id);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("404s a non-member and an unknown league — private leagues stay hidden either way", async () => {
    const { league, memberA } = await seedLeagueWithPicks();
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });

    const nonMember = await getSurvivorPickSummary(outsider.cookie, league.id);
    expect(nonMember.status).toBe(404);
    expect(await nonMember.json()).toMatchObject({ error: "league_not_found" });

    const unknownLeague = await getSurvivorPickSummary(memberA.cookie, randomUUID());
    expect(unknownLeague.status).toBe(404);
    expect(await unknownLeague.json()).toMatchObject({ error: "league_not_found" });
  });

  it("403s not_commissioner for an ordinary member — the count would leak how many picks others have in", async () => {
    const { league, memberB } = await seedLeagueWithPicks();

    const res = await getSurvivorPickSummary(memberB.cookie, league.id);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_commissioner" });
  });

  it("400s wrong_league_mode for a Pick'em league", async () => {
    const { seasonId } = await seedSeason(db, { weeks: TWO_WEEK_SLATE });
    const commissioner = await createAuthenticatedUser(auth, { username: "commish" });
    const league = await insertLeague(db, {
      seasonId,
      members: [{ userId: commissioner.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await getSurvivorPickSummary(commissioner.cookie, league.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "wrong_league_mode" });
  });

  it("counts exactly what a settings reset would delete — released rows included, non-pickers excluded", async () => {
    const seeded = await seedSurvivorLeague(db, auth, {
      weeks: TWO_WEEK_SLATE,
      members: [{ username: "member_a" }, { username: "member_b" }, { username: "member_c" }],
    });
    const memberA = seeded.users[0]!;
    const memberB = seeded.users[1]!;
    const membersByUser = await membersOf(db, seeded.league.id);
    const [week1Game] = seeded.gameIds.get("regular:1") as [string];
    const [week2Game] = seeded.gameIds.get("regular:2") as [string];

    // memberA holds two rows, one of them released by a cancellation —
    // `resetPicksInvalidatedBySettings` deletes every row on the instance, so a
    // summary that filtered `released` would under-report the damage. memberC
    // never picks, which is what separates memberCount from roster size.
    await insertSurvivorPick(db, {
      leagueSeasonId: seeded.leagueSeasonId,
      leagueMemberId: membersByUser.get(memberA.user.id)!,
      weekId: seeded.weekIds.get("regular:1")!,
      gameId: week1Game,
      teamId: seeded.teamIds.home,
      released: true,
    });
    await insertSurvivorPick(db, {
      leagueSeasonId: seeded.leagueSeasonId,
      leagueMemberId: membersByUser.get(memberA.user.id)!,
      weekId: seeded.weekIds.get("regular:2")!,
      gameId: week2Game,
      teamId: seeded.teamIds.away,
    });
    await insertSurvivorPick(db, {
      leagueSeasonId: seeded.leagueSeasonId,
      leagueMemberId: membersByUser.get(memberB.user.id)!,
      weekId: seeded.weekIds.get("regular:1")!,
      gameId: week1Game,
      teamId: seeded.teamIds.away,
    });

    const res = await getSurvivorPickSummary(memberA.cookie, seeded.league.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pickCount: 3, memberCount: 2 });
    expect(await pickCountFor(seeded.league.id)).toBe(3);
  });

  it("reads 0/0 for a league with no picks yet", async () => {
    const seeded = await seedSurvivorLeague(db, auth, {
      weeks: TWO_WEEK_SLATE,
      members: [{ username: "member_a" }],
    });

    const res = await getSurvivorPickSummary(seeded.users[0]!.cookie, seeded.league.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pickCount: 0, memberCount: 0 });
  });
});
