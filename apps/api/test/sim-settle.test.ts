import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { games, pickemPickResults, pickemPicks, pickemStandings } from "@picksleagues/db";
import {
  GAME_STATUS,
  MEMBER_ROLE,
  PICKEM_PICK_SIDE,
  type SimSettleResponse,
} from "@picksleagues/schemas";
import { adminCaller, auth, closeSimDb, db, postJson } from "./setup/sim-helpers";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, SEED_AT, seedSeason } from "./setup/league-helpers";
import { seedPickemLeague } from "./setup/pickem-league";
import { resetDb } from "./setup/reset-db";

const PAST_KICKOFF = new Date("2026-09-14T17:00:00.000Z");

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeSimDb();
});

/**
 * A 2-member Pick'em league with one settled week: two final games, one pick
 * each per member, arranged so member A sweeps both (2 pts) and member B
 * misses both (0 pts) — a clean rank split for idempotency/scoping assertions.
 */
async function seedSettleableLeague(opts: { leagueName?: string; seasonYear?: number } = {}) {
  const base = await seedPickemLeague(db, auth, {
    year: opts.seasonYear ?? 2026,
    leagueName: opts.leagueName ?? "Test League",
    weeks: [
      {
        weekNumber: 1,
        kickoffs: [{ kickoffAt: PAST_KICKOFF }, { kickoffAt: PAST_KICKOFF }],
      },
    ],
    members: [{}, {}],
  });

  const memberARow = { id: base.members.get(base.users[0]!.user.id)! };
  const memberBRow = { id: base.members.get(base.users[1]!.user.id)! };

  const weekId = base.weekIds.get("regular:1")!;
  const [g1, g2] = base.gameIds.get("regular:1") as [string, string];

  // g1: home wins 24-17. g2: away wins 20-10.
  await db
    .update(games)
    .set({ status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 })
    .where(eq(games.id, g1));
  await db
    .update(games)
    .set({ status: GAME_STATUS.FINAL, homeScore: 10, awayScore: 20 })
    .where(eq(games.id, g2));

  await db.insert(pickemPicks).values([
    // Member A picks the winner of both games.
    {
      leagueSeasonId: base.leagueSeasonId,
      leagueMemberId: memberARow.id,
      weekId,
      gameId: g1,
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: null,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    },
    {
      leagueSeasonId: base.leagueSeasonId,
      leagueMemberId: memberARow.id,
      weekId,
      gameId: g2,
      side: PICKEM_PICK_SIDE.AWAY,
      spreadAtPick: null,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    },
    // Member B picks the loser of both games.
    {
      leagueSeasonId: base.leagueSeasonId,
      leagueMemberId: memberBRow.id,
      weekId,
      gameId: g1,
      side: PICKEM_PICK_SIDE.AWAY,
      spreadAtPick: null,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    },
    {
      leagueSeasonId: base.leagueSeasonId,
      leagueMemberId: memberBRow.id,
      weekId,
      gameId: g2,
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: null,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    },
  ]);

  return {
    league: base.league,
    leagueSeasonId: base.leagueSeasonId,
    weekId,
    memberARow,
    memberBRow,
    gameIds: [g1, g2] as [string, string],
  };
}

