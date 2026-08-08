import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "@picksleagues/core";
import {
  GAME_STATUS,
  MEMBER_ROLE,
  PICK_OUTCOME,
  SURVIVOR_MEMBER_STATUS,
  type SurvivorStandingsMember,
  type SurvivorStandingsResponse,
} from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { rebuildLeagueSeason } from "../src/services/settlement";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, seedSeason, setGame } from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF } from "./setup/league-app";
import {
  insertSurvivorPick,
  seedSurvivorSeason,
  SURVIVOR_WEEK_MS,
  type SeedSurvivorSeasonOptions,
} from "./setup/survivor-league";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff, getSurvivorStandings } = makeLeagueTestHarness();

type App = typeof app;

/**
 * Past every seeded kickoff, so the whole season's picks are revealed to
 * everybody. That is what lets the eliminated-vs-alive comparison below be an
 * equality over the entire payload: with nothing still withheld by timing, any
 * difference left would be a difference in *rights*.
 */
const SEASON_OVER = new Date(WEEK1_KICKOFF.getTime() + 52 * SURVIVOR_WEEK_MS);
const appAfterSeason = createApp({ auth, db, clock: async () => new FixedClock(SEASON_OVER) });
/** Settlement grades on game status, never on the clock. */
const settleClock = new FixedClock(SEASON_OVER);

const seedFixture = (opts: SeedSurvivorSeasonOptions = {}) => seedSurvivorSeason(db, auth, opts);

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

