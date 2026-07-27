import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { games, leagueSeasons, pickemPicks } from "@picksleagues/db";
import {
  ELIMINATION_PUSH_TIE_RESOLUTION,
  GAME_STATUS,
  LEAGUE_MODE,
  LEAGUE_STATUS,
  MARCH_MADNESS_SCORING_MODEL,
  MEMBER_ROLE,
  PICK_SIDE,
  PICK_TYPE,
  PICKEM_PUSH_TIE_RESOLUTION,
  WEEK_TYPE,
  type PickemSettings,
  type PickemWeekPicksResponse,
  type WeekSlateResponse,
} from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import {
  DEFAULT_PICKEM_SETTINGS,
  FOUR_GAME_WEEK,
  insertLeague,
  seedSeason,
  type SeededWeek,
} from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF, withCookie } from "./setup/league-app";
import { seedPickemLeague as seedPickemLeagueBase } from "./setup/pickem-league";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff, appAtKickoff, getSlate, getPicks, putPicks } =
  makeLeagueTestHarness();

type App = typeof app;

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

/** Total pick rows stored for a league's current season instance. */
async function pickCountFor(leagueId: string): Promise<number> {
  const [season] = await db
    .select()
    .from(leagueSeasons)
    .where(eq(leagueSeasons.leagueId, leagueId));
  if (!season) return 0;
  const rows = await db.select().from(pickemPicks).where(eq(pickemPicks.leagueSeasonId, season.id));
  return rows.length;
}

/** Three games, spread one hour apart, none seeded with a spread by default. */
const THREE_GAME_WEEK: SeededWeek[] = [
  {
    weekNumber: 1,
    kickoffs: [
      { kickoffAt: WEEK1_KICKOFF },
      { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 60 * 1000) },
      { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 2 * 60 * 60 * 1000) },
    ],
  },
];

/**
 * Shared arrange step for the picks read/write suites: a season + week with
 * a 3-game slate and a 2-member Pick'em league. Individual tests override
 * `settings`/`weeks` for the cases that need a different slate or cap.
 */
