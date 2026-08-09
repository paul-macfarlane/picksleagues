import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminAudit, isUniqueViolation } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import { ADMIN_AUDIT_ACTION, GAME_STATUS, PICK_OUTCOME } from "@picksleagues/schemas";
import { rebuildLeagueSeason, settlePicksForGames, settleSweep } from "../src/services/settlement";
import { setGame } from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF } from "./setup/league-app";
import {
  insertSurvivorPick,
  seedSurvivorGame,
  seedSurvivorLeague,
  seedSurvivorSeason,
  survivorPickResultsFor,
  survivorPicksFor,
  survivorStateFor,
  SURVIVOR_WEEK_MS as WEEK_MS,
  type SeededSurvivorSeasonWeek as FixtureWeek,
  type SeedSurvivorSeasonOptions,
} from "./setup/survivor-league";
import { resetDb } from "./setup/reset-db";

const { db, auth } = makeLeagueTestHarness();

/** Well past every seeded kickoff — settlement grades on game status, never on the clock. */
const clock = new FixedClock(new Date("2026-12-01T00:00:00.000Z"));

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

const seedSeasonFixture = (opts: SeedSurvivorSeasonOptions = {}) =>
  seedSurvivorSeason(db, auth, opts);

/** Home wins by two touchdowns — the fixture's ordinary "this game is over". */
async function finalizeHomeWin(gameId: string) {
  await setGame(db, gameId, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
}

async function finalizeAwayWin(gameId: string) {
  await setGame(db, gameId, { status: GAME_STATUS.FINAL, homeScore: 10, awayScore: 24 });
}

/**
 * Row identity is excluded: every replay is delete-then-insert, so ids are
 * fresh each run and comparing them would fail on a rebuild that reproduced the
 * state perfectly.
 */
function snapshotResults(rows: Awaited<ReturnType<typeof survivorPickResultsFor>>) {
  return [...rows]
    .sort((a, b) => a.survivorPickId.localeCompare(b.survivorPickId))
    .map((row) => ({
      survivorPickId: row.survivorPickId,
      leagueMemberId: row.leagueMemberId,
      weekId: row.weekId,
      outcome: row.outcome,
    }));
}

function snapshotState(rows: Awaited<ReturnType<typeof survivorStateFor>>) {
  return [...rows]
    .sort((a, b) => a.leagueMemberId.localeCompare(b.leagueMemberId))
    .map((row) => ({
      leagueMemberId: row.leagueMemberId,
      livesRemaining: row.livesRemaining,
      eliminatedWeekId: row.eliminatedWeekId,
      revivedCount: row.revivedCount,
    }));
}

describe("week completeness (ADR-0025 precondition (a))", () => {
  it("writes nothing for a week still holding a non-terminal game", async () => {
    const fixture = await seedSeasonFixture({ weekCount: 1 });
    const [week] = fixture.weeks as [FixtureWeek];
    // A second game nobody picked, still scheduled: the week is not over, and a
    // member with no pick yet may legally still make one.
    await seedSurvivorGame(db, { weekId: week.weekId, kickoffAt: WEEK1_KICKOFF });

    for (const leagueMemberId of fixture.memberIds) {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId,
        weekId: week.weekId,
        gameId: week.gameId,
        teamId: week.homeTeamId,
      });
    }
    await finalizeHomeWin(week.gameId);

    const summary = await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    expect(summary).toMatchObject({ leagueSeasons: 1, weeks: 0, results: 0, unsettled: 1 });
    expect(await survivorPickResultsFor(db, fixture.leagueSeasonId)).toHaveLength(0);
    expect(await survivorStateFor(db, fixture.leagueSeasonId)).toHaveLength(0);
  });

  it("writes nothing for a week whose games have not been scheduled at all", async () => {
    // The week row exists and is in range, but carries no games — grading it
    // would eliminate every member for missing a pick they were never offered.
    const base = await seedSurvivorLeague(db, auth, {
      weeks: [{ weekNumber: 1 }],
      members: [{ username: "member_0" }, { username: "member_1" }],
    });

    const summary = await rebuildLeagueSeason(db, clock, base.leagueSeasonId);

    expect(summary).toMatchObject({ weeks: 0, results: 0 });
    expect(await survivorStateFor(db, base.leagueSeasonId)).toHaveLength(0);
  });
});

