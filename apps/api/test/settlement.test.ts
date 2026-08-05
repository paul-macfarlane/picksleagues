import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueSeasons, oddsSnapshots, pickemPicks } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  GAME_STATUS,
  LEAGUE_STATUS,
  PICK_OUTCOME,
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  type JobRunResponse,
  type PickemSettings,
} from "@picksleagues/schemas";
import { createApp } from "../src/app";
import {
  rebuildLeagueSeason,
  settlePicksForGames,
  settleLeagueSeasonWeeks,
  settleSweep,
} from "../src/services/pickem/settlement";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import {
  DEFAULT_PICKEM_SETTINGS,
  insertPick,
  pickResultsFor,
  setGame,
  standingsFor,
  type SeededWeek,
} from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF, withCookie } from "./setup/league-app";
import { seedPickemLeague as seedPickemLeagueBase } from "./setup/pickem-league";
import { resetDb } from "./setup/reset-db";
import { makeTestEnv } from "./setup/test-env";

const { db, auth, app } = makeLeagueTestHarness();

/** One league season + one 1-game week — the minimal slate most cases need. */
const ONE_GAME_WEEK: SeededWeek[] = [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }];

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

/**
 * Comparable snapshots of `pickem_pick_results`/`pickem_standings` rows, `id` (and the
 * write-time stamp) excluded — a delete-then-insert rebuild mints fresh row
 * ids every run, and this file's idempotency tests all reuse one `FixedClock`
 * instance, so `settledAt`/`updatedAt` are already stable, but the id
 * wouldn't be even then.
 */
function snapshotResults(rows: Awaited<ReturnType<typeof pickResultsFor>>) {
  return [...rows]
    .sort((a, b) => a.pickemPickId.localeCompare(b.pickemPickId))
    .map((row) => ({
      leagueSeasonId: row.leagueSeasonId,
      leagueMemberId: row.leagueMemberId,
      weekId: row.weekId,
      outcome: row.outcome,
      points: row.points,
    }));
}

function snapshotStandings(rows: Awaited<ReturnType<typeof standingsFor>>) {
  return [...rows]
    .sort((a, b) =>
      `${a.weekId ?? ""}:${a.leagueMemberId}`.localeCompare(
        `${b.weekId ?? ""}:${b.leagueMemberId}`,
      ),
    )
    .map((row) => ({
      leagueSeasonId: row.leagueSeasonId,
      leagueMemberId: row.leagueMemberId,
      weekId: row.weekId,
      points: row.points,
      wins: row.wins,
      losses: row.losses,
      pushes: row.pushes,
      rank: row.rank,
    }));
}

/**
 * One league season + members, seeded via the shared `seedPickemLeague`
 * builder. `year` only needs overriding when a single test seeds more than
 * one independent league — `seedSeason`'s (sport, year) unique constraint
 * (ADR-0010) means two calls at the same default year collide.
 */
async function seedLeagueForSettlement(
  opts: {
    settings?: PickemSettings;
    weeks?: SeededWeek[];
    memberCount?: number;
    status?: (typeof LEAGUE_STATUS)[keyof typeof LEAGUE_STATUS];
    year?: number;
  } = {},
) {
  const { settings, weeks = ONE_GAME_WEEK, memberCount = 2, status, year } = opts;
  return seedPickemLeagueBase(db, auth, {
    weeks,
    settings,
    status,
    year,
    members: Array.from({ length: memberCount }, (_, i) => ({
      username: `member_${i}_${randomUUID().slice(0, 8)}`,
    })),
  });
}

/**
 * One member holding a win, a loss, and a push in a single week, plus a second
 * member who picked nothing — the smallest slate that exercises all three
 * standings counts and their zero-fill.
 */