async function seedPickemLeague(
  opts: {
    settings?: PickemSettings;
    weeks?: SeededWeek[];
    status?: (typeof LEAGUE_STATUS)[keyof typeof LEAGUE_STATUS];
  } = {},
) {
  const { settings, weeks = THREE_GAME_WEEK, status } = opts;
  const base = await seedPickemLeagueBase(db, auth, {
    weeks,
    settings,
    status,
    members: [{ username: "member_a" }, { username: "member_b" }],
  });
  const [memberA, memberB] = base.users;
  return {
    seasonId: base.seasonId,
    weekIds: base.weekIds,
    gameIds: base.gameIds,
    league: base.league,
    memberA: memberA!,
    memberB: memberB!,
  };
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("GET /api/weeks/:weekId/games", () => {
  it("401s without a session", async () => {
    const { weekIds } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const res = await getSlate(undefined, weekId);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("404s an unknown week id", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const res = await getSlate(cookie, randomUUID());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "week_not_found" });
  });

  it("orders games by effective kickoff and locks true at/after kickoff (half-open boundary)", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const { weekIds, gameIds } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")! as [string, string, string];

    // Before any kickoff: declared order preserved, nothing locked.
    const before = await getSlate(cookie, weekId);
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as WeekSlateResponse;
    expect(beforeBody.games.map((g) => g.id)).toEqual([g1, g2, g3]);
    expect(beforeBody.games.map((g) => g.locked)).toEqual([false, false, false]);

    // At the exact kickoff instant of game 1: locked = kickoff <= now, so the
    // boundary itself is locked; the later two are not.
    const at = await getSlate(cookie, weekId, appAtKickoff);
    expect(at.status).toBe(200);
    const atBody = (await at.json()) as WeekSlateResponse;
    const byId = new Map(atBody.games.map((g) => [g.id, g]));
    expect(byId.get(g1)?.locked).toBe(true);
    expect(byId.get(g2)?.locked).toBe(false);
    expect(byId.get(g3)?.locked).toBe(false);
  });

  it("overrideKickoffAt wins over kickoffAt for both ordering and locked (arch D15)", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    // Game A's raw kickoff is latest, but its override moves it before
    // Game B's raw (and only) kickoff — both ordering and lock state must
    // follow the override, not the provider value.
    const { weekIds } = await seedSeason(db, {
      year: 2026,
      weeks: [
        {
          weekNumber: 1,
          kickoffs: [
            {
              kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 6 * 60 * 60 * 1000),
              overrideKickoffAt: new Date(WEEK1_KICKOFF.getTime() - 60 * 60 * 1000),
            },
            { kickoffAt: WEEK1_KICKOFF },
          ],
        },
      ],
    });
    const weekId = weekIds.get("regular:1")!;

    // At the raw-kickoff-B instant: the override-earlier game (A) must already
    // be locked (its effective kickoff is an hour before now), while B — whose
    // raw kickoff is exactly now — is also locked, but ordering must place A
    // first despite its later raw kickoff.
    const res = await getSlate(cookie, weekId, appAtKickoff);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WeekSlateResponse;
    expect(body.games).toHaveLength(2);
    expect(body.games[0]?.locked).toBe(true); // the overridden-earlier game sorts first
    expect(body.games[1]?.locked).toBe(true); // B locks at its own raw-kickoff boundary
    // A's effective kickoff (used for ordering) is strictly before B's.
    expect(new Date(body.games[0]!.kickoffAt).getTime()).toBeLessThan(
      new Date(body.games[1]!.kickoffAt).getTime(),
    );
  });

  it("reflects the seeded odds snapshot's spread, and null when none was seeded", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const { weekIds, gameIds } = await seedSeason(db, {
      year: 2026,
      weeks: [
        {
          weekNumber: 1,
          kickoffs: [
            { kickoffAt: WEEK1_KICKOFF, spread: -3.5 },
            { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 60 * 1000) },
          ],
        },
      ],
    });
    const weekId = weekIds.get("regular:1")!;
    const [withSpread, withoutSpread] = gameIds.get("regular:1")! as [string, string];

    const res = await getSlate(cookie, weekId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WeekSlateResponse;
    const byId = new Map(body.games.map((g) => [g.id, g]));
    expect(byId.get(withSpread)?.spread).toBe(-3.5);
    expect(byId.get(withoutSpread)?.spread).toBeNull();
  });

  describe("cancelled and moved games are not pickable", () => {
    /** g1 cancelled, g2 moved (override), g3 postponed — one league, one week. */
    async function seedUnplayableSlate() {
      const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
      const weekId = weekIds.get("regular:1")!;
      const [g1, g2, g3] = gameIds.get("regular:1")!;
      await db.update(games).set({ status: GAME_STATUS.CANCELLED }).where(eq(games.id, g1!));
      await db.update(games).set({ overrideStatus: GAME_STATUS.MOVED }).where(eq(games.id, g2!));
      await db.update(games).set({ status: GAME_STATUS.POSTPONED }).where(eq(games.id, g3!));
      return { league, weekId, g1: g1!, g2: g2!, g3: g3!, memberA };
    }

    it("marks cancelled and moved games unpickable, but leaves a postponed game pickable", async () => {
      const { memberA, weekId, g1, g2, g3 } = await seedUnplayableSlate();
      const res = await getSlate(memberA.cookie, weekId);
      expect(res.status).toBe(200);
      const body = (await res.json()) as WeekSlateResponse;
      const byId = new Map(body.games.map((g) => [g.id, g]));
      expect(byId.get(g1)?.pickable).toBe(false);
      expect(byId.get(g2)?.pickable).toBe(false);
      expect(byId.get(g3)?.pickable).toBe(true);
    });

    it.each([
      { label: "cancelled", pickGame: "g1" as const },
      { label: "moved", pickGame: "g2" as const },
    ])("409s game_not_pickable submitting a $label game", async ({ pickGame }) => {
      const { memberA, league, weekId, g1, g2 } = await seedUnplayableSlate();
      const gameId = pickGame === "g1" ? g1 : g2;

      const res = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [{ gameId, side: PICK_SIDE.HOME, spread: null }],
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "game_not_pickable" });
    });

    it("accepts a pick on a postponed game — it is not swept up by the cancelled/moved rule", async () => {
      const { memberA, league, weekId, g3 } = await seedUnplayableSlate();

      const res = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [{ gameId: g3, side: PICK_SIDE.HOME, spread: null }],
      });
      expect(res.status).toBe(200);
    });
  });
});