describe("prefix ordering (ADR-0025 precondition (b))", () => {
  it("a fully final later week writes nothing while an earlier week holds a postponed game, then both settle in order", async () => {
    const fixture = await seedSeasonFixture({ weekCount: 2 });
    const [week1, week2] = fixture.weeks as [FixtureWeek, FixtureWeek];

    for (const week of [week1, week2]) {
      for (const leagueMemberId of fixture.memberIds) {
        await insertSurvivorPick(db, {
          leagueSeasonId: fixture.leagueSeasonId,
          leagueMemberId,
          weekId: week.weekId,
          gameId: week.gameId,
          teamId: week.homeTeamId,
        });
      }
    }

    await setGame(db, week1.gameId, { status: GAME_STATUS.POSTPONED });
    await finalizeHomeWin(week2.gameId);

    const blocked = await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);
    expect(blocked).toMatchObject({ weeks: 0, results: 0 });
    expect(await survivorPickResultsFor(db, fixture.leagueSeasonId)).toHaveLength(0);

    await finalizeHomeWin(week1.gameId);
    const caughtUp = await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    expect(caughtUp).toMatchObject({ weeks: 2, results: 4 });
    const results = await survivorPickResultsFor(db, fixture.leagueSeasonId);
    expect(results.filter((row) => row.weekId === week1.weekId)).toHaveLength(2);
    expect(results.filter((row) => row.weekId === week2.weekId)).toHaveLength(2);
    expect(results.every((row) => row.outcome === PICK_OUTCOME.CORRECT)).toBe(true);
  });
});

describe("late corrections cascade forward", () => {
  /**
   * The failure this covers is not a stale number: a week settling against a
   * wrong alive-set ends the wrong member's season, and every week after it
   * inherits the mistake (ADR-0025).
   */
  it("an override flipping a settled week's outcome replays every later week on the same trigger", async () => {
    // Four members in two pairs, so whichever side of week 1 the correction
    // takes out, two are left alive and the season runs on. A pair per side is
    // what keeps the *cascade* the subject: reduced to one, the replay would
    // stop at the deciding week and grade no later one at all (ADR-0027), which
    // is a different rule and has its own tests below.
    const fixture = await seedSeasonFixture({ weekCount: 3, memberCount: 4 });
    const [week1, week2, week3] = fixture.weeks as [FixtureWeek, FixtureWeek, FixtureWeek];
    const [memberA, memberB, memberC, memberD] = fixture.memberIds as [
      string,
      string,
      string,
      string,
    ];
    // A and C ride the home team every week; B and D take the away side of week
    // 1 and then follow. Under the provider score that ends B's and D's seasons
    // in week 1; under the correction it ends A's and C's instead, which is what
    // the later weeks have to notice.
    const awayInWeek1 = new Set([memberB, memberD]);

    for (const week of [week1, week2, week3]) {
      for (const leagueMemberId of fixture.memberIds) {
        await insertSurvivorPick(db, {
          leagueSeasonId: fixture.leagueSeasonId,
          leagueMemberId,
          weekId: week.weekId,
          gameId: week.gameId,
          teamId:
            week === week1 && awayInWeek1.has(leagueMemberId) ? week.awayTeamId : week.homeTeamId,
        });
      }
      await finalizeHomeWin(week.gameId);
    }

    await settlePicksForGames(db, clock, [week1.gameId, week2.gameId, week3.gameId]);

    const eliminatedInWeek1 = (memberIds: string[]) =>
      [...memberIds].sort().map((leagueMemberId) => ({
        leagueMemberId,
        livesRemaining: 0,
        eliminatedWeekId: week1.weekId,
        revivedCount: 0,
      }));

    const before = await survivorStateFor(db, fixture.leagueSeasonId);
    expect(snapshotState(before)).toEqual(eliminatedInWeek1([memberB, memberD]));

    // An admin corrects week 1's final score, flipping who survived it.
    await setGame(db, week1.gameId, { overrideHomeScore: 10, overrideAwayScore: 24 });
    await settlePicksForGames(db, clock, [week1.gameId]);

    expect(snapshotState(await survivorStateFor(db, fixture.leagueSeasonId))).toEqual(
      eliminatedInWeek1([memberA, memberC]),
    );

    const results = await survivorPickResultsFor(db, fixture.leagueSeasonId);
    const laterWeeks = results.filter((row) => row.weekId !== week1.weekId);
    // Weeks 2 and 3 now grade B and D — who were previously out — and no longer
    // grade A and C, whose picks were made in the window before their
    // elimination settled.
    expect([...new Set(laterWeeks.map((row) => row.leagueMemberId))].sort()).toEqual(
      [memberB, memberD].sort(),
    );
    expect(laterWeeks).toHaveLength(4);
    expect(laterWeeks.every((row) => row.outcome === PICK_OUTCOME.CORRECT)).toBe(true);
  });
});

