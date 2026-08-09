import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { games, pickemPickResults, pickemPicks, pickemStandings } from "@picksleagues/db";
import {
  GAME_STATUS,
  LEAGUE_MODE,
  MEMBER_ROLE,
  PICKEM_PICK_SIDE,
  SURVIVOR_MEMBER_STATUS,
  type SimSettleLeagueResult,
  type SimSettleResponse,
} from "@picksleagues/schemas";
import { adminCaller, auth, closeSimDb, db, postJson } from "./setup/sim-helpers";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, SEED_AT, seedSeason } from "./setup/league-helpers";
import { seedPickemLeague } from "./setup/pickem-league";
import {
  insertSurvivorPick,
  seedSurvivorGame,
  seedSurvivorSeason,
  SURVIVOR_WEEK_MS,
} from "./setup/survivor-league";
import { WEEK1_KICKOFF } from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const PAST_KICKOFF = new Date("2026-09-14T17:00:00.000Z");

/**
 * Narrow the board union to the mode under test. The throw is the point: a
 * league that came back in another mode's shape is the SIM-10 defect itself, so
 * it must fail the test rather than quietly yield `undefined` fields.
 */
function pickemBoard(result: SimSettleLeagueResult) {
  const { board } = result;
  if (board.mode !== LEAGUE_MODE.PICKEM)
    throw new Error(`expected a pickem board, got ${board.mode}`);
  return board;
}

function survivorBoard(result: SimSettleLeagueResult) {
  const { board } = result;
  if (board.mode !== LEAGUE_MODE.SURVIVOR)
    throw new Error(`expected a survivor board, got ${board.mode}`);
  return board;
}

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

    const board = pickemBoard(result);
    expect(board.seasonStandings).toEqual([
      expect.objectContaining({ leagueMemberId: memberARow.id, points: 2, rank: 1 }),
      expect.objectContaining({ leagueMemberId: memberBRow.id, points: 0, rank: 2 }),
    ]);
    expect(board.weeks).toHaveLength(1);
    expect(board.weeks[0]!.results).toBe(4);
    expect(board.weeks[0]!.standings).toEqual(board.seasonStandings);

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

    expect(pickemBoard(secondBody.leagues[0]!)).toEqual(pickemBoard(firstBody.leagues[0]!));

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
    // Member A no longer sweeps g1 (home lost 3-30), so the two are level on
    // points and share the rank — points are the only ordering input
    // (ADR-0018). The assertion that matters here is that league B's stored
    // board did not move at all.
    const byMember = new Map(
      pickemBoard(scopedBody.leagues[0]!).seasonStandings.map((row) => [row.leagueMemberId, row]),
    );
    expect(byMember.get(a.memberARow.id)).toMatchObject({ points: 1, rank: 1 });
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
    const board = pickemBoard(result);
    expect(board.weeks).toEqual([]);
    expect(board.seasonStandings).toHaveLength(2);
    for (const row of board.seasonStandings) {
      expect(row.points).toBe(0);
      expect(row.rank).toBe(1);
    }
  });
});

/**
 * SIM-10: the read-back serves each mode the tables it actually writes. Before
 * it did, every case below came back as an empty `pickem_standings` board, which
 * an operator cannot tell apart from a settle that graded nothing.
 */