describe("POST /api/sim/settle", () => {
  it("an unknown leagueId 404s with league_not_found", async () => {
    const { app, cookie } = await adminCaller();

    const res = await postJson(
      app,
      "/api/sim/settle",
      { leagueId: "00000000-0000-4000-8000-000000000000" },
      cookie,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "league_not_found" });
  });

  it("settles one league: writes pickem_pick_results and ranks season standings by points", async () => {
    const { app, cookie } = await adminCaller();
    const { league, leagueSeasonId, memberARow, memberBRow } = await seedSettleableLeague();

    const res = await postJson(app, "/api/sim/settle", { leagueId: league.id }, cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SimSettleResponse;
    expect(body.leagues).toHaveLength(1);
    const result = body.leagues[0]!;
    expect(result.leagueId).toBe(league.id);
    expect(result.leagueSeasonId).toBe(leagueSeasonId);
    expect(result.summary.results).toBe(4);
    expect(result.summary.unsettled).toBe(0);

    expect(result.seasonStandings).toEqual([
      expect.objectContaining({ leagueMemberId: memberARow.id, points: 2, rank: 1 }),
      expect.objectContaining({ leagueMemberId: memberBRow.id, points: 0, rank: 2 }),
    ]);
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0]!.results).toBe(4);
    expect(result.weeks[0]!.standings).toEqual(result.seasonStandings);

    const storedResults = await db
      .select()
      .from(pickemPickResults)
      .where(eq(pickemPickResults.leagueSeasonId, leagueSeasonId));
    expect(storedResults).toHaveLength(4);
  });

  it("is idempotent: settling twice yields identical standings and unchanged row counts", async () => {
    const { app, cookie } = await adminCaller();
    const { league, leagueSeasonId } = await seedSettleableLeague();

    const first = await postJson(app, "/api/sim/settle", { leagueId: league.id }, cookie);
    const firstBody = (await first.json()) as SimSettleResponse;

    const second = await postJson(app, "/api/sim/settle", { leagueId: league.id }, cookie);
    const secondBody = (await second.json()) as SimSettleResponse;

    expect(secondBody.leagues[0]!.seasonStandings).toEqual(firstBody.leagues[0]!.seasonStandings);
    expect(secondBody.leagues[0]!.weeks).toEqual(firstBody.leagues[0]!.weeks);

    const resultRows = await db
      .select()
      .from(pickemPickResults)
      .where(eq(pickemPickResults.leagueSeasonId, leagueSeasonId));
    expect(resultRows).toHaveLength(4);
    const standingsRows = await db
      .select()
      .from(pickemStandings)
      .where(eq(pickemStandings.leagueSeasonId, leagueSeasonId));
    // One season row + one weekly row per member (2 members).
    expect(standingsRows).toHaveLength(4);
  });

  it("omitted leagueId settles every active league; a supplied one scopes to that league only", async () => {
    const { app, cookie } = await adminCaller();
    const a = await seedSettleableLeague({ leagueName: "Alpha League", seasonYear: 2026 });
    const b = await seedSettleableLeague({ leagueName: "Beta League", seasonYear: 2027 });

    const globalRes = await postJson(app, "/api/sim/settle", {}, cookie);
    expect(globalRes.status).toBe(200);
    const globalBody = (await globalRes.json()) as SimSettleResponse;
    expect(globalBody.leagues.map((l) => l.leagueId).sort()).toEqual(
      [a.league.id, b.league.id].sort(),
    );
    // Ordered by league name.
    expect(globalBody.leagues.map((l) => l.leagueName)).toEqual(["Alpha League", "Beta League"]);

    const bStandingsBefore = await db
      .select()
      .from(pickemStandings)
      .where(eq(pickemStandings.leagueSeasonId, b.leagueSeasonId));

    // Flip both leagues' g1 result — member B now sweeps instead of member A —
    // then settle only league A. Only its stored standings should move.
    for (const target of [a, b]) {
      await db
        .update(games)
        .set({ homeScore: 3, awayScore: 30 })
        .where(eq(games.id, target.gameIds[0]));
    }

    const scopedRes = await postJson(app, "/api/sim/settle", { leagueId: a.league.id }, cookie);
    expect(scopedRes.status).toBe(200);
    const scopedBody = (await scopedRes.json()) as SimSettleResponse;
    expect(scopedBody.leagues).toHaveLength(1);
    expect(scopedBody.leagues[0]!.leagueId).toBe(a.league.id);
    // Member A no longer sweeps g1 (home lost 3-30) — now tied 1-1 on points,
    // with member B ranked ahead on the differential tiebreaker.
    const byMember = new Map(
      scopedBody.leagues[0]!.seasonStandings.map((row) => [row.leagueMemberId, row]),
    );
    expect(byMember.get(a.memberARow.id)).toMatchObject({ points: 1, rank: 2 });
    expect(byMember.get(a.memberBRow.id)).toMatchObject({ points: 1, rank: 1 });

    const bStandingsAfter = await db
      .select()
      .from(pickemStandings)
      .where(eq(pickemStandings.leagueSeasonId, b.leagueSeasonId));
    expect(bStandingsAfter).toEqual(bStandingsBefore);
  });

  it("a league with no picks yet returns a season board with every member at zero", async () => {
    const { app, cookie } = await adminCaller();
    const { seasonId } = await seedSeason(db, {
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: PAST_KICKOFF }] }],
    });
    const memberA = await createAuthenticatedUser(auth, { username: "no_picks_a" });
    const memberB = await createAuthenticatedUser(auth, { username: "no_picks_b" });
    const league = await insertLeague(db, {
      seasonId,
      members: [
        { userId: memberA.user.id, role: MEMBER_ROLE.COMMISSIONER },
        { userId: memberB.user.id, role: MEMBER_ROLE.MEMBER },
      ],
    });

    const res = await postJson(app, "/api/sim/settle", { leagueId: league.id }, cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SimSettleResponse;
    const result = body.leagues[0]!;
    expect(result.summary).toEqual({
      leagueSeasons: 1,
      weeks: 0,
      results: 0,
      unsettled: 0,
      failed: 0,
    });
    expect(result.weeks).toEqual([]);
    expect(result.seasonStandings).toHaveLength(2);
    for (const row of result.seasonStandings) {
      expect(row.points).toBe(0);
      expect(row.differential).toBe(0);
      expect(row.rank).toBe(1);
    }
  });
});