describe("cancellations and the team ledger (ADR-0025 decisions 1 and 2)", () => {
  it("a cancelled game pushes, hands the team back, and the returned team is re-pickable while the ledger still refuses a second live use", async () => {
    const fixture = await seedSeasonFixture({ weekCount: 3 });
    const [week1, , week3] = fixture.weeks as [FixtureWeek, FixtureWeek, FixtureWeek];
    const [memberA] = fixture.memberIds as [string];

    // Weeks 2 and 3 are played between week 1's teams, so the team a
    // cancellation returns is one the member can genuinely pick again.
    const week2Rematch = await seedSurvivorGame(db, {
      weekId: fixture.weeks[1]!.weekId,
      kickoffAt: new Date(WEEK1_KICKOFF.getTime() + WEEK_MS),
      teams: { homeTeamId: week1.homeTeamId, awayTeamId: week1.awayTeamId },
    });
    const week3Rematch = await seedSurvivorGame(db, {
      weekId: week3.weekId,
      kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 2 * WEEK_MS),
      teams: { homeTeamId: week1.homeTeamId, awayTeamId: week1.awayTeamId },
    });

    for (const leagueMemberId of fixture.memberIds) {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId,
        weekId: week1.weekId,
        gameId: week1.gameId,
        teamId: week1.homeTeamId,
      });
    }
    await setGame(db, week1.gameId, { status: GAME_STATUS.CANCELLED });

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    const [week1Result] = await survivorPickResultsFor(db, fixture.leagueSeasonId);
    expect(week1Result).toMatchObject({ outcome: PICK_OUTCOME.PUSH, weekId: week1.weekId });
    // Surviving a cancellation is not an elimination and not a revival, so the
    // ledger has nothing to record about anyone (ADR-0025 — absence means alive).
    expect(await survivorStateFor(db, fixture.leagueSeasonId)).toHaveLength(0);
    const afterCancellation = await survivorPicksFor(db, fixture.leagueSeasonId, memberA);
    expect(afterCancellation.every((pick) => pick.released)).toBe(true);

    // The returned team is genuinely available again.
    await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberA,
      weekId: fixture.weeks[1]!.weekId,
      gameId: week2Rematch.gameId,
      teamId: week1.homeTeamId,
    });
    // Both of week 2's games, since the week settles as a unit.
    await finalizeHomeWin(week2Rematch.gameId);
    await finalizeHomeWin(fixture.weeks[1]!.gameId);
    await settlePicksForGames(db, clock, [week2Rematch.gameId]);

    // ...and spending it consumes it, so a third live pick on the same team is
    // refused by the ledger index rather than by an app-level check.
    let error: unknown;
    try {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId: memberA,
        weekId: week3.weekId,
        gameId: week3Rematch.gameId,
        teamId: week1.homeTeamId,
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(isUniqueViolation(error, "survivor_picks_member_team_unique")).toBe(true);
  });

  /**
   * The sticky-release rule (ADR-0025 decision 2). Without it this sequence
   * recreates two live ledger rows for one (member, team), collides with the
   * partial unique index, and leaves the league season permanently
   * unsettleable — settlement aborting with no remedy short of a database edit.
   */
  it("reverting a cancellation after the member legally re-picked the returned team still settles the whole season", async () => {
    const fixture = await seedSeasonFixture({ weekCount: 3 });
    const [week1, week2, week3] = fixture.weeks as [FixtureWeek, FixtureWeek, FixtureWeek];
    const [memberA, memberB] = fixture.memberIds as [string, string];

    const week3Rematch = await seedSurvivorGame(db, {
      weekId: week3.weekId,
      kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 2 * WEEK_MS),
      teams: { homeTeamId: week1.homeTeamId, awayTeamId: week1.awayTeamId },
    });

    for (const leagueMemberId of [memberA, memberB]) {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId,
        weekId: week1.weekId,
        gameId: week1.gameId,
        teamId: week1.homeTeamId,
      });
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId,
        weekId: week2.weekId,
        gameId: week2.gameId,
        teamId: week2.homeTeamId,
      });
    }
    // Week 1 was played, then corrected to cancelled by an admin — the only
    // mechanism a real week move reaches this flag through (ADR-0019).
    await setGame(db, week1.gameId, {
      status: GAME_STATUS.FINAL,
      homeScore: 24,
      awayScore: 10,
      overrideStatus: GAME_STATUS.CANCELLED,
    });

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);
    const [releasedWeek1Pick] = (
      await survivorPicksFor(db, fixture.leagueSeasonId, memberA)
    ).filter((pick) => pick.weekId === week1.weekId);
    expect(releasedWeek1Pick?.released).toBe(true);

    // A re-picks the returned team in week 3; B takes the other side.
    await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberA,
      weekId: week3.weekId,
      gameId: week3Rematch.gameId,
      teamId: week1.homeTeamId,
    });
    await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberB,
      weekId: week3.weekId,
      gameId: week3Rematch.gameId,
      teamId: week1.awayTeamId,
    });

    // The admin reverts the cancellation, and the rest of the season completes.
    await setGame(db, week1.gameId, { overrideStatus: null });
    await finalizeHomeWin(week2.gameId);
    await finalizeHomeWin(week3Rematch.gameId);
    await finalizeHomeWin(week3.gameId);

    const summary = await settlePicksForGames(db, clock, [week1.gameId]);
    expect(summary).toMatchObject({ leagueSeasons: 1, weeks: 3 });

    const picks = await survivorPicksFor(db, fixture.leagueSeasonId, memberA);
    const byWeek = new Map(picks.map((pick) => [pick.weekId, pick]));
    // The earlier pick keeps the release a later pick has already relied on...
    expect(byWeek.get(week1.weekId)?.released).toBe(true);
    expect(byWeek.get(week3.weekId)?.released).toBe(false);

    // ...and grades normally now that its game was played.
    const results = await survivorPickResultsFor(db, fixture.leagueSeasonId);
    const week1Result = results.find((row) => row.survivorPickId === byWeek.get(week1.weekId)?.id);
    expect(week1Result).toMatchObject({ outcome: PICK_OUTCOME.CORRECT });
    // A rode the revived team home; B took the other side of that game and is
    // out — the season carried on rather than stalling on the flip-flop.
    expect(snapshotState(await survivorStateFor(db, fixture.leagueSeasonId))).toEqual([
      {
        leagueMemberId: memberB,
        livesRemaining: 0,
        eliminatedWeekId: week3.weekId,
        revivedCount: 0,
      },
    ]);
  });
});