async function seedThreeOutcomeWeek() {
  const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement({
    weeks: [
      {
        weekNumber: 1,
        kickoffs: [
          { kickoffAt: WEEK1_KICKOFF },
          { kickoffAt: WEEK1_KICKOFF },
          { kickoffAt: WEEK1_KICKOFF },
        ],
      },
    ],
  });
  const weekId = weekIds.get("regular:1")!;
  const [g1, g2, g3] = gameIds.get("regular:1")!;
  const picker = members.get(users[0]!.user.id)!;
  const nonPicker = members.get(users[1]!.user.id)!;

  for (const gameId of [g1!, g2!, g3!]) {
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: picker,
      weekId,
      gameId,
      side: PICKEM_PICK_SIDE.HOME,
    });
  }

  await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 }); // correct, +14
  await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 10, awayScore: 24 }); // incorrect, -14
  await setGame(db, g3!, { status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 20 }); // push

  return { leagueSeasonId, weekId, picker, nonPicker };
}

describe("settleLeagueSeasonWeeks — results correctness", () => {
  it("grades a straight-up week's correct/incorrect/push picks", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement({
      weeks: [
        {
          weekNumber: 1,
          kickoffs: [
            { kickoffAt: WEEK1_KICKOFF },
            { kickoffAt: WEEK1_KICKOFF },
            { kickoffAt: WEEK1_KICKOFF },
          ],
        },
      ],
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g2!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g3!,
      side: PICKEM_PICK_SIDE.HOME,
    });

    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 }); // home wins by 14
    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 10, awayScore: 24 }); // home loses by 14
    await setGame(db, g3!, { status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 20 }); // tie

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const results = await pickResultsFor(db, leagueSeasonId);
    const byGame = new Map(results.map((row) => [row.pickemPickId, row]));
    const byGameId = new Map(
      (
        await db.select().from(pickemPicks).where(eq(pickemPicks.leagueSeasonId, leagueSeasonId))
      ).map((pick) => [pick.gameId, byGame.get(pick.id)!]),
    );

    expect(byGameId.get(g1!)).toMatchObject({ outcome: PICK_OUTCOME.CORRECT, points: 1 });
    expect(byGameId.get(g2!)).toMatchObject({ outcome: PICK_OUTCOME.INCORRECT, points: 0 });
    expect(byGameId.get(g3!)).toMatchObject({ outcome: PICK_OUTCOME.PUSH, points: 0.5 });
  });

  it("grades an ATS pick against spread_at_pick, not the latest odds snapshot", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement({
      settings: { ...DEFAULT_PICKEM_SETTINGS, pickType: PICK_TYPE.AGAINST_THE_SPREAD },
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF, spread: -3.5 }] }],
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    // Pick locked in at the -3.5 spread.
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: -3.5,
    });

    // A later, materially different snapshot lands after the pick — settlement
    // must not re-read it (loadWeekInputs never queries odds_snapshots at all;
    // this snapshot proves it structurally can't, not just that it happens not
    // to). Home wins by 4: against -3.5 that's a 0.5-point cover (correct);
    // against the newer -9 it would be a loss.
    await db.insert(oddsSnapshots).values({
      gameId: g1!,
      spread: -9,
      capturedAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 1000),
      createdAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 1000),
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 20 });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const [result] = await pickResultsFor(db, leagueSeasonId);
    expect(result).toMatchObject({ outcome: PICK_OUTCOME.CORRECT });
  });

  it("resolves a cancelled game's pick as a push", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const [result] = await pickResultsFor(db, leagueSeasonId);
    expect(result).toMatchObject({ outcome: PICK_OUTCOME.PUSH, points: 0.5 });
  });

  it("resolves a pick as a push when its game has moved to another week, even if that game is final with scores", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement({
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
        {
          weekNumber: 2,
          kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
        },
      ],
    });
    const week1Id = weekIds.get("regular:1")!;
    const week2Id = weekIds.get("regular:2")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    // The pick keeps week 1 (the week it was made in); the game itself moves.
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId: week1Id,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, {
      status: GAME_STATUS.FINAL,
      homeScore: 30,
      awayScore: 10,
      weekId: week2Id,
    });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [week1Id]);

    const [result] = await pickResultsFor(db, leagueSeasonId);
    expect(result).toMatchObject({ outcome: PICK_OUTCOME.PUSH });
  });

  it("an override_status of final outranks a synthesized week move, but an unoverridden moved game still resolves as a push", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement({
      weeks: [
        {
          weekNumber: 1,
          kickoffs: [{ kickoffAt: WEEK1_KICKOFF }, { kickoffAt: WEEK1_KICKOFF }],
        },
        {
          weekNumber: 2,
          kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
        },
      ],
    });
    const week1Id = weekIds.get("regular:1")!;
    const week2Id = weekIds.get("regular:2")!;
    const [g1, g2] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    // Both picks were made in week 1; both games have since been repointed to
    // week 2 — g1 carries an admin override that must outrank the synthesized
    // `moved` status (arch D15: override_* ?? provider_*), g2 doesn't.
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId: week1Id,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId: week1Id,
      gameId: g2!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, {
      status: GAME_STATUS.SCHEDULED,
      weekId: week2Id,
      overrideStatus: GAME_STATUS.FINAL,
      overrideHomeScore: 30,
      overrideAwayScore: 10,
    });
    await setGame(db, g2!, {
      status: GAME_STATUS.FINAL,
      homeScore: 30,
      awayScore: 10,
      weekId: week2Id,
    });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [week1Id]);

    const results = await pickResultsFor(db, leagueSeasonId);
    const picks = await db
      .select()
      .from(pickemPicks)
      .where(eq(pickemPicks.leagueSeasonId, leagueSeasonId));
    const byGame = new Map(
      picks.map((pick) => [pick.gameId, results.find((row) => row.pickemPickId === pick.id)!]),
    );

    expect(byGame.get(g1!)).toMatchObject({ outcome: PICK_OUTCOME.CORRECT });
    expect(byGame.get(g2!)).toMatchObject({ outcome: PICK_OUTCOME.PUSH });
  });

  it("prefers override_home_score/override_away_score over the provider score", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    // Provider score says home lost by 10; the override flips it to a home win.
    await setGame(db, g1!, {
      status: GAME_STATUS.FINAL,
      homeScore: 10,
      awayScore: 20,
      overrideHomeScore: 30,
      overrideAwayScore: 20,
    });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const [result] = await pickResultsFor(db, leagueSeasonId);
    expect(result).toMatchObject({ outcome: PICK_OUTCOME.CORRECT });
  });

  it("an override_status of cancelled turns a final game's pick into a push", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, {
      status: GAME_STATUS.FINAL,
      homeScore: 30,
      awayScore: 10,
      overrideStatus: GAME_STATUS.CANCELLED,
    });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const [result] = await pickResultsFor(db, leagueSeasonId);
    expect(result).toMatchObject({ outcome: PICK_OUTCOME.PUSH });
  });

  it("produces no pickem_pick_results row for a pick on a still-scheduled game", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    const summary = await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    expect(summary.results).toBe(0);
    expect(summary.unsettled).toBe(1);
    expect(await pickResultsFor(db, leagueSeasonId)).toHaveLength(0);
  });

  it("produces no row (and doesn't throw) for a final game with null scores", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL }); // no scores

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    const summary = await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    expect(summary.results).toBe(0);
    expect(summary.unsettled).toBe(1);
    expect(await pickResultsFor(db, leagueSeasonId)).toHaveLength(0);
  });
});