describe("GET /api/leagues/:leagueId/picks/week/:weekId", () => {
  it("404s league_not_found for a non-member, and for an unknown league id", async () => {
    const { weekIds, league, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });

    const nonMember = await getPicks(outsider.cookie, league.id, weekId);
    expect(nonMember.status).toBe(404);
    expect(await nonMember.json()).toMatchObject({ error: "league_not_found" });

    const unknownLeague = await getPicks(memberA.cookie, randomUUID(), weekId);
    expect(unknownLeague.status).toBe(404);
    expect(await unknownLeague.json()).toMatchObject({ error: "league_not_found" });
  });

  it("400s wrong_league_mode for an elimination league", async () => {
    const { seasonId, weekIds, memberA } = await seedPickemLeague();
    const league = await insertLeague(db, {
      seasonId,
      mode: LEAGUE_MODE.ELIMINATION,
      settings: {
        startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
        pickType: PICK_TYPE.STRAIGHT_UP,
        pushTieResolution: ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE,
      },
      members: [{ userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await getPicks(memberA.cookie, league.id, weekIds.get("regular:1")!);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "wrong_league_mode" });
  });

  it("400s wrong_league_mode for a march_madness league", async () => {
    const { seasonId, weekIds, memberA } = await seedPickemLeague();
    const league = await insertLeague(db, {
      seasonId,
      mode: LEAGUE_MODE.MARCH_MADNESS,
      settings: {
        scoringModel: MARCH_MADNESS_SCORING_MODEL.STANDARD_DOUBLING,
        maxBracketsPerMember: 5,
      },
      members: [{ userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await getPicks(memberA.cookie, league.id, weekIds.get("regular:1")!);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "wrong_league_mode" });
  });

  it("400s week_out_of_range when the week belongs to a different season", async () => {
    const { league, memberA } = await seedPickemLeague();
    const { weekIds: otherWeekIds } = await seedSeason(db, {
      year: 2027,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
    });

    const res = await getPicks(memberA.cookie, league.id, otherWeekIds.get("regular:1")!);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "week_out_of_range" });
  });

  it("400s week_out_of_range when the week falls outside the league's configured start/end", async () => {
    const { weekIds, memberA, league } = await seedPickemLeague({
      settings: {
        ...DEFAULT_PICKEM_SETTINGS,
        startWeek: { type: WEEK_TYPE.REGULAR, number: 2 },
        endWeek: { type: WEEK_TYPE.REGULAR, number: 3 },
      },
    });

    const res = await getPicks(memberA.cookie, league.id, weekIds.get("regular:1")!);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "week_out_of_range" });
  });

  it("filters another member's picks to kicked-off games only, and reveals them as they lock", async () => {
    const { seasonId, weekIds, gameIds } = await seedSeason(db, {
      year: 2026,
      weeks: THREE_GAME_WEEK,
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;
    const memberA = await createAuthenticatedUser(auth, { username: "member_a" });
    const memberB = await createAuthenticatedUser(auth, { username: "member_b" });
    const league = await insertLeague(db, {
      seasonId,
      members: [
        { userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER },
        { userId: memberB.user.id, role: MEMBER_ROLE.MEMBER },
      ],
    });

    // A picks {g1, g2}; B picks {g1, g3} — different sets sharing the game
    // that kicks off first, so both members' views reveal a genuine change.
    expect(
      (
        await putPicks(memberA.cookie, league.id, weekId, {
          picks: [
            { gameId: g1, side: PICK_SIDE.HOME, spread: null },
            { gameId: g2, side: PICK_SIDE.HOME, spread: null },
          ],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await putPicks(memberB.cookie, league.id, weekId, {
          picks: [
            { gameId: g1, side: PICK_SIDE.AWAY, spread: null },
            { gameId: g3, side: PICK_SIDE.AWAY, spread: null },
          ],
        })
      ).status,
    ).toBe(200);

    // Pre-kickoff: each member sees only their own picks; the other's entry is
    // fully hidden.
    const preAsA = (await (
      await getPicks(memberA.cookie, league.id, weekId)
    ).json()) as PickemWeekPicksResponse;
    const preAEntryA = preAsA.members.find((m) => m.userId === memberA.user.id)!;
    const preAEntryB = preAsA.members.find((m) => m.userId === memberB.user.id)!;
    expect(preAEntryA).toMatchObject({ isViewer: true, hiddenPickCount: 0 });
    expect(preAEntryA.picks).toHaveLength(2);
    expect(preAEntryB).toMatchObject({ isViewer: false, picks: [], hiddenPickCount: 2 });

    const preAsB = (await (
      await getPicks(memberB.cookie, league.id, weekId)
    ).json()) as PickemWeekPicksResponse;
    const preBEntryB = preAsB.members.find((m) => m.userId === memberB.user.id)!;
    const preBEntryA = preAsB.members.find((m) => m.userId === memberA.user.id)!;
    expect(preBEntryB).toMatchObject({ isViewer: true, hiddenPickCount: 0 });
    expect(preBEntryB.picks).toHaveLength(2);
    expect(preBEntryA).toMatchObject({ isViewer: false, picks: [], hiddenPickCount: 2 });

    // g1 kicks off exactly now; g2/g3 haven't — the shared pick reveals on
    // both sides, dropping each hiddenPickCount from 2 to 1.
    const postAsA = (await (
      await getPicks(memberA.cookie, league.id, weekId, appAtKickoff)
    ).json()) as PickemWeekPicksResponse;
    const postAEntryB = postAsA.members.find((m) => m.userId === memberB.user.id)!;
    expect(postAEntryB.hiddenPickCount).toBe(1);
    expect(postAEntryB.picks).toHaveLength(1);
    expect(postAEntryB.picks[0]).toMatchObject({ gameId: g1, side: PICK_SIDE.AWAY });

    const postAsB = (await (
      await getPicks(memberB.cookie, league.id, weekId, appAtKickoff)
    ).json()) as PickemWeekPicksResponse;
    const postBEntryA = postAsB.members.find((m) => m.userId === memberA.user.id)!;
    expect(postBEntryA.hiddenPickCount).toBe(1);
    expect(postBEntryA.picks).toHaveLength(1);
    expect(postBEntryA.picks[0]).toMatchObject({ gameId: g1, side: PICK_SIDE.HOME });
  });

  it("isViewer is true only on the caller's own entry", async () => {
    const { league, weekIds, memberA, memberB } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;

    const asA = (await (
      await getPicks(memberA.cookie, league.id, weekId)
    ).json()) as PickemWeekPicksResponse;
    expect(asA.members.find((m) => m.userId === memberA.user.id)?.isViewer).toBe(true);
    expect(asA.members.find((m) => m.userId === memberB.user.id)?.isViewer).toBe(false);

    const asB = (await (
      await getPicks(memberB.cookie, league.id, weekId)
    ).json()) as PickemWeekPicksResponse;
    expect(asB.members.find((m) => m.userId === memberB.user.id)?.isViewer).toBe(true);
    expect(asB.members.find((m) => m.userId === memberA.user.id)?.isViewer).toBe(false);
  });

  it("caps picksAllowed at min(picksPerWeek, slate size) — normal case", async () => {
    const { league, weekIds, memberA } = await seedPickemLeague({
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 2 },
    });
    const res = await getPicks(memberA.cookie, league.id, weekIds.get("regular:1")!);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PickemWeekPicksResponse).picksAllowed).toBe(2);
  });

  it("caps picksAllowed at min(picksPerWeek, slate size) — short week", async () => {
    const { league, weekIds, memberA } = await seedPickemLeague({
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 5 },
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
    });
    const res = await getPicks(memberA.cookie, league.id, weekIds.get("regular:1")!);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PickemWeekPicksResponse).picksAllowed).toBe(1);
  });

  it("excludes a cancelled/moved game from picksAllowed — a 3-game week with 1 cancelled caps at 2", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 5 },
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    await db.update(games).set({ status: GAME_STATUS.CANCELLED }).where(eq(games.id, g1!));

    const res = await getPicks(memberA.cookie, league.id, weekId);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PickemWeekPicksResponse).picksAllowed).toBe(2);
  });
});