describe("revival when everyone busts in the same week", () => {
  it("revives every member, counts the revival, and leaves the busting teams consumed", async () => {
    const fixture = await seedSeasonFixture({ weekCount: 1 });
    const [week1] = fixture.weeks as [FixtureWeek];

    for (const leagueMemberId of fixture.memberIds) {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId,
        weekId: week1.weekId,
        gameId: week1.gameId,
        teamId: week1.homeTeamId,
      });
    }
    await finalizeAwayWin(week1.gameId);

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    const state = await survivorStateFor(db, fixture.leagueSeasonId);
    expect(state).toHaveLength(fixture.memberIds.length);
    for (const row of state) {
      expect(row).toMatchObject({ eliminatedWeekId: null, livesRemaining: 1, revivedCount: 1 });
    }

    const results = await survivorPickResultsFor(db, fixture.leagueSeasonId);
    expect(results.every((row) => row.outcome === PICK_OUTCOME.INCORRECT)).toBe(true);
    // Only the life comes back: a team the busting pick spent stays spent.
    for (const leagueMemberId of fixture.memberIds) {
      const picks = await survivorPicksFor(db, fixture.leagueSeasonId, leagueMemberId);
      expect(picks.every((pick) => !pick.released)).toBe(true);
    }
  });
});

