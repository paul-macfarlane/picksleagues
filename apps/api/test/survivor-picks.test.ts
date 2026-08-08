import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { isUniqueViolation } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  GAME_STATUS,
  MEMBER_ROLE,
  PICK_OUTCOME,
  SURVIVOR_EVERYONE_OUT,
  SURVIVOR_PUSH_TIE_RESOLUTION,
  WEEK_TYPE,
  type SurvivorSettings,
  type SurvivorWeekPicksResponse,
} from "@picksleagues/schemas";
import { rebuildLeagueSeason } from "../src/services/settlement";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import {
  DEFAULT_SURVIVOR_SETTINGS,
  insertLeague,
  seedSeason,
  setGame,
  type SeededWeek,
} from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF, withCookie } from "./setup/league-app";
import {
  insertSurvivorPick,
  insertSurvivorState,
  seedSurvivorLeague,
  survivorPicksFor,
} from "./setup/survivor-league";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff, getSurvivorPicks, putSurvivorPick } =
  makeLeagueTestHarness();

const WEEK1_GAME2_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 60 * 60 * 1000);
const WEEK2_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000);

/**
 * Two regular weeks. Week 1's first game kicks off exactly at the harness's
 * post-kickoff clock, its second an hour later — which is what lets one clock
 * hold a locked pick and an unlocked alternative at the same instant.
 */
const TWO_WEEK_SLATE: SeededWeek[] = [
  {
    weekNumber: 1,
    kickoffs: [{ kickoffAt: WEEK1_KICKOFF }, { kickoffAt: WEEK1_GAME2_KICKOFF }],
  },
  { weekNumber: 2, kickoffs: [{ kickoffAt: WEEK2_KICKOFF }] },
];

async function seedLeague(opts: { settings?: SurvivorSettings; weeks?: SeededWeek[] } = {}) {
  const base = await seedSurvivorLeague(db, auth, {
    weeks: opts.weeks ?? TWO_WEEK_SLATE,
    settings: opts.settings,
    members: [{ username: "member_a" }, { username: "member_b" }],
  });
  const [memberA, memberB] = base.users;
  const [week1Game1, week1Game2] = base.gameIds.get("regular:1") as [string, string];
  const [week2Game1] = base.gameIds.get("regular:2") as [string];
  return {
    ...base,
    memberA: memberA!,
    memberB: memberB!,
    memberAId: base.members.get(memberA!.user.id)!,
    memberBId: base.members.get(memberB!.user.id)!,
    week1: base.weekIds.get("regular:1")!,
    week2: base.weekIds.get("regular:2")!,
    week1Game1,
    week1Game2,
    week2Game1,
  };
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("survivor_picks constraints", () => {
  it("enforces one pick per member per week, and the team ledger as a PARTIAL unique", async () => {
    const rows = (
      await db.execute(
        sql`select indexname, indexdef from pg_indexes where tablename = 'survivor_picks'`,
      )
    ).rows as Array<{ indexname: string; indexdef: string }>;
    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));

    expect(byName.has("survivor_picks_member_week_unique")).toBe(true);

    const ledger = byName.get("survivor_picks_member_team_unique");
    expect(ledger).toBeDefined();
    expect(ledger).toMatch(/UNIQUE INDEX/i);
    // The predicate is the whole point: a plain unique under this name would
    // block the re-pick of a team a cancellation released.
    expect(ledger).toMatch(/WHERE/i);
    expect(ledger).toMatch(/released/i);
  });
});