describe("PUT /api/leagues/:leagueId/picks/week/:weekId", () => {
  it("401s without a session", async () => {
    const { league, weekIds } = await seedPickemLeague();
    const res = await putPicks(undefined, league.id, weekIds.get("regular:1")!, { picks: [] });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("404s league_not_found for a non-member", async () => {
    const { league, weekIds } = await seedPickemLeague();
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });
    const res = await putPicks(outsider.cookie, league.id, weekIds.get("regular:1")!, {
      picks: [],
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "league_not_found" });
  });

  it("saves a happy-path submission, and a later different set replaces it wholesale", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const first = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICK_SIDE.AWAY, spread: null },
        { gameId: g3, side: PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as PickemWeekPicksResponse;
    const firstOwn = firstBody.members.find((m) => m.userId === memberA.user.id)!;
    expect(firstOwn.picks.map((p) => p.gameId).sort()).toEqual([g1, g2, g3].sort());

    // Re-submit a wholly different set — the old picks must be gone, not merged.
    const second = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g2, side: PICK_SIDE.HOME, spread: null }],
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as PickemWeekPicksResponse;
    const secondOwn = secondBody.members.find((m) => m.userId === memberA.user.id)!;
    expect(secondOwn.picks).toHaveLength(1);
    expect(secondOwn.picks[0]).toMatchObject({ gameId: g2, side: PICK_SIDE.HOME });
  });

  it("clears the member's unstarted picks when submitting an empty array", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;

    await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: null }],
    });
    const res = await putPicks(memberA.cookie, league.id, weekId, { picks: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemWeekPicksResponse;
    expect(body.members.find((m) => m.userId === memberA.user.id)?.picks).toEqual([]);
  });

  it("409s pick_locked when a submitted game has already kicked off", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;

    const res = await putPicks(
      memberA.cookie,
      league.id,
      weekId,
      { picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: null }] },
      appAfterKickoff,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pick_locked" });
  });

  it("409s pick_locked exactly at the kickoff instant — the boundary is locked", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;

    const res = await putPicks(
      memberA.cookie,
      league.id,
      weekId,
      { picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: null }] },
      appAtKickoff,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pick_locked" });
  });

  it("keeps a locked pick already stored when a later submission omits it, and counts it toward the cap", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 2 },
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    // g1 kicks off first — pick it while everything is still open.
    const pre = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: null }],
    });
    expect(pre.status).toBe(200);

    // g1 has since kicked off; submit a different, still-unstarted game only.
    // The locked g1 pick must survive the replace, not be dropped for being
    // omitted from this submission.
    const post = await putPicks(
      memberA.cookie,
      league.id,
      weekId,
      { picks: [{ gameId: g2, side: PICK_SIDE.HOME, spread: null }] },
      appAfterKickoff,
    );
    expect(post.status).toBe(200);
    const postOwn = ((await post.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!;
    expect(postOwn.picks.map((p) => p.gameId).sort()).toEqual([g1, g2].sort());

    // picksPerWeek is 2: the locked g1 pick still counts toward the cap, so
    // adding two MORE new picks (g2 again + g3) would total 3 — over the cap.
    const overCap = await putPicks(
      memberA.cookie,
      league.id,
      weekId,
      {
        picks: [
          { gameId: g2, side: PICK_SIDE.HOME, spread: null },
          { gameId: g3, side: PICK_SIDE.HOME, spread: null },
        ],
      },
      appAfterKickoff,
    );
    expect(overCap.status).toBe(400);
    expect(await overCap.json()).toMatchObject({ error: "too_many_picks" });
  });

  describe("retention keys on pickable, not locked alone", () => {
    // The shared FOUR_GAME_WEEK's 4th, never-picked game exists purely so
    // cancelling one of the three picked games doesn't itself shrink
    // `picksAllowed` (min(picksPerWeek, pickable count) would otherwise drop
    // in lockstep with `retainedCount`, tripping the cap — that interaction
    // is covered on its own further down).

    it.each([
      {
        label: "cancelled",
        apply: (gameId: string) =>
          db.update(games).set({ status: GAME_STATUS.CANCELLED }).where(eq(games.id, gameId)),
      },
      {
        label: "moved",
        apply: (gameId: string) =>
          db.update(games).set({ overrideStatus: GAME_STATUS.MOVED }).where(eq(games.id, gameId)),
      },
    ])(
      "keeps a pick on a still-unlocked $label game when a later submission omits it",
      async ({ apply }) => {
        const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
          settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 3 },
          weeks: FOUR_GAME_WEEK,
        });
        const weekId = weekIds.get("regular:1")!;
        const [g1, g2, g3] = gameIds.get("regular:1")!;

        const initial = await putPicks(memberA.cookie, league.id, weekId, {
          picks: [
            { gameId: g1, side: PICK_SIDE.HOME, spread: null },
            { gameId: g2, side: PICK_SIDE.HOME, spread: null },
            { gameId: g3, side: PICK_SIDE.HOME, spread: null },
          ],
        });
        expect(initial.status).toBe(200);

        // g1 becomes unplayable while still unstarted — deliberately no clock
        // advance, so `locked` stays false for g1 and only `pickable`
        // distinguishes it. Before the fix, keying retention on `locked` alone
        // would have deleted this pick for being omitted below.
        await apply(g1!);

        const res = await putPicks(memberA.cookie, league.id, weekId, {
          picks: [
            { gameId: g2, side: PICK_SIDE.HOME, spread: null },
            { gameId: g3, side: PICK_SIDE.HOME, spread: null },
          ],
        });
        expect(res.status).toBe(200);
        const own = ((await res.json()) as PickemWeekPicksResponse).members.find(
          (m) => m.userId === memberA.user.id,
        )!;
        expect(own.picks.map((p) => p.gameId).sort()).toEqual([g1, g2, g3].sort());
      },
    );

    it("still deletes a pick on a still-scheduled, unlocked game that is simply omitted — the fix doesn't over-retain", async () => {
      const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
        settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 3 },
        weeks: FOUR_GAME_WEEK,
      });
      const weekId = weekIds.get("regular:1")!;
      const [g1, g2, g3] = gameIds.get("regular:1")!;

      const initial = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [
          { gameId: g1, side: PICK_SIDE.HOME, spread: null },
          { gameId: g2, side: PICK_SIDE.HOME, spread: null },
          { gameId: g3, side: PICK_SIDE.HOME, spread: null },
        ],
      });
      expect(initial.status).toBe(200);

      await db.update(games).set({ status: GAME_STATUS.CANCELLED }).where(eq(games.id, g1!));

      // Omit both the cancelled g1 (unreplaceable — must survive) and the
      // still-scheduled g2 (an ordinary replaceable pick — must be dropped,
      // exactly like the pre-existing wholesale-replace behavior).
      const res = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [{ gameId: g3, side: PICK_SIDE.HOME, spread: null }],
      });
      expect(res.status).toBe(200);
      const own = ((await res.json()) as PickemWeekPicksResponse).members.find(
        (m) => m.userId === memberA.user.id,
      )!;
      expect(own.picks.map((p) => p.gameId).sort()).toEqual([g1, g3].sort());
    });
  });

  it("never refuses an empty submission, even though a cancellation has shrunk the cap below what's retained", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 3 },
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICK_SIDE.HOME, spread: null },
        { gameId: g3, side: PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(initial.status).toBe(200);

    // Cancelling g1 drops picksAllowed from 3 to 2 (only g2/g3 are still
    // pickable) while the member still holds 3 rows — an empty, delete-only
    // submission must never be refused by a cap it can only shrink against.
    await db.update(games).set({ status: GAME_STATUS.CANCELLED }).where(eq(games.id, g1!));

    const res = await putPicks(memberA.cookie, league.id, weekId, { picks: [] });
    expect(res.status).toBe(200);
  });

  it("bounds a submission by remaining slots (picksAllowed minus retained), not the raw picksAllowed number", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 2 },
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: null }],
    });
    expect(initial.status).toBe(200);

    // picksAllowed stays min(2, 2 pickable) = 2 after this cancellation (g2/g3
    // remain pickable); the retained cancelled g1 pick occupies one of those
    // two slots, leaving exactly one remaining for a fresh submission.
    await db.update(games).set({ status: GAME_STATUS.CANCELLED }).where(eq(games.id, g1!));

    const tooMany = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g2, side: PICK_SIDE.HOME, spread: null },
        { gameId: g3, side: PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({ error: "too_many_picks" });

    const ok = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g2, side: PICK_SIDE.HOME, spread: null }],
    });
    expect(ok.status).toBe(200);
  });

  describe("a pick whose game moved to another week", () => {
    /** Week 1's 3-game slate plus a second week to move a game into. */
    function twoWeekSettings(picksPerWeek: number): PickemSettings {
      return { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek };
    }

    async function seedMovableGame(picksPerWeek: number) {
      const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
        settings: twoWeekSettings(picksPerWeek),
        weeks: [
          ...THREE_GAME_WEEK,
          {
            weekNumber: 2,
            kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
          },
        ],
      });
      const week1Id = weekIds.get("regular:1")!;
      const week2Id = weekIds.get("regular:2")!;
      const [g1, g2, g3] = gameIds.get("regular:1")!;
      return { league, week1Id, week2Id, g1: g1!, g2: g2!, g3: g3!, memberA };
    }

    it("is not deleted by a later submission that omits it", async () => {
      const { league, week1Id, week2Id, g1, g2, memberA } = await seedMovableGame(5);

      const initial = await putPicks(memberA.cookie, league.id, week1Id, {
        picks: [
          { gameId: g1, side: PICK_SIDE.HOME, spread: null },
          { gameId: g2, side: PICK_SIDE.HOME, spread: null },
        ],
      });
      expect(initial.status).toBe(200);

      // g1 moves to week 2 — its pick keeps week 1, the week it was made in.
      await db.update(games).set({ weekId: week2Id }).where(eq(games.id, g1));

      // Submitting only g2 must not destroy the now-unaddressable g1 pick.
      const later = await putPicks(memberA.cookie, league.id, week1Id, {
        picks: [{ gameId: g2, side: PICK_SIDE.HOME, spread: null }],
      });
      expect(later.status).toBe(200);
      const own = ((await later.json()) as PickemWeekPicksResponse).members.find(
        (m) => m.userId === memberA.user.id,
      )!;
      expect(own.picks.map((p) => p.gameId).sort()).toEqual([g1, g2].sort());
    });

    it("survives even when the moved game has since kicked off (locked)", async () => {
      const { league, week1Id, week2Id, g1, g2, memberA } = await seedMovableGame(5);

      await putPicks(memberA.cookie, league.id, week1Id, {
        picks: [
          { gameId: g1, side: PICK_SIDE.HOME, spread: null },
          { gameId: g2, side: PICK_SIDE.HOME, spread: null },
        ],
      });
      await db.update(games).set({ weekId: week2Id }).where(eq(games.id, g1));

      // g1's own kickoff (unchanged by the week move) is already in the past;
      // g2's is still an hour out, so this submission is otherwise legal.
      const later = await putPicks(
        memberA.cookie,
        league.id,
        week1Id,
        { picks: [{ gameId: g2, side: PICK_SIDE.HOME, spread: null }] },
        appAfterKickoff,
      );
      expect(later.status).toBe(200);
      const own = ((await later.json()) as PickemWeekPicksResponse).members.find(
        (m) => m.userId === memberA.user.id,
      )!;
      expect(own.picks.map((p) => p.gameId).sort()).toEqual([g1, g2].sort());
    });

    it("still counts toward the picks-per-week cap", async () => {
      const { league, week1Id, week2Id, g1, g2, g3, memberA } = await seedMovableGame(2);

      await putPicks(memberA.cookie, league.id, week1Id, {
        picks: [
          { gameId: g1, side: PICK_SIDE.HOME, spread: null },
          { gameId: g2, side: PICK_SIDE.HOME, spread: null },
        ],
      });
      await db.update(games).set({ weekId: week2Id }).where(eq(games.id, g1));

      // The retained (moved-out) g1 pick occupies one of the two slots, so
      // two brand-new picks push the total to three — over the cap.
      const res = await putPicks(memberA.cookie, league.id, week1Id, {
        picks: [
          { gameId: g2, side: PICK_SIDE.HOME, spread: null },
          { gameId: g3, side: PICK_SIDE.HOME, spread: null },
        ],
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "too_many_picks" });
    });
  });

  it("rolls back the whole submission when one entry is refused — no partial write", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      weeks: [
        ...THREE_GAME_WEEK,
        {
          weekNumber: 2,
          kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
        },
      ],
    });
    const week1Id = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;
    const week2GameId = gameIds.get("regular:2")![0]!;

    const initial = await putPicks(memberA.cookie, league.id, week1Id, {
      picks: [
        { gameId: g1, side: PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(initial.status).toBe(200);

    // The third entry references a game from a different week — the whole
    // submission must be refused, not just that one entry.
    const res = await putPicks(memberA.cookie, league.id, week1Id, {
      picks: [
        { gameId: g1, side: PICK_SIDE.AWAY, spread: null },
        { gameId: g3, side: PICK_SIDE.HOME, spread: null },
        { gameId: week2GameId, side: PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "game_not_in_week" });

    const after = await getPicks(memberA.cookie, league.id, week1Id);
    const own = ((await after.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!;
    expect(own.picks.map((p) => p.gameId).sort()).toEqual([g1, g2].sort());
    expect(own.picks.find((p) => p.gameId === g1)?.side).toBe(PICK_SIDE.HOME);
  });

  it("400s too_many_picks when submitting more than picksPerWeek", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 2 },
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICK_SIDE.HOME, spread: null },
        { gameId: g3, side: PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "too_many_picks" });
  });

  // NOTE: a genuine "slate shorter than picksPerWeek AND *this submission's own
  // games* exceed the slate size" case is unreachable through the API as
  // currently written — any submission whose games are all valid, distinct,
  // and unlocked is bounded above by the slate's own game count, so it can
  // never exceed picksAllowed (== slate.length in that regime) without first
  // tripping game_not_in_week or duplicate_pick, both of which are checked
  // ahead of the cap. The cap IS reachable in a short slate, though — via
  // *retained* picks (locked, above, or moved-out, below) occupying slots the
  // submission itself doesn't ask for.

  it("400s duplicate_pick when the same gameId appears twice", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;

    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICK_SIDE.HOME, spread: null },
        { gameId: g1, side: PICK_SIDE.AWAY, spread: null },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "duplicate_pick" });
  });

  it("400s game_not_in_week when a submitted game belongs to a different week", async () => {
    // Both weeks share one season instance so this exercises game_not_in_week
    // specifically, not week_out_of_range (a season mismatch).
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      weeks: [
        ...THREE_GAME_WEEK,
        {
          weekNumber: 2,
          kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
        },
      ],
    });
    const week1Id = weekIds.get("regular:1")!;
    const week2GameId = gameIds.get("regular:2")![0]!;

    const res = await putPicks(memberA.cookie, league.id, week1Id, {
      picks: [{ gameId: week2GameId, side: PICK_SIDE.HOME, spread: null }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "game_not_in_week" });
  });

  it("409s league_concluded when the season's status is concluded", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      status: LEAGUE_STATUS.CONCLUDED,
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;

    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: null }],
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "league_concluded" });
  });

  it.each([
    { label: "picks not an array", body: { picks: "nope" } },
    {
      label: "non-uuid gameId",
      body: { picks: [{ gameId: "not-a-uuid", side: PICK_SIDE.HOME, spread: null }] },
    },
  ])("400s a malformed body: $label — never a 500", async ({ body }) => {
    const { league, weekIds, memberA } = await seedPickemLeague();
    const res = await putPicks(memberA.cookie, league.id, weekIds.get("regular:1")!, body);
    expect(res.status).toBe(400);
    const parsed = await res.json();
    expect(parsed).toMatchObject({ error: "validation" });
    expect(Object.keys(parsed as object).sort()).toEqual(["error", "message"]);
  });

  describe("against the spread", () => {
    const ATS_SETTINGS: PickemSettings = {
      ...DEFAULT_PICKEM_SETTINGS,
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
    };

    it("accepts the exact current spread, including a half point, and persists it", async () => {
      const { seasonId, weekIds, gameIds } = await seedSeason(db, {
        year: 2026,
        weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF, spread: -3.5 }] }],
      });
      const memberA = await createAuthenticatedUser(auth, { username: "member_a" });
      const league = await insertLeague(db, {
        seasonId,
        settings: ATS_SETTINGS,
        members: [{ userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
      const weekId = weekIds.get("regular:1")!;
      const [g1] = gameIds.get("regular:1")!;

      const res = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: -3.5 }],
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as PickemWeekPicksResponse;
      const own = body.members.find((m) => m.userId === memberA.user.id)!;
      expect(own.picks[0]).toMatchObject({ gameId: g1, spread: -3.5 });
    });

    it("409s spread_stale when the submitted spread doesn't match the current number", async () => {
      const { seasonId, weekIds, gameIds } = await seedSeason(db, {
        year: 2026,
        weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF, spread: -3.5 }] }],
      });
      const memberA = await createAuthenticatedUser(auth, { username: "member_a" });
      const league = await insertLeague(db, {
        seasonId,
        settings: ATS_SETTINGS,
        members: [{ userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
      const weekId = weekIds.get("regular:1")!;
      const [g1] = gameIds.get("regular:1")!;

      const res = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: -4 }],
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "spread_stale" });
    });

    it("409s spread_unavailable when the game has no odds snapshot at all", async () => {
      const { seasonId, weekIds, gameIds } = await seedSeason(db, {
        year: 2026,
        weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
      });
      const memberA = await createAuthenticatedUser(auth, { username: "member_a" });
      const league = await insertLeague(db, {
        seasonId,
        settings: ATS_SETTINGS,
        members: [{ userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
      const weekId = weekIds.get("regular:1")!;
      const [g1] = gameIds.get("regular:1")!;

      const res = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: -3.5 }],
      });
      expect(res.status).toBe(409);
      // Distinct from spread_stale: nothing has been posted to accept, so the
      // member waits for the odds sync rather than re-reviewing a new number.
      expect(await res.json()).toMatchObject({ error: "spread_unavailable" });
    });
  });

  it("ignores and nulls out a submitted spread in a straight-up league", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;

    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: -7 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemWeekPicksResponse;
    const own = body.members.find((m) => m.userId === memberA.user.id)!;
    expect(own.picks[0]).toMatchObject({ gameId: g1, spread: null });
  });
});