describe("provisional elimination mid-week (ADR-0028)", () => {
  /**
   * One week holding two games: the first is played out, the second is not. That
   * is the shape the owner hit — a result on the screen while the week is still
   * running — and the only shape in which the safety rule has anything to decide.
   */
  async function seedPartlyPlayedWeek(memberCount: number) {
    const fixture = await seedSeasonFixture({ weekCount: 1, memberCount });
    const [week] = fixture.weeks as [FixtureWeek];
    const open = await seedSurvivorGame(db, { weekId: week.weekId, kickoffAt: WEEK1_KICKOFF });
    return { fixture, week, open };
  }

  const pickInWeek = (
    fixture: Awaited<ReturnType<typeof seedPartlyPlayedWeek>>["fixture"],
    weekId: string,
    leagueMemberId: string,
    gameId: string,
    teamId: string,
  ) =>
    insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId,
      weekId,
      gameId,
      teamId,
    });

  /** A survives the played game, B busts on it, C has not picked at all. */
  async function seedOneSurvivorOneLoserOneAbsentee() {
    const { fixture, week, open } = await seedPartlyPlayedWeek(3);
    const [memberA, memberB, memberC] = fixture.memberIds as [string, string, string];

    await pickInWeek(fixture, week.weekId, memberA, week.gameId, week.homeTeamId);
    await pickInWeek(fixture, week.weekId, memberB, week.gameId, week.awayTeamId);
    await finalizeHomeWin(week.gameId);

    return { fixture, week, open, memberA, memberB, memberC };
  }

  it("puts out the member whose loss is certain, and leaves the survivor and the member who has not picked alone", async () => {
    const { fixture, week, memberB } = await seedOneSurvivorOneLoserOneAbsentee();

    const summary = await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    expect(snapshotState(await survivorStateFor(db, fixture.leagueSeasonId))).toEqual([
      {
        leagueMemberId: memberB,
        livesRemaining: 0,
        eliminatedWeekId: week.weekId,
        revivedCount: 0,
      },
    ]);
    // Eliminations only: grading terminal picks early would feed the whole-season
    // `released` ledger a partial week's consumption data (ADR-0028 decision 2).
    expect(await survivorPickResultsFor(db, fixture.leagueSeasonId)).toHaveLength(0);
    // And the week itself is still unsettled, so the replay stopped on it.
    expect(summary).toMatchObject({ leagueSeasons: 1, weeks: 0, results: 0, unsettled: 1 });
  });

  it("puts out nobody while no alive member's pick has confirmed them safe", async () => {
    const { fixture, week, open } = await seedPartlyPlayedWeek(2);
    const [memberA, memberB] = fixture.memberIds as [string, string];

    // A is riding the game that has not been played; B has already lost. Nothing
    // rules out the week busting them both and reviving them, so B stays in.
    await pickInWeek(fixture, week.weekId, memberA, open.gameId, open.homeTeamId);
    await pickInWeek(fixture, week.weekId, memberB, week.gameId, week.awayTeamId);
    await finalizeHomeWin(week.gameId);

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    expect(await survivorStateFor(db, fixture.leagueSeasonId)).toHaveLength(0);
    expect(await survivorPickResultsFor(db, fixture.leagueSeasonId)).toHaveLength(0);
  });

  it("the completed week confirms the provisional elimination rather than revising it", async () => {
    const { fixture, week, open, memberB, memberC } = await seedOneSurvivorOneLoserOneAbsentee();

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);
    const provisional = snapshotState(await survivorStateFor(db, fixture.leagueSeasonId));

    await finalizeHomeWin(open.gameId);
    const completed = await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    // The same elimination, in the same week — plus the one only a complete week
    // can make, C's missed pick.
    const state = snapshotState(await survivorStateFor(db, fixture.leagueSeasonId));
    expect(state).toEqual(
      [memberB, memberC].sort().map((leagueMemberId) => ({
        leagueMemberId,
        livesRemaining: 0,
        eliminatedWeekId: week.weekId,
        revivedCount: 0,
      })),
    );
    for (const row of provisional) expect(state).toContainEqual(row);
    expect(completed).toMatchObject({ weeks: 1, unsettled: 0 });
  });

  it("re-settling a partly played week lands on identical state (arch D10)", async () => {
    const { fixture } = await seedOneSurvivorOneLoserOneAbsentee();

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);
    const once = snapshotState(await survivorStateFor(db, fixture.leagueSeasonId));

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    expect(snapshotState(await survivorStateFor(db, fixture.leagueSeasonId))).toEqual(once);
    expect(once).toHaveLength(1);
  });

  it("still revives everyone when the week completes with no survivor at any point", async () => {
    const { fixture, week, open } = await seedPartlyPlayedWeek(2);

    for (const leagueMemberId of fixture.memberIds) {
      await pickInWeek(fixture, week.weekId, leagueMemberId, week.gameId, week.homeTeamId);
    }
    await finalizeAwayWin(week.gameId);

    // Mid-week: both members' picks have lost and nobody is confirmed safe, so
    // nothing may go early — this is precisely the week revival exists for.
    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);
    expect(await survivorStateFor(db, fixture.leagueSeasonId)).toHaveLength(0);

    await finalizeHomeWin(open.gameId);
    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    expect(snapshotState(await survivorStateFor(db, fixture.leagueSeasonId))).toEqual(
      [...fixture.memberIds].sort().map((leagueMemberId) => ({
        leagueMemberId,
        livesRemaining: 1,
        eliminatedWeekId: null,
        revivedCount: 1,
      })),
    );
  });
});

