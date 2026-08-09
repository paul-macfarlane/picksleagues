import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueSeasons, survivorPicks } from "@picksleagues/db";
import {
  SURVIVOR_PUSH_TIE_RESOLUTION,
  type SurvivorSettings,
  type SurvivorSettingsInput,
} from "@picksleagues/schemas";
import { DEFAULT_SURVIVOR_SETTINGS, type SeededWeek } from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF, withCookie } from "./setup/league-app";
import { insertSurvivorPick, seedSurvivorLeague } from "./setup/survivor-league";
import { resetDb } from "./setup/reset-db";

/**
 * The Survivor half of ADR-0015 decision 3: a pre-start settings change that
 * would strand picks clears them inside the settings transaction, and is
 * refused once any pick has locked. Pick'em's own reset behaviour is pinned by
 * `pickem-picks.test.ts` and is deliberately not restated here — those tests
 * passing unchanged is what proves this delivery left it alone.
 *
 * The one edit that strands a Survivor pick is an advanced start week, and
 * since ADR-0026 removed Pick Type it is the only one: nothing on the wire
 * expresses it, because the server re-resolves the range against its own clock
 * on every pre-start settings write (ADR-0024). Which is why the fixtures below
 * are shaped around a *clock*, not around a field.
 */

const { db, auth, app, appAfterKickoff, putSurvivorPick } = makeLeagueTestHarness();

type App = typeof app;

const WEEK2_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000);
const WEEK3_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 14 * 24 * 60 * 60 * 1000);

/** Two regular weeks, both entirely ahead of the harness's pre-start clock. */
const TWO_WEEK_SLATE: SeededWeek[] = [
  { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
  { weekNumber: 2, kickoffs: [{ kickoffAt: WEEK2_KICKOFF }] },
];

/**
 * The slate that makes a re-resolution move the start week. Week 1 holds no
 * games, so `leagueStartAt` is null and `isPreStart` reports true whatever the
 * clock says — the league keeps its pre-start powers (the "a league re-enters
 * pre-start mid-season" state ADR-0015 names). Under the post-kickoff app,
 * week 1 is behind its own `ends_at` and week 2 has kicked off, so resolution
 * advances the stored start from week 1 to week 3, and every pick on the
 * instance is stranded.
 */
const RESOLUTION_ADVANCES_SLATE: SeededWeek[] = [
  { weekNumber: 1, kickoffs: [] },
  { weekNumber: 2, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
  { weekNumber: 3, kickoffs: [{ kickoffAt: WEEK3_KICKOFF }] },
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
  it("clears every pick on the instance when re-resolution advances the start week, and commits the settings write with it", async () => {
    const seeded = await seedSurvivorLeague(db, auth, {
      weeks: RESOLUTION_ADVANCES_SLATE,
      members: [{ username: "member_a" }],
    });
    const memberA = seeded.users[0]!;
    const [week3Game] = seeded.gameIds.get("regular:3") as [string];
    // Week 3 is inside the stored range and still ahead of both clocks, so this
    // is a pick the member made legally and has not locked — the state the
    // reset exists for, as against the refusal the next case pins.
    const picked = await putSurvivorPick(
      memberA.cookie,
      seeded.league.id,
      seeded.weekIds.get("regular:3")!,
      { gameId: week3Game, teamId: seeded.teamIds.home },
      appAfterKickoff,
    );
    expect(picked.status).toBe(200);
    expect(await pickCountFor(seeded.league.id)).toBe(1);

    const res = await patchLeague(
      memberA.cookie,
      seeded.league.id,
      { settings: settingsWith({ pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE }) },
      appAfterKickoff,
    );

    expect(res.status).toBe(200);
    expect(await pickCountFor(seeded.league.id)).toBe(0);
    const stored = await storedSettingsFor(seeded.league.id);
    expect(stored.startWeek).toEqual({ type: "regular", number: 3 });
    expect(stored.pushTieResolution).toBe(SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE);
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
    expect(stored.startWeek).toEqual({ type: "regular", number: 1 });
  });

  it("409s picks_locked — and leaves both the pick and the settings untouched — when a locked pick would be stranded", async () => {
    // Same slate as the clearing case, so the same re-resolution advances the
    // start week — but the pick sits in week 2, which has already kicked off.
    // ADR-0015: trusting the pre-start boundary here would let a settings edit
    // delete picks already locked and revealed to the league.
    const seeded = await seedSurvivorLeague(db, auth, {
      weeks: RESOLUTION_ADVANCES_SLATE,
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
      { settings: settingsWith({ pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE }) },
      appAfterKickoff,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "picks_locked" });
    // The reset and the settings write share one transaction: a refusal must
    // roll the whole thing back, not merely skip the clear.
    expect(await pickCountFor(seeded.league.id)).toBe(1);
    const stored = await storedSettingsFor(seeded.league.id);
    expect(stored.startWeek).toEqual({ type: "regular", number: 1 });
    expect(stored.pushTieResolution).toBe(SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE);
  });
});
