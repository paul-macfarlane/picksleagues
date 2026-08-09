import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { games, leagueMembers, leagueSeasons, pickemPicks, users } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  SURVIVOR_PUSH_TIE_RESOLUTION,
  GAME_STATUS,
  LEAGUE_MODE,
  LEAGUE_STATUS,
  MARCH_MADNESS_SCORING_MODEL,
  MEMBER_ROLE,
  PICK_OUTCOME,
  PICKEM_PICK_SIDE,
  PICKEM_SEASON_RANGE_PRESET,
  PICK_TYPE,
  WEEK_TYPE,
  type PickemSettings,
  type PickemSettingsInput,
  type PickemWeekPicksResponse,
  type WeekSlateResponse,
} from "@picksleagues/schemas";
import { settlePickemLeagueSeasonWeeks } from "../src/services/pickem/settlement";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import {
  DEFAULT_PICKEM_SETTINGS,
  FOUR_GAME_WEEK,
  insertLeague,
  insertPick,
  membersOf,
  SEED_AT,
  seedSeason,
  setGame,
  type SeededWeek,
} from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF, withCookie } from "./setup/league-app";
import { seedPickemLeague as seedPickemLeagueBase } from "./setup/pickem-league";
import { resetDb } from "./setup/reset-db";

const {
  db,
  auth,
  app,
  appAfterKickoff,
  appAtKickoff,
  getSlate,
  getPicks,
  putPicks,
  getPickSummary,
} = makeLeagueTestHarness();

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
    leagueSeasonId: base.leagueSeasonId,
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

  /**
   * Live in-game state on the slate (DATA-8). Precedence is asserted through
   * the serializer, not the row: `override_* ?? provider_*` (arch D15) has to
   * hold where a client actually reads it.
   */
  it("serializes override-resolved live state with the as-of stamp of the row's last change", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const { weekIds, gameIds } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [corrected, provided] = gameIds.get("regular:1")! as [string, string, string];

    const observedAt = new Date(WEEK1_KICKOFF.getTime() + 40 * 60 * 1000);
    // Both games are mid-game per the provider; only the first is corrected.
    await db
      .update(games)
      .set({
        status: GAME_STATUS.IN_PROGRESS,
        period: 1,
        clockSeconds: 900,
        overridePeriod: 3,
        overrideClockSeconds: 421,
        updatedAt: observedAt,
      })
      .where(eq(games.id, corrected));
    await db
      .update(games)
      .set({
        status: GAME_STATUS.IN_PROGRESS,
        period: 2,
        clockSeconds: 12,
        updatedAt: observedAt,
      })
      .where(eq(games.id, provided));

    const res = await getSlate(cookie, weekId, appAfterKickoff);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WeekSlateResponse;
    const byId = new Map(body.games.map((g) => [g.id, g]));

    expect(byId.get(corrected)).toMatchObject({
      period: 3,
      clockSeconds: 421,
      stateAsOf: observedAt.toISOString(),
    });
    expect(byId.get(provided)).toMatchObject({
      period: 2,
      clockSeconds: 12,
      stateAsOf: observedAt.toISOString(),
    });
  });

  it("serializes null live state for a game that has never been in progress", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const { weekIds, gameIds } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")! as [string, string, string];

    const res = await getSlate(cookie, weekId);
    const body = (await res.json()) as WeekSlateResponse;
    const game = body.games.find((g) => g.id === g1);

    expect(game).toMatchObject({ period: null, clockSeconds: null });
    // Still stamped — a client can date the row it is showing either way.
    expect(game?.stateAsOf).toBe(SEED_AT.toISOString());
  });

  it("reflects the seeded game's spread, and null when none was seeded", async () => {
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

  // PKM-9: the credit surfaces read this off the game row, frozen alongside
  // the spread itself.
  it("reflects the seeded game's spread source, and suppresses it once override_spread is set (arch D15)", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const { weekIds, gameIds } = await seedSeason(db, {
      year: 2026,
      weeks: [
        {
          weekNumber: 1,
          kickoffs: [
            { kickoffAt: WEEK1_KICKOFF, spread: -3.5, spreadSource: "DraftKings" },
            { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 60 * 1000) },
          ],
        },
      ],
    });
    const weekId = weekIds.get("regular:1")!;
    const [sourced, unsourced] = gameIds.get("regular:1")! as [string, string];

    const before = await getSlate(cookie, weekId);
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as WeekSlateResponse;
    const beforeById = new Map(beforeBody.games.map((g) => [g.id, g]));
    expect(beforeById.get(sourced)?.spreadSource).toBe("DraftKings");
    expect(beforeById.get(unsourced)?.spreadSource).toBeNull();

    // A commissioner correction is not the book's line — the credit must
    // disappear from this one game even though the ingestion-written source
    // column is untouched.
    await db.update(games).set({ overrideSpread: 1.5 }).where(eq(games.id, sourced));

    const after = await getSlate(cookie, weekId);
    const afterBody = (await after.json()) as WeekSlateResponse;
    const afterById = new Map(afterBody.games.map((g) => [g.id, g]));
    expect(afterById.get(sourced)?.spreadSource).toBeNull();
    expect(afterById.get(sourced)?.spread).toBe(1.5);
  });

  describe("cancelled games are not pickable", () => {
    /**
     * g1 cancelled by the provider, g2 cancelled by an admin override, g3
     * postponed — one league, one week. Both cancellation tiers matter: the
     * override is the remedy ADR-0019 leaves for a genuine provider week move,
     * now that `moved` is not a status.
     */
    async function seedUnplayableSlate() {
      const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
      const weekId = weekIds.get("regular:1")!;
      const [g1, g2, g3] = gameIds.get("regular:1")!;
      await db.update(games).set({ status: GAME_STATUS.CANCELLED }).where(eq(games.id, g1!));
      await db
        .update(games)
        .set({ overrideStatus: GAME_STATUS.CANCELLED })
        .where(eq(games.id, g2!));
      await db.update(games).set({ status: GAME_STATUS.POSTPONED }).where(eq(games.id, g3!));
      return { league, weekId, g1: g1!, g2: g2!, g3: g3!, memberA };
    }

    it("marks cancelled games unpickable, but leaves a postponed game pickable", async () => {
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
      { label: "provider-cancelled", pickGame: "g1" as const },
      { label: "override-cancelled", pickGame: "g2" as const },
    ])("409s game_not_pickable submitting a $label game", async ({ pickGame }) => {
      const { memberA, league, weekId, g1, g2 } = await seedUnplayableSlate();
      const gameId = pickGame === "g1" ? g1 : g2;

      const res = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [{ gameId, side: PICKEM_PICK_SIDE.HOME, spread: null }],
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "game_not_pickable" });
    });

    it("accepts a pick on a postponed game — it is not swept up by the cancellation rule", async () => {
      const { memberA, league, weekId, g3 } = await seedUnplayableSlate();

      const res = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [{ gameId: g3, side: PICKEM_PICK_SIDE.HOME, spread: null }],
      });
      expect(res.status).toBe(200);
    });
  });
});