describe("a decided season is graded no further (ADR-0027)", () => {
  /**
   * Week 1 reduces the league to one member alive, which ends the season
   * (ADR-0027) — and the pick endpoint refuses that member from then on, so
   * weeks 2 and 3 hold no pick of theirs however completely they play out. The
   * grader must not read those weeks as missed picks.
   */
  async function seedSeasonDecidedInWeek1() {
    const fixture = await seedSeasonFixture({ weekCount: 3 });
    const [week1, week2, week3] = fixture.weeks as [FixtureWeek, FixtureWeek, FixtureWeek];
    const [memberA, memberB] = fixture.memberIds as [string, string];

    await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberA,
      weekId: week1.weekId,
      gameId: week1.gameId,
      teamId: week1.homeTeamId,
    });
    await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberB,
      weekId: week1.weekId,
      gameId: week1.gameId,
      teamId: week1.awayTeamId,
    });
    // Every later week is fully final, so nothing but the season being over
    // stops the replay reaching them.
    for (const week of [week1, week2, week3]) await finalizeHomeWin(week.gameId);

    return { fixture, week1, memberA, memberB };
  }

  it("leaves the sole survivor alive and unrevived rather than busting them every later week", async () => {
    const { fixture, week1, memberB } = await seedSeasonDecidedInWeek1();

    const summary = await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    // The winner keeps no row at all: absence means alive and untouched
    // (ADR-0025), which is what they are. Grading weeks 2 and 3 would read each
    // as a missed pick and bust the whole alive set, handing the life straight
    // back — a `revivedCount` climbing with every week left in the range.
    expect(snapshotState(await survivorStateFor(db, fixture.leagueSeasonId))).toEqual([
      {
        leagueMemberId: memberB,
        livesRemaining: 0,
        eliminatedWeekId: week1.weekId,
        revivedCount: 0,
      },
    ]);
    const results = await survivorPickResultsFor(db, fixture.leagueSeasonId);
    expect(results.every((row) => row.weekId === week1.weekId)).toBe(true);
    expect(summary).toMatchObject({ leagueSeasons: 1, weeks: 1, results: 2, unsettled: 0 });
  });

  it("keeps grading a solo league, which one alive member has not won", async () => {
    // Reduction is the test, not the count: nobody has been eliminated here, so
    // the member alone in a league is still owed every week of it (ADR-0027).
    const fixture = await seedSeasonFixture({ weekCount: 2, memberCount: 1 });
    const [week1, week2] = fixture.weeks as [FixtureWeek, FixtureWeek];
    const [memberA] = fixture.memberIds as [string];

    for (const week of [week1, week2]) {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId: memberA,
        weekId: week.weekId,
        gameId: week.gameId,
        teamId: week.homeTeamId,
      });
      await finalizeHomeWin(week.gameId);
    }

    const summary = await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    expect(summary).toMatchObject({ weeks: 2, results: 2 });
    const results = await survivorPickResultsFor(db, fixture.leagueSeasonId);
    expect(results.map((row) => row.weekId).sort()).toEqual([week1.weekId, week2.weekId].sort());
  });

  it("re-settles a decided season to identical state", async () => {
    const { fixture } = await seedSeasonDecidedInWeek1();

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);
    const first = {
      results: snapshotResults(await survivorPickResultsFor(db, fixture.leagueSeasonId)),
      state: snapshotState(await survivorStateFor(db, fixture.leagueSeasonId)),
    };

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    expect({
      results: snapshotResults(await survivorPickResultsFor(db, fixture.leagueSeasonId)),
      state: snapshotState(await survivorStateFor(db, fixture.leagueSeasonId)),
    }).toEqual(first);
  });
});