describe("settleLeagueSeasonWeeks — standings", () => {
  it("writes both a weekly row (week_id set) and a season row (week_id null)", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const rows = await standingsFor(db, leagueSeasonId);
    const weekly = rows.filter((row) => row.weekId === weekId);
    const season = rows.filter((row) => row.weekId === null);
    expect(weekly).toHaveLength(2); // both members, including the non-picker
    expect(season).toHaveLength(2);
    const weeklyWinner = weekly.find((row) => row.leagueMemberId === memberId)!;
    const seasonWinner = season.find((row) => row.leagueMemberId === memberId)!;
    expect(weeklyWinner).toMatchObject({ points: 1 });
    expect(seasonWinner).toMatchObject({ points: 1 });
  });

  it("sums the season row across weeks", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement({
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
        {
          weekNumber: 2,
          kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
        },
      ],
    });
    const week1Id = weekIds.get("regular:1")!;
    const week2Id = weekIds.get("regular:2")!;
    const [g1] = gameIds.get("regular:1")!;
    const [g2] = gameIds.get("regular:2")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId: week1Id,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId: week2Id,
      gameId: g2!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 }); // correct, +14
    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 24 }); // incorrect, -4

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [week1Id, week2Id]);

    const rows = await standingsFor(db, leagueSeasonId);
    const season = rows.find((row) => row.weekId === null && row.leagueMemberId === memberId)!;
    expect(season).toMatchObject({ points: 1, wins: 1, losses: 1 });
  });

  it("ranks by points alone: members level on points share a rank, and the next rank skips", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement({
      memberCount: 3,
      weeks: [
        {
          weekNumber: 1,
          kickoffs: [
            { kickoffAt: WEEK1_KICKOFF },
            { kickoffAt: WEEK1_KICKOFF },
            { kickoffAt: WEEK1_KICKOFF },
          ],
        },
      ],
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;
    const memberD = members.get(users[0]!.user.id)!;
    const memberE = members.get(users[1]!.user.id)!;
    const memberF = members.get(users[2]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberD,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberE,
      weekId,
      gameId: g2!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberF,
      weekId,
      gameId: g3!,
      side: PICKEM_PICK_SIDE.HOME,
    });

    // D and E win by different margins, which used to separate them on the
    // differential and now must not separate them at all (ADR-0018).
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 30, awayScore: 20 }); // D: correct, 1pt
    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 25, awayScore: 24 }); // E: correct, 1pt
    await setGame(db, g3!, { status: GAME_STATUS.FINAL, homeScore: 15, awayScore: 20 }); // F: incorrect, 0pts

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const season = (await standingsFor(db, leagueSeasonId)).filter((row) => row.weekId === null);
    const byMember = new Map(season.map((row) => [row.leagueMemberId, row]));
    expect(byMember.get(memberD)).toMatchObject({ points: 1, rank: 1 });
    expect(byMember.get(memberE)).toMatchObject({ points: 1, rank: 1 });
    expect(byMember.get(memberF)).toMatchObject({ points: 0, rank: 3 }); // skips rank 2
  });

  it("counts each member's wins, losses and pushes, zero-filling a member with no picks", async () => {
    const { leagueSeasonId, weekId, picker, nonPicker } = await seedThreeOutcomeWeek();

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const rows = await standingsFor(db, leagueSeasonId);
    const weekly = (memberId: string) =>
      rows.find((row) => row.weekId === weekId && row.leagueMemberId === memberId)!;
    const season = (memberId: string) =>
      rows.find((row) => row.weekId === null && row.leagueMemberId === memberId)!;

    expect(weekly(picker)).toMatchObject({ wins: 1, losses: 1, pushes: 1, points: 1.5 });
    expect(season(picker)).toMatchObject({ wins: 1, losses: 1, pushes: 1, points: 1.5 });
    expect(weekly(nonPicker)).toMatchObject({ wins: 0, losses: 0, pushes: 0, points: 0 });
    expect(season(nonPicker)).toMatchObject({ wins: 0, losses: 0, pushes: 0, points: 0 });
  });

  it("sums the season counts across weeks while each weekly row carries only its own", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement({
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
        {
          weekNumber: 2,
          kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
        },
      ],
    });
    const week1Id = weekIds.get("regular:1")!;
    const week2Id = weekIds.get("regular:2")!;
    const [g1] = gameIds.get("regular:1")!;
    const [g2] = gameIds.get("regular:2")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId: week1Id,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId: week2Id,
      gameId: g2!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 }); // correct
    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 24 }); // incorrect

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [week1Id, week2Id]);

    const rows = await standingsFor(db, leagueSeasonId);
    const row = (weekId: string | null) =>
      rows.find((r) => r.weekId === weekId && r.leagueMemberId === memberId)!;

    expect(row(week1Id)).toMatchObject({ wins: 1, losses: 0, pushes: 0 });
    expect(row(week2Id)).toMatchObject({ wins: 0, losses: 1, pushes: 0 });
    expect(row(null)).toMatchObject({ wins: 1, losses: 1, pushes: 0 });
  });

  it("a member who submitted nothing appears with 0 points, weekly and season", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const picker = members.get(users[0]!.user.id)!;
    const nonPicker = members.get(users[1]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: picker,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const rows = await standingsFor(db, leagueSeasonId);
    const weeklyNonPicker = rows.find(
      (row) => row.weekId === weekId && row.leagueMemberId === nonPicker,
    )!;
    const seasonNonPicker = rows.find(
      (row) => row.weekId === null && row.leagueMemberId === nonPicker,
    )!;
    expect(weeklyNonPicker).toMatchObject({ points: 0 });
    expect(seasonNonPicker).toMatchObject({ points: 0 });
  });

  it("a week whose picks are all still on scheduled games still gets a weekly board, every member at zero, alongside a settled week and the season row", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement({
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
        {
          weekNumber: 2,
          kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
        },
      ],
    });
    const week1Id = weekIds.get("regular:1")!;
    const week2Id = weekIds.get("regular:2")!;
    const [g1] = gameIds.get("regular:1")!;
    const [g2] = gameIds.get("regular:2")!;
    const picker = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: picker,
      weekId: week1Id,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });

    // Week 2's pick is on a game still scheduled — no result for it yet.
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: picker,
      weekId: week2Id,
      gameId: g2!,
      side: PICKEM_PICK_SIDE.HOME,
    });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await rebuildLeagueSeason(db, clock, leagueSeasonId);

    const rows = await standingsFor(db, leagueSeasonId);
    const week1Rows = rows.filter((row) => row.weekId === week1Id);
    const week2Rows = rows.filter((row) => row.weekId === week2Id);
    const seasonRows = rows.filter((row) => row.weekId === null);

    expect(week1Rows).toHaveLength(2); // both members
    expect(week2Rows).toHaveLength(2); // both members, even though week 2 has zero results yet
    expect(seasonRows).toHaveLength(2);
    for (const row of week2Rows) {
      expect(row).toMatchObject({ points: 0 });
    }
  });

  it("a league with no picks at all still gets a season board with every member at zero", async () => {
    const { leagueSeasonId, members } = await seedLeagueForSettlement();

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await rebuildLeagueSeason(db, clock, leagueSeasonId);

    const rows = await standingsFor(db, leagueSeasonId);
    expect(rows.every((row) => row.weekId === null)).toBe(true); // no weekly rows: no week has picks
    expect(rows).toHaveLength(members.size);
    for (const row of rows) {
      expect(row).toMatchObject({ points: 0, rank: 1 });
    }
  });
});