describe("GET /api/leagues/:leagueId/pickem/weeks/:weekId/picks", () => {
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

  // Same resolved-avatar rule as the league member list (ADR-0022): this
  // serializer builds its own member literal, so it can drift independently.
  it("shows a league-mate a member's avatar override in place of their provider image", async () => {
    const { league, weekIds, memberA, memberB } = await seedPickemLeague();
    await db
      .update(users)
      .set({
        image: "https://provider.example.invalid/from-oauth.png",
        imageOverride: "https://cdn.example.invalid/member-set.png",
      })
      .where(eq(users.id, memberB.user.id));

    const res = await getPicks(memberA.cookie, league.id, weekIds.get("regular:1")!);

    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemWeekPicksResponse;
    expect(body.members.find((member) => member.userId === memberB.user.id)?.image).toBe(
      "https://cdn.example.invalid/member-set.png",
    );
  });

  // PKM-9: no column on `pickem_picks` for this — the pick DTO reads the
  // source off the game row the slate resolves, so it stays correct on a
  // submitted week whose game is long final.
  it("serializes a pick's spread source from its game, null once the game's override_spread is set", async () => {
    const { league, weekIds, gameIds, leagueSeasonId, memberA } = await seedPickemLeague({
      weeks: [
        {
          weekNumber: 1,
          kickoffs: [
            { kickoffAt: WEEK1_KICKOFF, spread: -3.5, spreadSource: "DraftKings" },
            {
              kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 60 * 1000),
              spread: 2.5,
              spreadSource: "DraftKings",
            },
          ],
        },
      ],
      settings: { ...DEFAULT_PICKEM_SETTINGS, pickType: PICK_TYPE.AGAINST_THE_SPREAD },
    });
    const weekId = weekIds.get("regular:1")!;
    const [sourced, overridden] = gameIds.get("regular:1")! as [string, string];
    const membersByUser = await membersOf(db, league.id);

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: membersByUser.get(memberA.user.id)!,
      weekId,
      gameId: sourced,
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: -3.5,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: membersByUser.get(memberA.user.id)!,
      weekId,
      gameId: overridden,
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: 2.5,
    });
    // A commissioner correction on the second game — its credit must
    // disappear even though the pick's own accepted spread is untouched.
    await db.update(games).set({ overrideSpread: 9.5 }).where(eq(games.id, overridden));

    const res = await getPicks(memberA.cookie, league.id, weekId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemWeekPicksResponse;
    const viewerPicks =
      body.members.find((member) => member.userId === memberA.user.id)?.picks ?? [];
    const byGameId = new Map(viewerPicks.map((pick) => [pick.gameId, pick]));
    expect(byGameId.get(sourced)?.spreadSource).toBe("DraftKings");
    expect(byGameId.get(overridden)?.spreadSource).toBeNull();
    // The pick's own accepted number is untouched by the game's later correction.
    expect(byGameId.get(overridden)?.spread).toBe(2.5);
  });

  // PKM-9: the slate is mode-agnostic, so a straight-up league's games still
  // carry a source. The pick DTO must not pass it on — a straight-up pick has
  // no accepted number, and a book credited beside a null spread names a price
  // nobody was graded against.
  it("serializes no spread source on a straight-up pick, whose game still has one", async () => {
    const { league, weekIds, gameIds, leagueSeasonId, memberA } = await seedPickemLeague({
      weeks: [
        {
          weekNumber: 1,
          kickoffs: [{ kickoffAt: WEEK1_KICKOFF, spread: -3.5, spreadSource: "DraftKings" }],
        },
      ],
      settings: { ...DEFAULT_PICKEM_SETTINGS, pickType: PICK_TYPE.STRAIGHT_UP },
    });
    const weekId = weekIds.get("regular:1")!;
    const [gameId] = gameIds.get("regular:1")! as [string];
    const membersByUser = await membersOf(db, league.id);

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: membersByUser.get(memberA.user.id)!,
      weekId,
      gameId,
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: null,
    });

    const res = await getPicks(memberA.cookie, league.id, weekId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemWeekPicksResponse;
    const pick = body.members
      .find((member) => member.userId === memberA.user.id)
      ?.picks.find((candidate) => candidate.gameId === gameId);
    expect(pick?.spread).toBeNull();
    expect(pick?.spreadSource).toBeNull();
  });

  it("400s wrong_league_mode for a survivor league", async () => {
    const { seasonId, weekIds, memberA } = await seedPickemLeague();
    const league = await insertLeague(db, {
      seasonId,
      mode: LEAGUE_MODE.SURVIVOR,
      settings: {
        startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
        pickType: PICK_TYPE.STRAIGHT_UP,
        pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
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
      // Two picks a week against a three-game slate, so each member's one
      // submission can be a different pair rather than the whole slate.
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 2 },
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
            { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
            { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
          ],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await putPicks(memberB.cookie, league.id, weekId, {
          picks: [
            { gameId: g1, side: PICKEM_PICK_SIDE.AWAY, spread: null },
            { gameId: g3, side: PICKEM_PICK_SIDE.AWAY, spread: null },
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
    expect(postAEntryB.picks[0]).toMatchObject({ gameId: g1, side: PICKEM_PICK_SIDE.AWAY });

    const postAsB = (await (
      await getPicks(memberB.cookie, league.id, weekId, appAtKickoff)
    ).json()) as PickemWeekPicksResponse;
    const postBEntryA = postAsB.members.find((m) => m.userId === memberA.user.id)!;
    expect(postBEntryA.hiddenPickCount).toBe(1);
    expect(postBEntryA.picks).toHaveLength(1);
    expect(postBEntryA.picks[0]).toMatchObject({ gameId: g1, side: PICKEM_PICK_SIDE.HOME });
  });

  // The picks surfaces render a settled pick's grade, so the read has to carry
  // it. A left join, because the *absence* of a result is the "not settled yet"
  // state (arch D10) — an inner join would drop every unsettled pick instead,
  // which reads to the client as picks that were never made.
  it("carries each pick's outcome once settled, and null until then", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    expect(
      (
        await putPicks(memberA.cookie, league.id, weekId, {
          picks: [
            { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
            { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
            { gameId: g3, side: PICKEM_PICK_SIDE.HOME, spread: null },
          ],
        })
      ).status,
    ).toBe(200);

    const unsettled = (await (
      await getPicks(memberA.cookie, league.id, weekId)
    ).json()) as PickemWeekPicksResponse;
    const beforeEntry = unsettled.members.find((m) => m.userId === memberA.user.id)!;
    expect(beforeEntry.picks).toHaveLength(3);
    expect(beforeEntry.picks.map((pick) => pick.outcome)).toEqual([null, null, null]);

    // One of each grade, so a mis-joined outcome can't coincidentally match.
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 10, awayScore: 24 });
    await setGame(db, g3!, { status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 20 });
    await settlePickemLeagueSeasonWeeks(
      db,
      new FixedClock(new Date("2026-09-20T00:00:00.000Z")),
      leagueSeasonId,
      [weekId],
    );

    const settled = (await (
      await getPicks(memberA.cookie, league.id, weekId, appAfterKickoff)
    ).json()) as PickemWeekPicksResponse;
    const afterEntry = settled.members.find((m) => m.userId === memberA.user.id)!;
    const outcomeByGame = new Map(afterEntry.picks.map((pick) => [pick.gameId, pick.outcome]));
    expect(outcomeByGame.get(g1!)).toBe(PICK_OUTCOME.CORRECT);
    expect(outcomeByGame.get(g2!)).toBe(PICK_OUTCOME.INCORRECT);
    expect(outcomeByGame.get(g3!)).toBe(PICK_OUTCOME.PUSH);
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

  it("excludes a cancelled game from picksAllowed — a 3-game week with 1 cancelled caps at 2", async () => {
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

describe("PUT /api/leagues/:leagueId/pickem/weeks/:weekId/picks", () => {
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

  it("saves the week's full set", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.AWAY, spread: null },
        { gameId: g3, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(res.status).toBe(200);
    const own = ((await res.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!;
    expect(own.picks.map((p) => p.gameId).sort()).toEqual([g1, g2, g3].sort());
    expect(own.picks.find((p) => p.gameId === g2)?.side).toBe(PICKEM_PICK_SIDE.AWAY);
  });

  it("409s already_submitted on a second submission for the same week, leaving the first untouched", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;
    const fullSet = [g1, g2, g3].map((gameId) => ({
      gameId: gameId!,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    }));

    expect((await putPicks(memberA.cookie, league.id, weekId, { picks: fullSet })).status).toBe(
      200,
    );

    // A week is one submission (ADR-0018) — even an identically-sized, legal
    // set is refused, and the sides the member first chose survive.
    const second = await putPicks(memberA.cookie, league.id, weekId, {
      picks: fullSet.map((pick) => ({ ...pick, side: PICKEM_PICK_SIDE.AWAY })),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "already_submitted" });

    const after = await getPicks(memberA.cookie, league.id, weekId);
    const own = ((await after.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!;
    expect(own.picks).toHaveLength(3);
    expect(own.picks.every((p) => p.side === PICKEM_PICK_SIDE.HOME)).toBe(true);
  });

  it("400s pick_set_incomplete when the set is smaller than the week requires", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!;

    // Three pickable, unlocked games and a cap of 5 — two picks is a partial
    // sheet, and a partial sheet can't be topped up later.
    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "pick_set_incomplete" });
    expect(await pickCountFor(league.id)).toBe(0);
  });

  it("400s pick_set_incomplete on an empty submission — there is no way to submit nothing", async () => {
    const { league, weekIds, memberA } = await seedPickemLeague();

    const res = await putPicks(memberA.cookie, league.id, weekIds.get("regular:1")!, { picks: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "pick_set_incomplete" });
  });

  it("lets a member who arrives after the week's first kickoff submit what's still unlocked (ADR-0018)", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [, g2, g3] = gameIds.get("regular:1")!;

    // The week's first game has kicked off; g2 and g3 have not. The required
    // set is what can
    // still be picked — sizing it against picksAllowed (3, since a kicked-off
    // game is still `pickable`) would lock this member out of the week for
    // good, which is the implicit weekly deadline the ADR refuses.
    const res = await putPicks(
      memberA.cookie,
      league.id,
      weekId,
      {
        picks: [
          { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
          { gameId: g3, side: PICKEM_PICK_SIDE.AWAY, spread: null },
        ],
      },
      appAfterKickoff,
    );
    expect(res.status).toBe(200);
    const own = ((await res.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!;
    // g1 is forgone, not owed: it was never a pick, so it scores nothing.
    expect(own.picks.map((p) => p.gameId).sort()).toEqual([g2, g3].sort());
  });

  it("409s pick_locked when a submitted game has already kicked off", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!;

    // A sheet assembled before g1 kicked off: the right size for the slate the
    // member saw, but naming a game that has since locked.
    const res = await putPicks(
      memberA.cookie,
      league.id,
      weekId,
      {
        picks: [
          { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
          { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
        ],
      },
      appAfterKickoff,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pick_locked" });
    expect(await pickCountFor(league.id)).toBe(0);
  });

  it("409s pick_locked exactly at the kickoff instant — the boundary is locked", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!;

    const res = await putPicks(
      memberA.cookie,
      league.id,
      weekId,
      {
        picks: [
          { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
          { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
        ],
      },
      appAtKickoff,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pick_locked" });
  });

  it("re-opens the week when a settings change clears the member's picks, and accepts a fresh full set", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const first = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g3, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(first.status).toBe(200);

    // Raising Picks Per Week strands a submitted member under submit-once —
    // they can never reach the new size — so the reset clears their picks
    // (ADR-0018 decision 1 / ADR-0015 rule 3). That reset is the only path
    // back into a week the member has already submitted.
    const patched = await patchLeague(memberA.cookie, league.id, {
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 8 },
    });
    expect(patched.status).toBe(200);
    expect(await pickCountFor(league.id)).toBe(0);

    const resubmit = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.AWAY, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.AWAY, spread: null },
        { gameId: g3, side: PICKEM_PICK_SIDE.AWAY, spread: null },
      ],
    });
    expect(resubmit.status).toBe(200);
    const own = ((await resubmit.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!;
    expect(own.picks).toHaveLength(3);
    expect(own.picks.every((p) => p.side === PICKEM_PICK_SIDE.AWAY)).toBe(true);
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
    const [g1, g2] = gameIds.get("regular:1")!;
    const week2GameId = gameIds.get("regular:2")![0]!;

    // The right size for week 1, but the third entry references a game from a
    // different week — the whole submission must be refused, and since a
    // member gets only one, a partial write would cost them the week.
    const res = await putPicks(memberA.cookie, league.id, week1Id, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: week2GameId, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "game_not_in_week" });

    expect(await pickCountFor(league.id)).toBe(0);

    // And the week is still open: nothing landed, so nothing was submitted.
    const retry = await putPicks(memberA.cookie, league.id, week1Id, {
      picks: gameIds.get("regular:1")!.map((gameId) => ({
        gameId,
        side: PICKEM_PICK_SIDE.HOME,
        spread: null,
      })),
    });
    expect(retry.status).toBe(200);
  });

  it("400s too_many_picks when the set is larger than the week's required size", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      settings: { ...DEFAULT_PICKEM_SETTINGS, picksPerWeek: 2 },
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g3, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "too_many_picks" });
  });

  it("400s duplicate_pick when the same gameId appears twice", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!;

    // The right number of entries for the week, but only two distinct games.
    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g1, side: PICKEM_PICK_SIDE.AWAY, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "duplicate_pick" });
  });

  it("400s game_not_in_week when a submitted game belongs to a different week", async () => {
    // Both weeks share one season instance so this exercises game_not_in_week
    // specifically, not week_out_of_range (a season mismatch). Week 1 holds a
    // single game, so one entry is the full required set and the refusal can't
    // be confused with a size complaint.
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
        {
          weekNumber: 2,
          kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
        },
      ],
    });
    const week1Id = weekIds.get("regular:1")!;
    const week2GameId = gameIds.get("regular:2")![0]!;

    const res = await putPicks(memberA.cookie, league.id, week1Id, {
      picks: [{ gameId: week2GameId, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "game_not_in_week" });
  });

  it("409s league_concluded when the season's status is concluded", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague({
      status: LEAGUE_STATUS.CONCLUDED,
    });
    const weekId = weekIds.get("regular:1")!;

    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: gameIds.get("regular:1")!.map((gameId) => ({
        gameId,
        side: PICKEM_PICK_SIDE.HOME,
        spread: null,
      })),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "league_concluded" });
  });

  it.each([
    { label: "picks not an array", body: { picks: "nope" } },
    {
      label: "non-uuid gameId",
      body: { picks: [{ gameId: "not-a-uuid", side: PICKEM_PICK_SIDE.HOME, spread: null }] },
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
        picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: -3.5 }],
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
        picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: -4 }],
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "spread_stale" });
    });

    /**
     * The permanent-lockout regression: an unpriced game must not be part of
     * the week's required set.
     *
     * `checkSpreadAccepted` refuses a pick on a game with no line, so counting
     * it left an ATS member with no submission the write path would take —
     * include it and the request 409s `spread_unavailable`, omit it and the
     * same request 400s `pick_set_incomplete`. Once the priced games kicked off
     * they were shut out of the week for good, which is exactly the outcome
     * ADR-0018 decision 2 exists to prevent; it just arrived through
     * "unpriceable" rather than "locked". The rule is a full set of what can
     * still be picked, and the server itself says an unpriced game cannot be.
     */
    it("sizes the required set to the priced games, so an unpriced one can't strand the week", async () => {
      const { seasonId, weekIds, gameIds } = await seedSeason(db, {
        year: 2026,
        weeks: [
          {
            weekNumber: 1,
            kickoffs: [
              { kickoffAt: WEEK1_KICKOFF, spread: -3.5 },
              { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 60 * 1000), spread: 2.5 },
              // Unlocked and playable, but the odds sync hasn't posted a line.
              { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 2 * 60 * 60 * 1000) },
            ],
          },
        ],
      });
      const memberA = await createAuthenticatedUser(auth, { username: "member_a" });
      const league = await insertLeague(db, {
        seasonId,
        settings: ATS_SETTINGS,
        members: [{ userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
      const weekId = weekIds.get("regular:1")!;
      const [g1, g2] = gameIds.get("regular:1")! as [string, string, string];

      const res = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [
          { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: -3.5 },
          { gameId: g2, side: PICKEM_PICK_SIDE.AWAY, spread: 2.5 },
        ],
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as PickemWeekPicksResponse;
      const own = body.members.find((m) => m.userId === memberA.user.id)!;
      expect(own.picks.map((p) => p.gameId).sort()).toEqual([g1, g2].sort());
    });

    /**
     * `spread_unavailable` survives the sizing fix above, and this is the shape
     * it now arrives in: a **correctly sized** set that names an unpriced game
     * instead of one of the priced ones it was sized against.
     *
     * That is a client whose slate disagrees with the server's — a line
     * withdrawn by an odds correction after the sheet was built, or a stale
     * page — and the refusal is what tells it so. The previous version of this
     * test submitted one pick into a week whose only game was unpriced, which
     * now refuses earlier and for a different reason: the required set is zero,
     * so the pick is one too many.
     */
    it("409s spread_unavailable when a right-sized set names an unpriced game", async () => {
      const { seasonId, weekIds, gameIds } = await seedSeason(db, {
        year: 2026,
        weeks: [
          {
            weekNumber: 1,
            kickoffs: [
              { kickoffAt: WEEK1_KICKOFF, spread: -3.5 },
              { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 60 * 1000), spread: 2.5 },
              { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 2 * 60 * 60 * 1000) },
            ],
          },
        ],
      });
      const memberA = await createAuthenticatedUser(auth, { username: "member_a" });
      const league = await insertLeague(db, {
        seasonId,
        settings: ATS_SETTINGS,
        members: [{ userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
      const weekId = weekIds.get("regular:1")!;
      const [g1, , g3] = gameIds.get("regular:1")! as [string, string, string];

      // Two picks, which is exactly the required set — but one of them is the
      // game with no line.
      const res = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [
          { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: -3.5 },
          { gameId: g3, side: PICKEM_PICK_SIDE.HOME, spread: -3.5 },
        ],
      });
      expect(res.status).toBe(409);
      // Distinct from spread_stale: nothing has been posted to accept, so the
      // member waits for the odds sync rather than re-reviewing a new number.
      expect(await res.json()).toMatchObject({ error: "spread_unavailable" });
    });

    /**
     * The other half of the sizing rule: with no line posted anywhere in the
     * week, nothing is submittable yet, so the honest refusal is that the set
     * is oversized rather than that one game lacks a number. The member is not
     * stranded — the odds sync opens the week.
     */
    it("400s too_many_picks when no game in the week has a line yet", async () => {
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
        picks: [{ gameId: g1!, side: PICKEM_PICK_SIDE.HOME, spread: -3.5 }],
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "too_many_picks" });
    });
  });

  it("ignores and nulls out a submitted spread in a straight-up league", async () => {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: -7 },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g3, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemWeekPicksResponse;
    const own = body.members.find((m) => m.userId === memberA.user.id)!;
    expect(own.picks.find((p) => p.gameId === g1)).toMatchObject({ spread: null });
  });
});