describe("override precedence in the input loader (arch D15)", () => {
  it("grades against override_home_score/override_away_score, not the provider score", async () => {
    const fixture = await seedSeasonFixture({ weekCount: 1 });
    const [week1] = fixture.weeks as [FixtureWeek];
    const [memberA, memberB] = fixture.memberIds as [string, string];

    await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberA,
      weekId: week1.weekId,
      gameId: week1.gameId,
      teamId: week1.homeTeamId,
    });
    await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberB,
      weekId: week1.weekId,
      gameId: week1.gameId,
      teamId: week1.awayTeamId,
    });
    // Provider says the away team won; the correction flips it.
    await setGame(db, week1.gameId, {
      status: GAME_STATUS.FINAL,
      homeScore: 10,
      awayScore: 24,
      overrideHomeScore: 30,
      overrideAwayScore: 20,
    });

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    const results = await survivorPickResultsFor(db, fixture.leagueSeasonId);
    const byMember = new Map(results.map((row) => [row.leagueMemberId, row]));
    expect(byMember.get(memberA)).toMatchObject({ outcome: PICK_OUTCOME.CORRECT });
    expect(byMember.get(memberB)).toMatchObject({ outcome: PICK_OUTCOME.INCORRECT });
    expect(snapshotState(await survivorStateFor(db, fixture.leagueSeasonId))).toEqual([
      {
        leagueMemberId: memberB,
        livesRemaining: 0,
        eliminatedWeekId: week1.weekId,
        revivedCount: 0,
      },
    ]);
  });
});