describe("settlement idempotency (arch D10)", () => {
  async function seedSimpleSettledWeek() {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
    return { leagueSeasonId, weekId, gameId: g1!, memberId };
  }

  it("settling the same week twice produces identical pickem_pick_results and pickem_standings", async () => {
    const { leagueSeasonId, weekId } = await seedSimpleSettledWeek();
    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));

    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);
    const resultsOnce = snapshotResults(await pickResultsFor(db, leagueSeasonId));
    const standingsOnce = snapshotStandings(await standingsFor(db, leagueSeasonId));

    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);
    const resultsTwice = snapshotResults(await pickResultsFor(db, leagueSeasonId));
    const standingsTwice = snapshotStandings(await standingsFor(db, leagueSeasonId));

    expect(resultsTwice).toHaveLength(resultsOnce.length);
    expect(resultsTwice).toEqual(resultsOnce);
    expect(standingsTwice).toHaveLength(standingsOnce.length);
    expect(standingsTwice).toEqual(standingsOnce);
  });

  it("re-settling a mixed week leaves the W/L/P counts identical, not accumulated", async () => {
    // The counts are recounted from `pickem_pick_results` on every rebuild
    // (arch D10). An incremental counter would double them here — this is the
    // property that forbids one.
    const { leagueSeasonId, weekId, picker } = await seedThreeOutcomeWeek();
    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));

    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);
    const once = snapshotStandings(await standingsFor(db, leagueSeasonId));
    expect(
      once
        .filter((row) => row.leagueMemberId === picker)
        .map((row) => [row.wins, row.losses, row.pushes]),
    ).toEqual([
      [1, 1, 1],
      [1, 1, 1],
    ]); // weekly + season, both the real record

    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);
    await rebuildLeagueSeason(db, clock, leagueSeasonId);

    expect(snapshotStandings(await standingsFor(db, leagueSeasonId))).toEqual(once);
  });

  it("rebuildLeagueSeason after an incremental settle produces identical state", async () => {
    const { leagueSeasonId, weekId } = await seedSimpleSettledWeek();
    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));

    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);
    const resultsIncremental = snapshotResults(await pickResultsFor(db, leagueSeasonId));
    const standingsIncremental = snapshotStandings(await standingsFor(db, leagueSeasonId));

    await rebuildLeagueSeason(db, clock, leagueSeasonId);
    const resultsRebuilt = snapshotResults(await pickResultsFor(db, leagueSeasonId));
    const standingsRebuilt = snapshotStandings(await standingsFor(db, leagueSeasonId));

    expect(resultsRebuilt).toEqual(resultsIncremental);
    expect(standingsRebuilt).toEqual(standingsIncremental);
  });

  it("re-settling after a score-correcting override updates the result and standings in place", async () => {
    const { leagueSeasonId, weekId, gameId, memberId } = await seedSimpleSettledWeek();
    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));

    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);
    const before = await pickResultsFor(db, leagueSeasonId);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ outcome: PICK_OUTCOME.CORRECT, points: 1 });

    // An admin corrects the final score, flipping the outcome.
    await setGame(db, gameId, { overrideHomeScore: 5, overrideAwayScore: 20 });
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const after = await pickResultsFor(db, leagueSeasonId);
    expect(after).toHaveLength(1); // updated in place, not appended
    expect(after[0]).toMatchObject({ outcome: PICK_OUTCOME.INCORRECT, points: 0 });

    const seasonRow = (await standingsFor(db, leagueSeasonId)).find(
      (row) => row.weekId === null && row.leagueMemberId === memberId,
    )!;
    expect(seasonRow).toMatchObject({ points: 0 });
  });

  it("a pick that stops being settleable (game reverts to scheduled) loses its pickem_pick_results row on the next settle", async () => {
    const { leagueSeasonId, weekId, gameId } = await seedSimpleSettledWeek();
    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));

    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);
    expect(await pickResultsFor(db, leagueSeasonId)).toHaveLength(1);

    await setGame(db, gameId, { status: GAME_STATUS.SCHEDULED, homeScore: null, awayScore: null });
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    expect(await pickResultsFor(db, leagueSeasonId)).toHaveLength(0);
  });
});