describe("POST /api/sim/settle — Survivor", () => {
  it("reports the ledger: who is alive, who went out, and in which week", async () => {
    const { app, cookie } = await adminCaller();
    const season = await seedSurvivorSeason(db, auth, {
      weekCount: 2,
      memberCount: 3,
      usernamePrefix: "ledger",
    });
    const [week1, week2] = season.weeks as [
      (typeof season.weeks)[number],
      (typeof season.weeks)[number],
    ];
    const [alive, outLate, outEarly] = season.memberIds as [string, string, string];

    for (const week of [week1, week2]) {
      await db
        .update(games)
        .set({ status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 })
        .where(eq(games.id, week.gameId));
    }

    // Week 1 puts `outEarly` out; week 2 reduces the league to `alive`, which is
    // where ADR-0027 stops the replay.
    for (const [memberId, teamId] of [
      [alive, week1.homeTeamId],
      [outLate, week1.homeTeamId],
      [outEarly, week1.awayTeamId],
    ] as const) {
      await insertSurvivorPick(db, {
        leagueSeasonId: season.leagueSeasonId,
        leagueMemberId: memberId,
        weekId: week1.weekId,
        gameId: week1.gameId,
        teamId,
      });
    }
    for (const [memberId, teamId] of [
      [alive, week2.homeTeamId],
      [outLate, week2.awayTeamId],
    ] as const) {
      await insertSurvivorPick(db, {
        leagueSeasonId: season.leagueSeasonId,
        leagueMemberId: memberId,
        weekId: week2.weekId,
        gameId: week2.gameId,
        teamId,
      });
    }

    const res = await postJson(app, "/api/sim/settle", { leagueId: season.league.id }, cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SimSettleResponse;
    const board = survivorBoard(body.leagues[0]!);

    // Addressed by member rather than by index: the fixture gives every member
    // the same display name, so the order among the eliminated two is a tie the
    // response is free to break either way.
    const byMember = new Map(board.members.map((member) => [member.leagueMemberId, member]));
    expect(byMember.get(alive)).toMatchObject({
      status: SURVIVOR_MEMBER_STATUS.ALIVE,
      eliminatedWeekId: null,
      livesRemaining: 1,
      revivedCount: 0,
    });
    expect(byMember.get(outLate)).toMatchObject({
      status: SURVIVOR_MEMBER_STATUS.ELIMINATED,
      eliminatedWeekId: week2.weekId,
      livesRemaining: 0,
    });
    expect(byMember.get(outEarly)).toMatchObject({
      status: SURVIVOR_MEMBER_STATUS.ELIMINATED,
      eliminatedWeekId: week1.weekId,
      livesRemaining: 0,
    });
    // The one ordering guarantee worth pinning: whoever is left comes first.
    expect(board.members[0]!.leagueMemberId).toBe(alive);

    expect(board.weeks.map((week) => week.weekId)).toEqual([week1.weekId, week2.weekId]);
    expect(board.weeks[0]).toMatchObject({ results: 3, eliminatedMemberIds: [outEarly] });
    expect(board.weeks[1]).toMatchObject({ results: 2, eliminatedMemberIds: [outLate] });
  });

  it("lists a week that eliminated a member without grading any results (ADR-0028)", async () => {
    const { app, cookie } = await adminCaller();
    const season = await seedSurvivorSeason(db, auth, {
      weekCount: 1,
      memberCount: 3,
      usernamePrefix: "provisional",
    });
    const week = season.weeks[0]!;
    const [safe, busted, waiting] = season.memberIds as [string, string, string];

    // One game decided, one still to play: the week cannot be graded as a unit,
    // so it writes no result rows — but `safe` is confirmed through, which puts
    // `busted` out for good.
    await db
      .update(games)
      .set({ status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 })
      .where(eq(games.id, week.gameId));
    const openGame = await seedSurvivorGame(db, {
      weekId: week.weekId,
      kickoffAt: new Date(WEEK1_KICKOFF.getTime() + SURVIVOR_WEEK_MS),
    });

    for (const [memberId, gameId, teamId] of [
      [safe, week.gameId, week.homeTeamId],
      [busted, week.gameId, week.awayTeamId],
      [waiting, openGame.gameId, openGame.homeTeamId],
    ] as const) {
      await insertSurvivorPick(db, {
        leagueSeasonId: season.leagueSeasonId,
        leagueMemberId: memberId,
        weekId: week.weekId,
        gameId,
        teamId,
      });
    }

    const res = await postJson(app, "/api/sim/settle", { leagueId: season.league.id }, cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SimSettleResponse;
    const result = body.leagues[0]!;
    const board = survivorBoard(result);

    expect(result.summary.results).toBe(0);
    // The week is the operator's whole question here, so it must be listed even
    // though nothing graded — keying the list on result rows alone would drop it.
    expect(board.weeks).toHaveLength(1);
    expect(board.weeks[0]).toMatchObject({
      weekId: week.weekId,
      results: 0,
      eliminatedMemberIds: [busted],
    });
    expect(
      board.members
        .filter((member) => member.status === SURVIVOR_MEMBER_STATUS.ALIVE)
        .map((m) => m.leagueMemberId)
        .sort(),
    ).toEqual([safe, waiting].sort());
  });

  it("a season with nothing settled yet reports every member alive, not an empty board", async () => {
    const { app, cookie } = await adminCaller();
    const season = await seedSurvivorSeason(db, auth, {
      weekCount: 1,
      memberCount: 2,
      usernamePrefix: "untouched",
    });

    const res = await postJson(app, "/api/sim/settle", { leagueId: season.league.id }, cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SimSettleResponse;
    const board = survivorBoard(body.leagues[0]!);

    // Nothing mints a `survivor_state` row at join time (ADR-0025), so these
    // members exist only in `league_members` — an inner join would report the
    // empty board SIM-10 exists to remove.
    expect(board.members).toHaveLength(2);
    for (const member of board.members) {
      expect(member).toMatchObject({
        status: SURVIVOR_MEMBER_STATUS.ALIVE,
        eliminatedWeekId: null,
        livesRemaining: 1,
        revivedCount: 0,
      });
    }
    expect(board.weeks).toEqual([]);
  });
});