describe("PUT /api/leagues/:leagueId/survivor/weeks/:weekId/pick", () => {
  it("401s without a session", async () => {
    const { league, week1, week1Game1, teamIds } = await seedLeague();

    const response = await putSurvivorPick(undefined, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });

    expect(response.status).toBe(401);
  });

  it("404s for a non-member — private leagues stay hidden", async () => {
    const { league, week1, week1Game1, teamIds } = await seedLeague();
    const outsider = await createAuthenticatedUser(auth);

    const response = await putSurvivorPick(outsider.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe("league_not_found");
  });

  it("400s a Pick'em league at the Survivor path", async () => {
    const { seasonId, weekIds, gameIds, teamIds } = await seedSeason(db, { weeks: TWO_WEEK_SLATE });
    const member = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId,
      members: [{ userId: member.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const response = await putSurvivorPick(member.cookie, league.id, weekIds.get("regular:1")!, {
      gameId: gameIds.get("regular:1")![0]!,
      teamId: teamIds.home,
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("wrong_league_mode");
  });

  it("400s a week outside the league's resolved range", async () => {
    const { league, memberA, week2, week2Game1, teamIds } = await seedLeague({
      settings: {
        ...DEFAULT_SURVIVOR_SETTINGS,
        endWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
      },
    });

    const response = await putSurvivorPick(memberA.cookie, league.id, week2, {
      gameId: week2Game1,
      teamId: teamIds.home,
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("week_out_of_range");
  });

  it("400s a game that isn't in the requested week", async () => {
    const { league, memberA, week1, week2Game1, teamIds } = await seedLeague();

    const response = await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week2Game1,
      teamId: teamIds.home,
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("game_not_in_week");
  });

  it("409s a team that isn't playing in the picked game", async () => {
    const { league, memberA, week1, week1Game1 } = await seedLeague();

    const response = await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: randomUUID(),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("team_not_in_game");
  });

  it("409s a cancelled game — a push is never something a member may newly choose", async () => {
    const { league, memberA, week1, week1Game1, teamIds } = await seedLeague();
    await setGame(db, week1Game1, { status: GAME_STATUS.CANCELLED });

    const response = await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("game_not_pickable");
  });

  it("replaces the week's pick rather than adding one — a pick is changeable until kickoff", async () => {
    const { league, memberA, memberAId, leagueSeasonId, week1, week1Game1, week1Game2, teamIds } =
      await seedLeague();

    await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });
    const second = await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game2,
      teamId: teamIds.away,
    });

    expect(second.status).toBe(200);
    const stored = await survivorPicksFor(db, leagueSeasonId, memberAId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ gameId: week1Game2, teamId: teamIds.away });
  });

  it("409s once the picked game has kicked off, leaving the stored pick untouched", async () => {
    const { league, memberA, memberAId, leagueSeasonId, week1, week1Game1, week1Game2, teamIds } =
      await seedLeague();
    await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game2,
      teamId: teamIds.away,
    });

    // `appAfterKickoff` sits one millisecond past game 1's kickoff.
    const response = await putSurvivorPick(
      memberA.cookie,
      league.id,
      week1,
      { gameId: week1Game1, teamId: teamIds.home },
      appAfterKickoff,
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("pick_locked");
    const stored = await survivorPicksFor(db, leagueSeasonId, memberAId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ gameId: week1Game2, teamId: teamIds.away });
  });

  it("409s a change out of a pick whose own game has kicked off, even into an unstarted one", async () => {
    const { league, memberA, memberAId, leagueSeasonId, week1, week1Game1, week1Game2, teamIds } =
      await seedLeague();
    await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });

    // Game 2 is still an hour away on this clock; the pick being replaced is not.
    const response = await putSurvivorPick(
      memberA.cookie,
      league.id,
      week1,
      { gameId: week1Game2, teamId: teamIds.away },
      appAfterKickoff,
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("pick_locked");
    const stored = await survivorPicksFor(db, leagueSeasonId, memberAId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ gameId: week1Game1, teamId: teamIds.home });
  });

  it("409s a team the member has already used in another week", async () => {
    const {
      league,
      memberA,
      memberAId,
      leagueSeasonId,
      week1,
      week1Game1,
      week2,
      week2Game1,
      teamIds,
    } = await seedLeague();
    await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });

    const response = await putSurvivorPick(memberA.cookie, league.id, week2, {
      gameId: week2Game1,
      teamId: teamIds.home,
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("team_consumed");
    expect(await survivorPicksFor(db, leagueSeasonId, memberAId)).toHaveLength(1);
  });

  it("has the database refuse the reuse too, under the name the service maps", async () => {
    const { memberAId, leagueSeasonId, week1, week1Game1, week2, week2Game1, teamIds } =
      await seedLeague();
    await insertSurvivorPick(db, {
      leagueSeasonId,
      leagueMemberId: memberAId,
      weekId: week1,
      gameId: week1Game1,
      teamId: teamIds.home,
    });

    let caught: unknown;
    try {
      await insertSurvivorPick(db, {
        leagueSeasonId,
        leagueMemberId: memberAId,
        weekId: week2,
        gameId: week2Game1,
        teamId: teamIds.home,
      });
    } catch (error) {
      caught = error;
    }

    // Both halves matter: the constraint fires without the service's help, and
    // the helper the service's backstop calls recognizes what it raised.
    expect(caught).toBeDefined();
    expect(isUniqueViolation(caught, "survivor_picks_member_team_unique")).toBe(true);
  });

  it("lets a released team be picked again — a cancellation hands it back", async () => {
    const {
      league,
      memberA,
      memberAId,
      leagueSeasonId,
      week1,
      week1Game1,
      week2,
      week2Game1,
      teamIds,
    } = await seedLeague();
    // What settlement writes after a cancellation: the pick stands, the team
    // does not count against the ledger.
    await insertSurvivorPick(db, {
      leagueSeasonId,
      leagueMemberId: memberAId,
      weekId: week1,
      gameId: week1Game1,
      teamId: teamIds.home,
      released: true,
    });

    const response = await putSurvivorPick(memberA.cookie, league.id, week2, {
      gameId: week2Game1,
      teamId: teamIds.home,
    });

    expect(response.status).toBe(200);
    const stored = await survivorPicksFor(db, leagueSeasonId, memberAId);
    expect(stored.find((pick) => pick.weekId === week2)).toMatchObject({
      teamId: teamIds.home,
      released: false,
    });
  });

  it.each([
    { ledger: "no row at all", eliminated: false, expected: 200 },
    { ledger: "a row with no elimination week", eliminated: false, seedRow: true, expected: 200 },
    { ledger: "a row naming an elimination week", eliminated: true, seedRow: true, expected: 409 },
  ])(
    "judges elimination on settled state: $ledger → $expected",
    async ({ eliminated, seedRow, expected }) => {
      const { league, memberA, memberAId, leagueSeasonId, week1, week2, week2Game1, teamIds } =
        await seedLeague();
      if (seedRow) {
        await insertSurvivorState(db, {
          leagueSeasonId,
          leagueMemberId: memberAId,
          eliminatedWeekId: eliminated ? week1 : null,
        });
      }

      const response = await putSurvivorPick(memberA.cookie, league.id, week2, {
        gameId: week2Game1,
        teamId: teamIds.away,
      });

      expect(response.status).toBe(expected);
      if (expected === 409) {
        // The refusal about *them*, not the one about the league: this two-member
        // fixture is also a decided season now, and the personal reason wins
        // (ADR-0027).
        expect(((await response.json()) as { error: string }).error).toBe("member_eliminated");
        expect(await survivorPicksFor(db, leagueSeasonId, memberAId)).toHaveLength(0);
      } else {
        expect(await survivorPicksFor(db, leagueSeasonId, memberAId)).toHaveLength(1);
      }
    },
  );

  it("refuses the last member standing — a decided season takes no more picks", async () => {
    const {
      league,
      memberA,
      memberAId,
      memberBId,
      leagueSeasonId,
      week1,
      week2,
      week2Game1,
      teamIds,
    } = await seedLeague();
    await insertSurvivorState(db, {
      leagueSeasonId,
      leagueMemberId: memberBId,
      eliminatedWeekId: week1,
    });

    const response = await putSurvivorPick(memberA.cookie, league.id, week2, {
      gameId: week2Game1,
      teamId: teamIds.home,
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("league_concluded");
    expect(await survivorPicksFor(db, leagueSeasonId, memberAId)).toHaveLength(0);
  });

  it("splits the refusal in an emptied co-win league: the co-winners hear the league is over, the member they outlasted hears they are out", async () => {
    const base = await seedSurvivorLeague(db, auth, {
      weeks: TWO_WEEK_SLATE,
      settings: { ...DEFAULT_SURVIVOR_SETTINGS, everyoneOut: SURVIVOR_EVERYONE_OUT.CO_WIN },
      members: [{ username: "cowin_a" }, { username: "cowin_b" }, { username: "out_early_c" }],
    });
    const [coWinner, , beaten] = base.users as [
      (typeof base.users)[number],
      (typeof base.users)[number],
      (typeof base.users)[number],
    ];
    const week1 = base.weekIds.get("regular:1")!;
    const week2 = base.weekIds.get("regular:2")!;
    // The ledger an emptied co-win league leaves: the last pair go out together
    // in week 2, having outlasted the member who went out in week 1.
    await insertSurvivorState(db, {
      leagueSeasonId: base.leagueSeasonId,
      leagueMemberId: base.members.get(beaten.user.id)!,
      eliminatedWeekId: week1,
    });
    for (const user of [base.users[0]!, base.users[1]!]) {
      await insertSurvivorState(db, {
        leagueSeasonId: base.leagueSeasonId,
        leagueMemberId: base.members.get(user.user.id)!,
        eliminatedWeekId: week2,
      });
    }
    const submission = { gameId: base.gameIds.get("regular:2")![0]!, teamId: base.teamIds.home };

    const winnerResponse = await putSurvivorPick(
      coWinner.cookie,
      base.league.id,
      week2,
      submission,
    );
    const beatenResponse = await putSurvivorPick(beaten.cookie, base.league.id, week2, submission);

    // A co-winner is an eliminated member, so the refusal about the *league*
    // has to win over the one about them personally (ADR-0028).
    expect(winnerResponse.status).toBe(409);
    expect(((await winnerResponse.json()) as { error: string }).error).toBe("league_concluded");
    expect(beatenResponse.status).toBe(409);
    expect(((await beatenResponse.json()) as { error: string }).error).toBe("member_eliminated");
    expect(
      await survivorPicksFor(db, base.leagueSeasonId, base.members.get(coWinner.user.id)!),
    ).toHaveLength(0);
  });

  it("still takes a pick while two members are alive", async () => {
    const base = await seedSurvivorLeague(db, auth, {
      weeks: TWO_WEEK_SLATE,
      members: [{ username: "alive_a" }, { username: "alive_b" }, { username: "out_c" }],
    });
    const memberAId = base.members.get(base.users[0]!.user.id)!;
    await insertSurvivorState(db, {
      leagueSeasonId: base.leagueSeasonId,
      leagueMemberId: base.members.get(base.users[2]!.user.id)!,
      eliminatedWeekId: base.weekIds.get("regular:1")!,
    });

    const response = await putSurvivorPick(
      base.users[0]!.cookie,
      base.league.id,
      base.weekIds.get("regular:2")!,
      { gameId: base.gameIds.get("regular:2")![0]!, teamId: base.teamIds.home },
    );

    expect(response.status).toBe(200);
    expect(await survivorPicksFor(db, base.leagueSeasonId, memberAId)).toHaveLength(1);
  });
});