describe("settlePicksForGames", () => {
  it("settles only the league-weeks holding a pick on the named games, leaving an unrelated league untouched", async () => {
    const league1 = await seedLeagueForSettlement({ year: 2026 });
    const league2 = await seedLeagueForSettlement({ year: 2027 });
    const week1Id = league1.weekIds.get("regular:1")!;
    const week2Id = league2.weekIds.get("regular:1")!;
    const [g1] = league1.gameIds.get("regular:1")!;
    const [g2] = league2.gameIds.get("regular:1")!;
    const member1 = league1.members.get(league1.users[0]!.user.id)!;
    const member2 = league2.members.get(league2.users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId: league1.leagueSeasonId,
      leagueMemberId: member1,
      weekId: week1Id,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId: league2.leagueSeasonId,
      leagueMemberId: member2,
      weekId: week2Id,
      gameId: g2!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });

    // League 2 is already settled once with its original (correct) score...
    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, league2.leagueSeasonId, [week2Id]);
    const league2Before = (await pickResultsFor(db, league2.leagueSeasonId))[0]!;
    expect(league2Before).toMatchObject({ outcome: PICK_OUTCOME.CORRECT });

    // ...then its score is mutated (simulating a later provider write) without
    // re-settling. Only game 1 "went final" — league 2 must not be touched.
    await setGame(db, g2!, { homeScore: 5, awayScore: 20 });

    await settlePicksForGames(db, clock, [g1!]);

    const league1Result = (await pickResultsFor(db, league1.leagueSeasonId))[0]!;
    expect(league1Result).toMatchObject({ outcome: PICK_OUTCOME.CORRECT });

    const league2After = (await pickResultsFor(db, league2.leagueSeasonId))[0]!;
    expect(league2After).toMatchObject({ outcome: PICK_OUTCOME.CORRECT }); // unchanged from before, despite the new score
    expect(league2After.id).toBe(league2Before.id);
  });

  it("is a no-op for an empty game list", async () => {
    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    const summary = await settlePicksForGames(db, clock, []);
    expect(summary).toEqual({ leagueSeasons: 0, weeks: 0, results: 0, unsettled: 0, failed: 0 });
  });
});