describe("settlement is a pure derivation (arch D10)", () => {
  /** Three weeks with a mid-season elimination — enough state for a rebuild to get wrong. */
  async function seedThreeWeekSeason() {
    const fixture = await seedSeasonFixture({ weekCount: 3 });
    const [week1, week2, week3] = fixture.weeks as [FixtureWeek, FixtureWeek, FixtureWeek];
    const [memberA, memberB] = fixture.memberIds as [string, string];

    for (const week of [week1, week2, week3]) {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId: memberA,
        weekId: week.weekId,
        gameId: week.gameId,
        teamId: week.homeTeamId,
      });
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId: memberB,
        weekId: week.weekId,
        gameId: week.gameId,
        teamId: week === week2 ? week.awayTeamId : week.homeTeamId,
      });
    }
    return { fixture, weeks: [week1, week2, week3] as const };
  }

  it("settling twice lands on identical results, state, and released flags", async () => {
    const { fixture, weeks } = await seedThreeWeekSeason();
    for (const week of weeks) await finalizeHomeWin(week.gameId);

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);
    const resultsOnce = snapshotResults(await survivorPickResultsFor(db, fixture.leagueSeasonId));
    const stateOnce = snapshotState(await survivorStateFor(db, fixture.leagueSeasonId));

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    expect(snapshotResults(await survivorPickResultsFor(db, fixture.leagueSeasonId))).toEqual(
      resultsOnce,
    );
    expect(snapshotState(await survivorStateFor(db, fixture.leagueSeasonId))).toEqual(stateOnce);
  });

  it("a full recompute reproduces the state the week-by-week incremental path built", async () => {
    const { fixture, weeks } = await seedThreeWeekSeason();

    // The incremental path as the season actually runs: each game goes final on
    // its own ingestion tick.
    for (const week of weeks) {
      await finalizeHomeWin(week.gameId);
      await settlePicksForGames(db, clock, [week.gameId]);
    }
    const resultsIncremental = snapshotResults(
      await survivorPickResultsFor(db, fixture.leagueSeasonId),
    );
    const stateIncremental = snapshotState(await survivorStateFor(db, fixture.leagueSeasonId));
    expect(stateIncremental).toHaveLength(1); // B busted in week 2

    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId);

    expect(snapshotResults(await survivorPickResultsFor(db, fixture.leagueSeasonId))).toEqual(
      resultsIncremental,
    );
    expect(snapshotState(await survivorStateFor(db, fixture.leagueSeasonId))).toEqual(
      stateIncremental,
    );
  });
});

describe("admin rebuild audit", () => {
  it("records the Survivor state the recompute is about to replace, from Survivor's own tables", async () => {
    const fixture = await seedSeasonFixture({ weekCount: 1 });
    const [week1] = fixture.weeks as [FixtureWeek];
    const adminUserId = fixture.users[0]!.user.id;

    for (const leagueMemberId of fixture.memberIds) {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId,
        weekId: week1.weekId,
        gameId: week1.gameId,
        teamId: week1.homeTeamId,
      });
    }
    await finalizeAwayWin(week1.gameId); // everyone busts, so state has rows too

    // The first rebuild replaces nothing; the second replaces what it wrote.
    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId, { adminUserId });
    await rebuildLeagueSeason(db, clock, fixture.leagueSeasonId, { adminUserId });

    const rows = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, ADMIN_AUDIT_ACTION.LEAGUE_REBUILD));
    expect(rows).toHaveLength(2);
    expect(
      rows.map((row) => (row.priorValue as { resultCount: number }).resultCount).sort(),
    ).toEqual([0, 2]);
    const replaced = rows.find(
      (row) => (row.priorValue as { resultCount: number }).resultCount === 2,
    )!;
    expect(replaced.priorValue).toMatchObject({
      stateRowCount: fixture.memberIds.length,
      lastSettledAt: clock.now().toISOString(),
    });
  });
});

describe("mode dispatch", () => {
  it("the nightly sweep settles an active Survivor season", async () => {
    const fixture = await seedSeasonFixture({ weekCount: 1 });
    const [week1] = fixture.weeks as [FixtureWeek];

    for (const leagueMemberId of fixture.memberIds) {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId,
        weekId: week1.weekId,
        gameId: week1.gameId,
        teamId: week1.homeTeamId,
      });
    }
    await finalizeHomeWin(week1.gameId);

    const summary = await settleSweep(db, clock);

    expect(summary).toMatchObject({ leagueSeasons: 1, weeks: 1, results: 2 });
    expect(await survivorPickResultsFor(db, fixture.leagueSeasonId)).toHaveLength(2);
  });
});