describe("GET /api/leagues/:leagueId/survivor/weeks/:weekId/picks", () => {
  it("hides another member's pick until its game kicks off, while showing that they picked", async () => {
    const { league, memberA, memberB, memberAId, week1, week1Game1, teamIds } = await seedLeague();
    await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });

    const before = (await (
      await getSurvivorPicks(memberB.cookie, league.id, week1)
    ).json()) as SurvivorWeekPicksResponse;
    const after = (await (
      await getSurvivorPicks(memberB.cookie, league.id, week1, appAfterKickoff)
    ).json()) as SurvivorWeekPicksResponse;

    const hidden = before.members.find((member) => member.leagueMemberId === memberAId);
    expect(hidden).toMatchObject({ hasPicked: true, pick: null });

    const revealed = after.members.find((member) => member.leagueMemberId === memberAId);
    expect(revealed?.hasPicked).toBe(true);
    expect(revealed?.pick).toMatchObject({ gameId: week1Game1, teamId: teamIds.home });
  });

  it("always shows the caller their own pick", async () => {
    const { league, memberA, memberAId, week1, week1Game1, teamIds } = await seedLeague();
    await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });

    const body = (await (
      await getSurvivorPicks(memberA.cookie, league.id, week1)
    ).json()) as SurvivorWeekPicksResponse;

    const own = body.members.find((member) => member.leagueMemberId === memberAId);
    expect(own).toMatchObject({ isViewer: true, hasPicked: true });
    // Ungraded until settlement reaches the week — the state the sheet reports
    // as "not graded yet", and distinct from having no pick at all.
    expect(own?.pick).toMatchObject({ gameId: week1Game1, teamId: teamIds.home, outcome: null });
  });

  it("withholds a settled pick's outcome from the league until its game kicks off", async () => {
    const {
      league,
      memberA,
      memberB,
      memberAId,
      leagueSeasonId,
      week1,
      week1Game1,
      week1Game2,
      teamIds,
    } = await seedLeague();
    await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });
    // Both of the week's games, because settlement grades whole weeks in order
    // (ADR-0025) — one unfinished game leaves the week ungraded.
    for (const gameId of [week1Game1, week1Game2]) {
      await setGame(db, gameId, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
    }
    await rebuildLeagueSeason(db, new FixedClock(WEEK1_KICKOFF), leagueSeasonId);

    const before = (await (
      await getSurvivorPicks(memberB.cookie, league.id, week1)
    ).json()) as SurvivorWeekPicksResponse;
    const after = (await (
      await getSurvivorPicks(memberB.cookie, league.id, week1, appAfterKickoff)
    ).json()) as SurvivorWeekPicksResponse;
    const own = (await (
      await getSurvivorPicks(memberA.cookie, league.id, week1)
    ).json()) as SurvivorWeekPicksResponse;

    // The grade is as disclosing as the team: "correct" on a pick nobody may
    // see yet names the side that won (spec §Pick Visibility), so it is
    // withheld with the pick it grades rather than beside it.
    expect(before.members.find((member) => member.leagueMemberId === memberAId)).toMatchObject({
      hasPicked: true,
      pick: null,
    });
    expect(after.members.find((member) => member.leagueMemberId === memberAId)?.pick).toMatchObject(
      {
        teamId: teamIds.home,
        outcome: PICK_OUTCOME.CORRECT,
      },
    );
    // Their own pick carries it whatever the clock says.
    expect(own.members.find((member) => member.leagueMemberId === memberAId)?.pick).toMatchObject({
      teamId: teamIds.home,
      outcome: PICK_OUTCOME.CORRECT,
    });
  });

  it("reports elimination from the settled ledger, treating a missing row as alive", async () => {
    const { league, memberA, memberAId, memberBId, leagueSeasonId, week1 } = await seedLeague();
    await insertSurvivorState(db, {
      leagueSeasonId,
      leagueMemberId: memberBId,
      eliminatedWeekId: week1,
    });

    const body = (await (
      await getSurvivorPicks(memberA.cookie, league.id, week1)
    ).json()) as SurvivorWeekPicksResponse;

    expect(body.members.find((m) => m.leagueMemberId === memberAId)?.eliminated).toBe(false);
    expect(body.members.find((m) => m.leagueMemberId === memberBId)?.eliminated).toBe(true);
  });

  it("lists the caller's consumed teams, excluding the week they are still free to change", async () => {
    const { league, memberA, week1, week1Game1, week2, week2Game1, teamIds } = await seedLeague();
    await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });
    await putSurvivorPick(memberA.cookie, league.id, week2, {
      gameId: week2Game1,
      teamId: teamIds.away,
    });

    const week2Body = (await (
      await getSurvivorPicks(memberA.cookie, league.id, week2)
    ).json()) as SurvivorWeekPicksResponse;
    const week1Body = (await (
      await getSurvivorPicks(memberA.cookie, league.id, week1)
    ).json()) as SurvivorWeekPicksResponse;

    expect(week2Body.consumedTeamIds).toEqual([teamIds.home]);
    expect(week1Body.consumedTeamIds).toEqual([teamIds.away]);
  });

  it("does not leak another member's consumed teams", async () => {
    const { league, memberA, memberB, week1, week1Game1, teamIds } = await seedLeague();
    await putSurvivorPick(memberA.cookie, league.id, week1, {
      gameId: week1Game1,
      teamId: teamIds.home,
    });

    const body = (await (
      await getSurvivorPicks(memberB.cookie, league.id, week1)
    ).json()) as SurvivorWeekPicksResponse;

    expect(body.consumedTeamIds).toEqual([]);
  });

  it("400s a postseason week — Survivor is regular-season only", async () => {
    const base = await seedSurvivorLeague(db, auth, {
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
        { weekType: WEEK_TYPE.POSTSEASON, weekNumber: 1, kickoffs: [] },
      ],
      members: [{ username: "solo_member" }],
      settings: {
        startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
        pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
        everyoneOut: SURVIVOR_EVERYONE_OUT.REVIVE,
      },
    });

    const response = await getSurvivorPicks(
      base.users[0]!.cookie,
      base.league.id,
      base.weekIds.get("postseason:1")!,
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("week_out_of_range");
  });

  it("401s without a session", async () => {
    const { league, week1 } = await seedLeague();
    const response = await app.request(`/api/leagues/${league.id}/survivor/weeks/${week1}/picks`, {
      headers: withCookie(undefined),
    });
    expect(response.status).toBe(401);
  });
});