/** Home wins by two touchdowns — the fixture's ordinary "this game is over". */
async function finalizeHomeWin(gameId: string) {
  await setGame(db, gameId, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
}

async function board(
  cookie: string | undefined,
  leagueId: string,
  on: App = app,
): Promise<SurvivorStandingsResponse> {
  const response = await getSurvivorStandings(cookie, leagueId, on);
  expect(response.status).toBe(200);
  return (await response.json()) as SurvivorStandingsResponse;
}

function memberEntry(
  body: SurvivorStandingsResponse,
  leagueMemberId: string,
): SurvivorStandingsMember {
  const entry = body.members.find((member) => member.leagueMemberId === leagueMemberId);
  if (!entry) throw new Error(`no board entry for member ${leagueMemberId}`);
  return entry;
}

describe("GET /api/leagues/:leagueId/survivor/standings — refusals", () => {
  it("401s without a session", async () => {
    const fixture = await seedFixture();
    expect((await getSurvivorStandings(undefined, fixture.league.id)).status).toBe(401);
  });

  it("404s for a non-member — private leagues stay hidden", async () => {
    const fixture = await seedFixture();
    const outsider = await createAuthenticatedUser(auth);

    const response = await getSurvivorStandings(outsider.cookie, fixture.league.id);

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe("league_not_found");
  });

  it("400s a Pick'em league at the Survivor path", async () => {
    const { seasonId } = await seedSeason(db, { weeks: [{ weekNumber: 1 }] });
    const member = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId,
      members: [{ userId: member.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const response = await getSurvivorStandings(member.cookie, league.id);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("wrong_league_mode");
  });
});

describe("GET /api/leagues/:leagueId/survivor/standings — visibility", () => {
  it("withholds another member's team until their pick's game kicks off, while still showing they picked", async () => {
    const fixture = await seedFixture({ weekCount: 1, memberCount: 2 });
    const [memberA] = fixture.memberIds as [string];
    const [week1] = fixture.weeks as [(typeof fixture.weeks)[number]];
    await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberA,
      weekId: week1.weekId,
      gameId: week1.gameId,
      teamId: week1.homeTeamId,
    });
    const viewer = fixture.users[1]!.cookie;

    const before = await board(viewer, fixture.league.id);
    const after = await board(viewer, fixture.league.id, appAfterSeason);

    const hidden = memberEntry(before, memberA);
    // The entry existing is the "they're in" signal; the team is not.
    expect(hidden.picks).toEqual([{ weekId: week1.weekId, teamId: null, outcome: null }]);
    expect(hidden.consumedTeamIds).toEqual([]);
    expect(before.teams).toEqual([]);

    const revealed = memberEntry(after, memberA);
    expect(revealed.picks).toEqual([
      { weekId: week1.weekId, teamId: week1.homeTeamId, outcome: null },
    ]);
    expect(revealed.consumedTeamIds).toEqual([week1.homeTeamId]);
    expect(after.teams.map((team) => team.id)).toEqual([week1.homeTeamId]);
    // Their own board never withheld any of it.
    expect(memberEntry(await board(fixture.users[0]!.cookie, fixture.league.id), memberA)).toEqual({
      ...revealed,
      isViewer: true,
    });
  });

  it("derives another member's consumed teams from their revealed picks alone", async () => {
    const fixture = await seedFixture({ weekCount: 2, memberCount: 2 });
    const [memberA] = fixture.memberIds as [string];
    const [week1, week2] = fixture.weeks as [
      (typeof fixture.weeks)[number],
      (typeof fixture.weeks)[number],
    ];
    for (const week of [week1, week2]) {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId: memberA,
        weekId: week.weekId,
        gameId: week.gameId,
        teamId: week.homeTeamId,
      });
    }

    // Week 1 has kicked off on this clock; week 2 is still six days away.
    const league = await board(fixture.users[1]!.cookie, fixture.league.id, appAfterKickoff);
    const own = await board(fixture.users[0]!.cookie, fixture.league.id, appAfterKickoff);

    // The leak this rule exists to close: week 2's team is withheld above, so
    // listing it as consumed would disclose exactly what was withheld.
    expect(memberEntry(league, memberA).consumedTeamIds).toEqual([week1.homeTeamId]);
    expect(league.teams.map((team) => team.id)).toEqual([week1.homeTeamId]);
    expect(memberEntry(own, memberA).consumedTeamIds).toEqual([week1.homeTeamId, week2.homeTeamId]);
  });

  it("gives an eliminated member the identical board an alive member sees", async () => {
    const fixture = await seedFixture({ weekCount: 2, memberCount: 3 });
    const [memberA, memberB, memberC] = fixture.memberIds as [string, string, string];
    const [week1, week2] = fixture.weeks as [
      (typeof fixture.weeks)[number],
      (typeof fixture.weeks)[number],
    ];
    for (const memberId of [memberA, memberB]) {
      for (const week of [week1, week2]) {
        await insertSurvivorPick(db, {
          leagueSeasonId: fixture.leagueSeasonId,
          leagueMemberId: memberId,
          weekId: week.weekId,
          gameId: week.gameId,
          teamId: week.homeTeamId,
        });
      }
    }
    await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberC,
      weekId: week1.weekId,
      gameId: week1.gameId,
      teamId: week1.awayTeamId,
    });
    await finalizeHomeWin(week1.gameId);
    await finalizeHomeWin(week2.gameId);
    await rebuildLeagueSeason(db, settleClock, fixture.leagueSeasonId);

    const alive = await board(fixture.users[1]!.cookie, fixture.league.id, appAfterSeason);
    const eliminated = await board(fixture.users[2]!.cookie, fixture.league.id, appAfterSeason);

    expect(memberEntry(eliminated, memberC).status).toBe(SURVIVOR_MEMBER_STATUS.ELIMINATED);
    // Spec §Pick Visibility — eliminated players retain identical visibility
    // rights, so the only legitimate difference between the two payloads is
    // which entry each caller is looking at themselves through.
    expect(withoutViewerMarker(eliminated)).toEqual(withoutViewerMarker(alive));
  });
});