describe("PATCH /api/leagues/:leagueId — settings changes reset picks (settings-reset.ts)", () => {
  function settingsWith(overrides: Partial<PickemSettings>): PickemSettings {
    return { ...DEFAULT_PICKEM_SETTINGS, ...overrides };
  }

  async function seedWithOnePick() {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: null }],
    });
    expect(res.status).toBe(200);
    return { league, memberA };
  }

  it.each([
    {
      label: "pickType changes (straight_up → against_the_spread)",
      settings: settingsWith({ pickType: PICK_TYPE.AGAINST_THE_SPREAD }),
    },
    { label: "picksPerWeek is lowered", settings: settingsWith({ picksPerWeek: 2 }) },
    {
      label: "startWeek moves later",
      settings: settingsWith({ startWeek: { type: WEEK_TYPE.REGULAR, number: 2 } }),
    },
    {
      label: "endWeek moves earlier",
      settings: settingsWith({ endWeek: { type: WEEK_TYPE.REGULAR, number: 10 } }),
    },
  ])("clears picks when $label — a change that could strand them", async ({ settings }) => {
    const { league, memberA } = await seedWithOnePick();

    const res = await patchLeague(memberA.cookie, league.id, { settings });
    expect(res.status).toBe(200);
    expect(await pickCountFor(league.id)).toBe(0);
  });

  it.each([
    {
      label: "pushTieResolution changes alone",
      settings: settingsWith({ pushTieResolution: PICKEM_PUSH_TIE_RESOLUTION.ZERO_POINTS }),
    },
    { label: "picksPerWeek is raised", settings: settingsWith({ picksPerWeek: 8 }) },
  ])("keeps picks when $label — nothing is stranded", async ({ settings }) => {
    const { league, memberA } = await seedWithOnePick();

    const res = await patchLeague(memberA.cookie, league.id, { settings });
    expect(res.status).toBe(200);
    expect(await pickCountFor(league.id)).toBe(1);
  });

  it("clears picks when a stored settings row omits picksPerWeek entirely and the new value undercuts the schema default", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    // A row written before `picksPerWeek` existed on the schema — genuinely
    // missing the key, not just defaulted, so the invalidation predicate can
    // only see the right "previous" value (5, the schema's `.default()`) by
    // parsing through LEAGUE_SETTINGS_SCHEMAS rather than reading the stored
    // JSONB directly (settings-reset.ts: `1 < undefined` is false, which is
    // exactly the bug this pins).
    const withoutPicksPerWeek = {
      startWeek: DEFAULT_PICKEM_SETTINGS.startWeek,
      endWeek: DEFAULT_PICKEM_SETTINGS.endWeek,
      pickType: DEFAULT_PICKEM_SETTINGS.pickType,
      pushTieResolution: DEFAULT_PICKEM_SETTINGS.pushTieResolution,
    };
    await db
      .update(leagueSeasons)
      .set({ settings: withoutPicksPerWeek as unknown as PickemSettings })
      .where(eq(leagueSeasons.leagueId, league.id));

    const picks = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICK_SIDE.HOME, spread: null },
        { gameId: g3, side: PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(picks.status).toBe(200);

    const res = await patchLeague(memberA.cookie, league.id, {
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 1 },
    });
    expect(res.status).toBe(200);
    expect(await pickCountFor(league.id)).toBe(0);
  });

  it("409s picks_locked — and leaves both the pick and the settings untouched — when a locked pick would be stranded", async () => {
    // The league's start week (week 1) holds no games, so `leagueStartAt` is
    // null and `isPreStart` reports true regardless of the clock — the
    // commissioner keeps pre-start powers even though a later week's game has
    // already kicked off and locked a pick (ADR-0015: trusting the pre-start
    // boundary here would let a settings edit delete picks already locked and
    // revealed to the league).
    const { seasonId, weekIds, gameIds } = await seedSeason(db, {
      year: 2026,
      weeks: [
        { weekNumber: 1, kickoffs: [] },
        { weekNumber: 2, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
      ],
    });
    const memberA = await createAuthenticatedUser(auth, { username: "member_a" });
    const league = await insertLeague(db, {
      seasonId,
      settings: DEFAULT_PICKEM_SETTINGS,
      members: [{ userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });
    const week2Id = weekIds.get("regular:2")!;
    const [g1] = gameIds.get("regular:2")!;

    const pickRes = await putPicks(memberA.cookie, league.id, week2Id, {
      picks: [{ gameId: g1, side: PICK_SIDE.HOME, spread: null }],
    });
    expect(pickRes.status).toBe(200);

    // g1's kickoff (WEEK1_KICKOFF) is now in the past under this clock — the
    // pick is locked, but the league itself never left "pre-start".
    const patchRes = await patchLeague(
      memberA.cookie,
      league.id,
      { settings: { ...DEFAULT_PICKEM_SETTINGS, pickType: PICK_TYPE.AGAINST_THE_SPREAD } },
      appAfterKickoff,
    );
    expect(patchRes.status).toBe(409);
    expect(await patchRes.json()).toMatchObject({ error: "picks_locked" });

    // Pins the atomicity fix: the whole transaction — settings write included
    // — must roll back on this refusal, not just skip the pick clear.
    expect(await pickCountFor(league.id)).toBe(1);
    const [seasonRow] = await db
      .select()
      .from(leagueSeasons)
      .where(eq(leagueSeasons.leagueId, league.id));
    expect((seasonRow?.settings as PickemSettings).pickType).toBe(PICK_TYPE.STRAIGHT_UP);
  });
});