describe("PATCH /api/leagues/:leagueId — settings changes reset picks (settings-reset.ts)", () => {
  // Builds a *wire* settings payload: a season-range preset and no week refs
  // (ADR-0020) — the range these edits move is the one the server resolves.
  function settingsWith(overrides: Partial<PickemSettingsInput> = {}): PickemSettingsInput {
    return {
      seasonRangePreset: DEFAULT_PICKEM_SETTINGS.seasonRangePreset,
      pickType: DEFAULT_PICKEM_SETTINGS.pickType,
      picksPerWeek: DEFAULT_PICKEM_SETTINGS.picksPerWeek,
      ...overrides,
    };
  }

  /** One member, one submitted week — the week's full three-game set. */
  async function seedWithSubmittedWeek() {
    const { league, weekIds, gameIds, memberA } = await seedPickemLeague();
    const weekId = weekIds.get("regular:1")!;
    const res = await putPicks(memberA.cookie, league.id, weekId, {
      picks: gameIds.get("regular:1")!.map((gameId) => ({
        gameId,
        side: PICKEM_PICK_SIDE.HOME,
        spread: null,
      })),
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
    // A raise strands picks too under submit-once (ADR-0018): the member has
    // already spent their one submission and would be stuck under the new cap
    // forever. Clearing is the only way back into the week.
    { label: "picksPerWeek is raised", settings: settingsWith({ picksPerWeek: 8 }) },
    {
      // Regular Season → Postseason moves the resolved start past every week
      // the submitted picks live in.
      label: "the season range preset moves the start later",
      settings: settingsWith({ seasonRangePreset: PICKEM_SEASON_RANGE_PRESET.POSTSEASON }),
    },
  ])("clears picks when $label — a change that could strand them", async ({ settings }) => {
    const { league, memberA } = await seedWithSubmittedWeek();

    const res = await patchLeague(memberA.cookie, league.id, { settings });
    expect(res.status).toBe(200);
    expect(await pickCountFor(league.id)).toBe(0);
  });

  it.each([
    {
      // Regular Season → Full Season keeps the same resolved start and pushes
      // the end out: every existing pick still sits in a week the league plays.
      label: "the season range preset moves the end later",
      settings: settingsWith({ seasonRangePreset: PICKEM_SEASON_RANGE_PRESET.FULL_SEASON }),
    },
  ])("keeps picks when $label — nothing is stranded", async ({ settings }) => {
    const { league, memberA } = await seedWithSubmittedWeek();

    const res = await patchLeague(memberA.cookie, league.id, { settings });
    expect(res.status).toBe(200);
    expect(await pickCountFor(league.id)).toBe(3);
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
      seasonRangePreset: DEFAULT_PICKEM_SETTINGS.seasonRangePreset,
      startWeek: DEFAULT_PICKEM_SETTINGS.startWeek,
      endWeek: DEFAULT_PICKEM_SETTINGS.endWeek,
      pickType: DEFAULT_PICKEM_SETTINGS.pickType,
    };
    await db
      .update(leagueSeasons)
      .set({ settings: withoutPicksPerWeek as unknown as PickemSettings })
      .where(eq(leagueSeasons.leagueId, league.id));

    const picks = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g3, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(picks.status).toBe(200);

    const res = await patchLeague(memberA.cookie, league.id, {
      settings: settingsWith({ picksPerWeek: 1 }),
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
      picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(pickRes.status).toBe(200);

    // g1's kickoff (WEEK1_KICKOFF) is now in the past under this clock — the
    // pick is locked, but the league itself never left "pre-start".
    const patchRes = await patchLeague(
      memberA.cookie,
      league.id,
      { settings: settingsWith({ pickType: PICK_TYPE.AGAINST_THE_SPREAD }) },
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

describe("GET /api/leagues/:leagueId/pickem/pick-summary", () => {
  it("401s without a session", async () => {
    const { league } = await seedPickemLeague();
    const res = await getPickSummary(undefined, league.id);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("404s a non-member and an unknown league — private leagues stay hidden either way", async () => {
    const { league, memberA } = await seedPickemLeague();
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });

    const nonMember = await getPickSummary(outsider.cookie, league.id);
    expect(nonMember.status).toBe(404);
    expect(await nonMember.json()).toMatchObject({ error: "league_not_found" });

    const unknownLeague = await getPickSummary(memberA.cookie, randomUUID());
    expect(unknownLeague.status).toBe(404);
    expect(await unknownLeague.json()).toMatchObject({ error: "league_not_found" });
  });

  it("400s wrong_league_mode for a survivor league", async () => {
    const { seasonId, memberA } = await seedPickemLeague();
    const league = await insertLeague(db, {
      seasonId,
      mode: LEAGUE_MODE.SURVIVOR,
      settings: {
        startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
        pickType: PICK_TYPE.STRAIGHT_UP,
        pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
      },
      members: [{ userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await getPickSummary(memberA.cookie, league.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "wrong_league_mode" });
  });

  it("403s not_commissioner for a member who isn't a commissioner — same gate the settings PATCH uses", async () => {
    const { league, memberB } = await seedPickemLeague();

    const res = await getPickSummary(memberB.cookie, league.id);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_commissioner" });
  });

  it("counts picks and distinct members on the current season — a zero-pick member doesn't inflate memberCount", async () => {
    const { league, weekIds, gameIds, memberA, memberB } = await seedPickemLeague({
      weeks: FOUR_GAME_WEEK,
    });
    const seasonId = (
      await db.select().from(leagueSeasons).where(eq(leagueSeasons.leagueId, league.id))
    )[0]!.id;
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")! as [string, string, string];

    // memberA picks two games, memberB picks one, and a third member never
    // submits — memberCount must read 2 (distinct pickers), not 3 (roster
    // size) or 3 (total pick rows).
    const memberC = await createAuthenticatedUser(auth, { username: "member_c" });
    await db.insert(leagueMembers).values({
      leagueId: league.id,
      userId: memberC.user.id,
      role: MEMBER_ROLE.MEMBER,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    });
    const membersByUser = await membersOf(db, league.id);

    await insertPick(db, {
      leagueSeasonId: seasonId,
      leagueMemberId: membersByUser.get(memberA.user.id)!,
      weekId,
      gameId: g1,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId: seasonId,
      leagueMemberId: membersByUser.get(memberA.user.id)!,
      weekId,
      gameId: g2,
      side: PICKEM_PICK_SIDE.AWAY,
    });
    await insertPick(db, {
      leagueSeasonId: seasonId,
      leagueMemberId: membersByUser.get(memberB.user.id)!,
      weekId,
      gameId: g3,
      side: PICKEM_PICK_SIDE.HOME,
    });

    const res = await getPickSummary(memberA.cookie, league.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pickCount: 3, memberCount: 2 });
  });

  it("reads 0/0 for a league with no picks yet", async () => {
    const { league, memberA } = await seedPickemLeague();

    const res = await getPickSummary(memberA.cookie, league.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pickCount: 0, memberCount: 0 });
  });

  it("counts only the current season instance's picks, not a prior (renewed) season's — same scope as resetPicksInvalidatedBySettings", async () => {
    // Two league_seasons rows on one league, following the multi-season
    // fixture shape leagues.test.ts's `addSeasonInstance` uses: a second
    // sport season year, a second `league_seasons` row inserted directly
    // (bypassing the renewal endpoint), which `getLeagueWithCurrentSeason`
    // then picks as "current" for having the greater season year.
    const priorBase = await seedPickemLeagueBase(db, auth, {
      year: 2026,
      weeks: FOUR_GAME_WEEK,
      members: [{ username: "member_a" }, { username: "member_b" }],
    });
    const [memberA] = priorBase.users;
    const priorWeekId = priorBase.weekIds.get("regular:1")!;
    const [priorGame1, priorGame2] = priorBase.gameIds.get("regular:1")!;
    await insertPick(db, {
      leagueSeasonId: priorBase.leagueSeasonId,
      leagueMemberId: priorBase.members.get(memberA!.user.id)!,
      weekId: priorWeekId,
      gameId: priorGame1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId: priorBase.leagueSeasonId,
      leagueMemberId: priorBase.members.get(memberA!.user.id)!,
      weekId: priorWeekId,
      gameId: priorGame2!,
      side: PICKEM_PICK_SIDE.AWAY,
    });

    const {
      seasonId: currentSeasonId,
      weekIds: currentWeekIds,
      gameIds: currentGameIds,
    } = await seedSeason(db, { year: 2027, weeks: FOUR_GAME_WEEK });
    const [currentInstance] = await db
      .insert(leagueSeasons)
      .values({
        leagueId: priorBase.league.id,
        seasonId: currentSeasonId,
        settings: DEFAULT_PICKEM_SETTINGS,
        status: LEAGUE_STATUS.ACTIVE,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      })
      .returning();
    const currentLeagueSeasonId = currentInstance!.id;

    const currentWeekId = currentWeekIds.get("regular:1")!;
    const [currentGame] = currentGameIds.get("regular:1")!;
    await insertPick(db, {
      leagueSeasonId: currentLeagueSeasonId,
      leagueMemberId: priorBase.members.get(memberA!.user.id)!,
      weekId: currentWeekId,
      gameId: currentGame!,
      side: PICKEM_PICK_SIDE.HOME,
    });

    const res = await getPickSummary(memberA!.cookie, priorBase.league.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pickCount: 1, memberCount: 1 });
  });
});