describe("settleSweep", () => {
  it("recomputes every active league season and skips a concluded one", async () => {
    const activeLeague = await seedLeagueForSettlement({
      status: LEAGUE_STATUS.ACTIVE,
      year: 2026,
    });
    const concludedLeague = await seedLeagueForSettlement({
      status: LEAGUE_STATUS.CONCLUDED,
      year: 2027,
    });

    for (const league of [activeLeague, concludedLeague]) {
      const weekId = league.weekIds.get("regular:1")!;
      const [gameId] = league.gameIds.get("regular:1")!;
      const memberId = league.members.get(league.users[0]!.user.id)!;
      await insertPick(db, {
        leagueSeasonId: league.leagueSeasonId,
        leagueMemberId: memberId,
        weekId,
        gameId: gameId!,
        side: PICKEM_PICK_SIDE.HOME,
      });
      await setGame(db, gameId!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
    }

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleSweep(db, clock);

    expect(await pickResultsFor(db, activeLeague.leagueSeasonId)).toHaveLength(1);
    expect(await standingsFor(db, activeLeague.leagueSeasonId)).not.toHaveLength(0);

    expect(await pickResultsFor(db, concludedLeague.leagueSeasonId)).toHaveLength(0);
    expect(await standingsFor(db, concludedLeague.leagueSeasonId)).toHaveLength(0);
  });

  it("does not abandon the rest of the sweep when one league season throws — the healthy league still settles, and the thrown message names the failing one", async () => {
    const badLeague = await seedLeagueForSettlement({ status: LEAGUE_STATUS.ACTIVE, year: 2026 });
    const goodLeague = await seedLeagueForSettlement({ status: LEAGUE_STATUS.ACTIVE, year: 2027 });

    for (const league of [badLeague, goodLeague]) {
      const weekId = league.weekIds.get("regular:1")!;
      const [gameId] = league.gameIds.get("regular:1")!;
      const memberId = league.members.get(league.users[0]!.user.id)!;
      await insertPick(db, {
        leagueSeasonId: league.leagueSeasonId,
        leagueMemberId: memberId,
        weekId,
        gameId: gameId!,
        side: PICKEM_PICK_SIDE.HOME,
      });
      await setGame(db, gameId!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
    }

    // Corrupt the bad league's stored settings so LEAGUE_SETTINGS_SCHEMAS[...].parse()
    // throws inside loadSettleableSeason, before that season's own transaction opens.
    await db
      .update(leagueSeasons)
      .set({ settings: { pickType: "nonsense" } as never })
      .where(eq(leagueSeasons.id, badLeague.leagueSeasonId));

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));

    // The select behind settleSweep has no ORDER BY, so both assertions below
    // must hold regardless of which league the sweep visits first — they name
    // the bad and good league explicitly rather than relying on position.
    const settlePromise = settleSweep(db, clock);
    await expect(settlePromise).rejects.toThrow(/failed to settle/);
    await expect(settlePromise).rejects.toThrow(badLeague.leagueSeasonId);

    // The healthy league settled regardless — before the fix, the first throw
    // aborted the loop and every season after it (in unspecified order) got
    // nothing.
    expect(await pickResultsFor(db, goodLeague.leagueSeasonId)).toHaveLength(1);
    expect(await standingsFor(db, goodLeague.leagueSeasonId)).not.toHaveLength(0);
  });
});