describe("GET /api/leagues/:leagueId/survivor/standings — settled state", () => {
  it("reports no last-updated stamp until settlement has written", async () => {
    const fixture = await seedFixture({ weekCount: 1, memberCount: 2 });

    const body = await board(fixture.users[0]!.cookie, fixture.league.id);

    expect(body.updatedAt).toBeNull();
    expect(body.concluded).toBe(false);
    expect(body.members.every((member) => member.status === SURVIVOR_MEMBER_STATUS.ALIVE)).toBe(
      true,
    );
  });

  it("reports the status, elimination week, and grades settlement wrote", async () => {
    const fixture = await seedFixture({ weekCount: 1, memberCount: 2 });
    const [memberA, memberB] = fixture.memberIds as [string, string];
    const [week1] = fixture.weeks as [(typeof fixture.weeks)[number]];
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
    await finalizeHomeWin(week1.gameId);
    await rebuildLeagueSeason(db, settleClock, fixture.leagueSeasonId);

    const body = await board(fixture.users[0]!.cookie, fixture.league.id, appAfterSeason);

    expect(memberEntry(body, memberA)).toMatchObject({
      status: SURVIVOR_MEMBER_STATUS.ALIVE,
      eliminatedWeekId: null,
      revivedCount: 0,
      picks: [{ weekId: week1.weekId, teamId: week1.homeTeamId, outcome: PICK_OUTCOME.CORRECT }],
    });
    expect(memberEntry(body, memberB)).toMatchObject({
      status: SURVIVOR_MEMBER_STATUS.ELIMINATED,
      eliminatedWeekId: week1.weekId,
      revivedCount: 0,
      picks: [{ weekId: week1.weekId, teamId: week1.awayTeamId, outcome: PICK_OUTCOME.INCORRECT }],
    });
    expect(body.updatedAt).not.toBeNull();
  });

  it("carries the revived marker when the everyone-out rule brought the league back", async () => {
    const fixture = await seedFixture({ weekCount: 1, memberCount: 2 });
    const [week1] = fixture.weeks as [(typeof fixture.weeks)[number]];
    for (const memberId of fixture.memberIds) {
      await insertSurvivorPick(db, {
        leagueSeasonId: fixture.leagueSeasonId,
        leagueMemberId: memberId,
        weekId: week1.weekId,
        gameId: week1.gameId,
        teamId: week1.awayTeamId,
      });
    }
    await finalizeHomeWin(week1.gameId);
    await rebuildLeagueSeason(db, settleClock, fixture.leagueSeasonId);

    const body = await board(fixture.users[0]!.cookie, fixture.league.id, appAfterSeason);

    for (const member of body.members) {
      expect(member).toMatchObject({
        status: SURVIVOR_MEMBER_STATUS.ALIVE,
        eliminatedWeekId: null,
        revivedCount: 1,
      });
    }
  });

  it("marks every member still alive a co-winner once the end week settles, and none before", async () => {
    const fixture = await seedFixture({ weekCount: 3, memberCount: 3 });
    const [memberA, memberB, memberC] = fixture.memberIds as [string, string, string];
    const [week1, week2, week3] = fixture.weeks as [
      (typeof fixture.weeks)[number],
      (typeof fixture.weeks)[number],
      (typeof fixture.weeks)[number],
    ];
    for (const memberId of [memberA, memberB]) {
      for (const week of [week1, week2, week3]) {
        await insertSurvivorPick(db, {
          leagueSeasonId: fixture.leagueSeasonId,
          leagueMemberId: memberId,
          weekId: week.weekId,
          gameId: week.gameId,
          teamId: week.homeTeamId,
        });
      }
    }
    await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberC,
      weekId: week1.weekId,
      gameId: week1.gameId,
      teamId: week1.awayTeamId,
    });

    await finalizeHomeWin(week1.gameId);
    await finalizeHomeWin(week2.gameId);
    await rebuildLeagueSeason(db, settleClock, fixture.leagueSeasonId);
    const midSeason = await board(fixture.users[0]!.cookie, fixture.league.id, appAfterSeason);

    await finalizeHomeWin(week3.gameId);
    await rebuildLeagueSeason(db, settleClock, fixture.leagueSeasonId);
    const final = await board(fixture.users[0]!.cookie, fixture.league.id, appAfterSeason);

    // Two members are alive with the season still running — alive is not won.
    expect(midSeason.concluded).toBe(false);
    expect(midSeason.members.every((member) => !member.isWinner)).toBe(true);

    expect(final.concluded).toBe(true);
    expect(memberEntry(final, memberA).isWinner).toBe(true);
    expect(memberEntry(final, memberB).isWinner).toBe(true);
    expect(memberEntry(final, memberC).isWinner).toBe(false);
    // The frame the history is indexed by, in the order the season plays.
    expect(final.weeks).toEqual([
      { weekId: week1.weekId, label: "Week 1" },
      { weekId: week2.weekId, label: "Week 2" },
      { weekId: week3.weekId, label: "Week 3" },
    ]);
  });
});

/**
 * Every board fact except which entry the caller is. Member order is normalized
 * too: `league_members` rows seeded in one batch share a `created_at`, so their
 * order within the board is Postgres's to choose and is not a claim either
 * payload makes.
 */
function withoutViewerMarker(body: SurvivorStandingsResponse) {
  return {
    ...body,
    members: body.members
      .map((member) => ({ ...member, isViewer: false }))
      .sort((a, b) => a.leagueMemberId.localeCompare(b.leagueMemberId)),
  };
}