describe("concurrent settlement of one league season (FOR UPDATE row lock)", () => {
  it("two overlapping settles of the same league season don't collide on the unique pickem_pick_results constraint", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));

    // Both call settleLeagueSeasonWeeks directly (each opens its own
    // transaction and takes lockLeagueSeasonRow) so they genuinely overlap on
    // the pool rather than serializing through a shared caller.
    const [summaryA, summaryB] = await Promise.all([
      settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]),
      settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]),
    ]);

    expect(summaryA.results).toBe(1);
    expect(summaryB.results).toBe(1);

    // No duplicate row from the race (pickem_pick_results_pick_unique), and
    // standings reflect exactly one member with a pick across a weekly + season row.
    expect(await pickResultsFor(db, leagueSeasonId)).toHaveLength(1);
    expect(await standingsFor(db, leagueSeasonId)).toHaveLength(4); // 2 members x (weekly + season)
  });
});

describe("settlement grades on game status, not the clock", () => {
  it("settles a final game even under a clock reading before its kickoff", async () => {
    const { leagueSeasonId, weekIds, gameIds, members, users } = await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });

    // A clock instant well before the game's own (seeded) kickoff.
    const earlyClock = new FixedClock(new Date(WEEK1_KICKOFF.getTime() - 30 * 24 * 60 * 60 * 1000));
    const summary = await settleLeagueSeasonWeeks(db, earlyClock, leagueSeasonId, [weekId]);

    expect(summary.results).toBe(1);
    expect(await pickResultsFor(db, leagueSeasonId)).toHaveLength(1);
  });
});

describe("HTTP: POST /api/admin/leagues/:leagueId/rebuild", () => {
  function postRebuild(leagueId: string, cookie: string | undefined) {
    return app.request(`/api/admin/leagues/${leagueId}/rebuild`, {
      method: "POST",
      headers: withCookie(cookie),
    });
  }

  it("401s without a session", async () => {
    const res = await postRebuild(randomUUID(), undefined);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("403s for a non-admin caller", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const { league } = await seedLeagueForSettlement();

    const res = await postRebuild(league.id, cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_admin" });
  });

  it("404s an unknown league for an admin caller", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);

    const res = await postRebuild(randomUUID(), cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "league_not_found" });
  });

  it("200s the job envelope and rebuilds the league's standings", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    const { league, leagueSeasonId, weekIds, gameIds, members, users } =
      await seedLeagueForSettlement();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const memberId = members.get(users[0]!.user.id)!;
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });

    const res = await postRebuild(league.id, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobRunResponse;
    expect(body.job).toBe("league-rebuild");
    expect(body.status).toBe("ok");
    expect(typeof body.durationMs).toBe("number");
    expect(body.details).toMatchObject({ results: 1 });

    expect(await pickResultsFor(db, leagueSeasonId)).toHaveLength(1);
  });
});

describe("HTTP: POST /api/jobs/settle-sweep", () => {
  const testEnv = makeTestEnv();
  // Reuses the harness's `db` (and its already-seeded data) but adds `env` so
  // the job-secret guard has something to check against — the harness's own
  // `app` is built with no `env` (see league-app.ts), which would 500
  // misconfigured rather than exercise the guard.
  const jobsApp = createApp({
    db,
    env: testEnv,
    clock: async () => new FixedClock(new Date("2026-09-20T00:00:00.000Z")),
  });

  function postSettleSweep(headers: Record<string, string> = {}) {
    return jobsApp.request("/api/jobs/settle-sweep", { method: "POST", headers });
  }

  it("401s without the x-job-secret header", async () => {
    const res = await postSettleSweep();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("200s the job envelope when the header matches", async () => {
    await seedLeagueForSettlement(); // just proves the sweep runs end to end

    const res = await postSettleSweep({ "x-job-secret": testEnv.JOB_SECRET });
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobRunResponse;
    expect(body.job).toBe("settle-sweep");
    expect(body.status).toBe("ok");
    expect(typeof body.durationMs).toBe("number");
  });
});
