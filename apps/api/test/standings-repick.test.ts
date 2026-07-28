import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueMembers, oddsSnapshots, pickemPicks } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  ELIMINATION_PUSH_TIE_RESOLUTION,
  GAME_STATUS,
  LEAGUE_MODE,
  LEAGUE_STATUS,
  MEMBER_ROLE,
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  WEEK_TYPE,
  type PickemStandingsResponse,
  type PickemSettings,
  type PickemWeekPicksResponse,
} from "@picksleagues/schemas";
import { settleLeagueSeasonWeeks } from "../src/services/pickem/settlement";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import {
  DEFAULT_PICKEM_SETTINGS,
  FOUR_GAME_WEEK,
  insertLeague,
  insertPick,
  membersOf,
  pickResultsFor,
  SEED_AT,
  seedSeason,
  setGame,
  type SeededWeek,
} from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF } from "./setup/league-app";
import { seedPickemLeague as seedPickemLeagueBase } from "./setup/pickem-league";
import { resetDb } from "./setup/reset-db";

const { db, auth, appAfterKickoff, appAtKickoff, getPicks, putPicks, postRepick, getStandings } =
  makeLeagueTestHarness();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("GET /api/leagues/:leagueId/pickem/standings", () => {
  /**
   * A league + season/members, seeded directly. Standings are written
   * exclusively by settlement (arch D10), so these tests insert picks
   * straight into `pickem_picks` and drive `settleLeagueSeasonWeeks` rather
   * than going through the pick-submission API — mirrors settlement.test.ts.
   */
  async function seedStandingsLeague(
    opts: {
      settings?: PickemSettings;
      weeks?: SeededWeek[];
      displayNames?: string[];
    } = {},
  ) {
    const {
      settings,
      weeks = [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
      displayNames = ["Alpha", "Bravo", "Charlie"],
    } = opts;
    return seedPickemLeagueBase(db, auth, {
      weeks,
      settings,
      members: displayNames.map((displayName) => ({
        username: displayName.toLowerCase(),
        displayName,
      })),
    });
  }

  it("401s without a session", async () => {
    const { league } = await seedStandingsLeague();
    const res = await getStandings(undefined, league.id);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("404s league_not_found for a non-member, and for an unknown league id", async () => {
    const { league, users } = await seedStandingsLeague();
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });

    const nonMember = await getStandings(outsider.cookie, league.id);
    expect(nonMember.status).toBe(404);
    expect(await nonMember.json()).toMatchObject({ error: "league_not_found" });

    const unknownLeague = await getStandings(users[0]!.cookie, randomUUID());
    expect(unknownLeague.status).toBe(404);
    expect(await unknownLeague.json()).toMatchObject({ error: "league_not_found" });
  });

  it("400s a malformed ?week= that isn't a uuid", async () => {
    const { league, users } = await seedStandingsLeague();
    const res = await getStandings(users[0]!.cookie, league.id, "?week=not-a-uuid");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation" });
  });

  it("400s week_out_of_range for a well-formed week id that belongs to a different sport season", async () => {
    // Distinct from the malformed-uuid case above: this week id is real, just
    // not a week of *this* league's season instance — refused rather than
    // answered with an empty board (services/pickem/standings.ts).
    const { league, users } = await seedStandingsLeague();
    const otherSeason = await seedSeason(db, {
      year: 2027,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
    });
    const otherSeasonWeekId = otherSeason.weekIds.get("regular:1")!;

    const res = await getStandings(users[0]!.cookie, league.id, `?week=${otherSeasonWeekId}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "week_out_of_range" });
  });

  it("400s wrong_league_mode for a league that isn't Pick'em", async () => {
    // Matches every sibling under /pickem/ (league-weeks.test.ts's identical
    // case) — without this check the path would serve a zero-filled board
    // for an Elimination league instead of refusing.
    const { seasonId } = await seedSeason(db, {
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
    });
    const member = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId,
      mode: LEAGUE_MODE.ELIMINATION,
      settings: {
        startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        endWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        pickType: PICK_TYPE.STRAIGHT_UP,
        pushTieResolution: ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE,
      },
      members: [{ userId: member.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await getStandings(member.cookie, league.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "wrong_league_mode" });
  });

  it("shows every member at zero with a null lastUpdatedAt for a league that has never settled", async () => {
    // Not an empty board: the read is driven from `league_members`, so a member
    // is on the board from the moment they join rather than from the first
    // settlement (spec §Edge Cases). A null stamp is what says nothing has run.
    const { league, users } = await seedStandingsLeague();
    const res = await getStandings(users[0]!.cookie, league.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemStandingsResponse;
    expect(body.rows).toHaveLength(users.length);
    expect(body.rows.every((row) => row.points === 0 && row.differential === 0)).toBe(true);
    // The record zero-fills the same way — 0-0-0 is a real record, not a gap.
    expect(body.rows.every((row) => row.wins === 0 && row.losses === 0 && row.pushes === 0)).toBe(
      true,
    );
    expect(body.lastUpdatedAt).toBeNull();
  });

  it("puts a member who joined after the last settlement on the board at zero", async () => {
    // Before the read was driven from `league_members`, a post-settlement
    // joiner was absent from the board entirely — not even at zero.
    const { league, leagueSeasonId, weekIds, gameIds, users, members } =
      await seedStandingsLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const alpha = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: alpha,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 });
    await settleLeagueSeasonWeeks(
      db,
      new FixedClock(new Date("2026-09-20T00:00:00.000Z")),
      leagueSeasonId,
      [weekId],
    );

    const joiner = await createAuthenticatedUser(auth, { username: "late_joiner" });
    await db.insert(leagueMembers).values({
      leagueId: league.id,
      userId: joiner.user.id,
      role: MEMBER_ROLE.MEMBER,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    });

    const body = (await (
      await getStandings(users[0]!.cookie, league.id)
    ).json()) as PickemStandingsResponse;

    const joinerRow = body.rows.find((row) => row.userId === joiner.user.id);
    expect(joinerRow).toBeDefined();
    expect(joinerRow).toMatchObject({ points: 0, differential: 0 });
  });

  it("orders season rows by rank, shares a rank on a full tie and skips the next, and marks isViewer only on the caller's own row", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, users, members } = await seedStandingsLeague({
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
    const alpha = members.get(users[0]!.user.id)!;
    const bravo = members.get(users[1]!.user.id)!;
    const charlie = members.get(users[2]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: alpha,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: bravo,
      weekId,
      gameId: g2!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: charlie,
      weekId,
      gameId: g3!,
      side: PICKEM_PICK_SIDE.HOME,
    });

    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 30, awayScore: 20 }); // alpha: correct, +10
    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 25, awayScore: 15 }); // bravo: correct, +10 (ties alpha)
    await setGame(db, g3!, { status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 15 }); // charlie: correct, +5

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const res = await getStandings(users[0]!.cookie, league.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemStandingsResponse;

    expect(body.rows.map((row) => row.displayName)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(body.rows[0]).toMatchObject({ points: 1, differential: 10, rank: 1, isViewer: true });
    expect(body.rows[1]).toMatchObject({ points: 1, differential: 10, rank: 1, isViewer: false });
    expect(body.rows[2]).toMatchObject({ points: 1, differential: 5, rank: 3, isViewer: false }); // skips rank 2
  });

  it("serves each member's settled W/L/P, and 0-0-0 for one with nothing settled", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, users, members } = await seedStandingsLeague({
      displayNames: ["Alpha", "Bravo"],
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
    const alpha = members.get(users[0]!.user.id)!;

    for (const gameId of [g1!, g2!, g3!]) {
      await insertPick(db, {
        leagueSeasonId,
        leagueMemberId: alpha,
        weekId,
        gameId,
        side: PICKEM_PICK_SIDE.HOME,
      });
    }
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 }); // correct
    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 10, awayScore: 24 }); // incorrect
    await setGame(db, g3!, { status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 20 }); // push

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const body = (await (
      await getStandings(users[0]!.cookie, league.id)
    ).json()) as PickemStandingsResponse;

    expect(body.rows.find((row) => row.displayName === "Alpha")).toMatchObject({
      wins: 1,
      losses: 1,
      pushes: 1,
    });
    expect(body.rows.find((row) => row.displayName === "Bravo")).toMatchObject({
      wins: 0,
      losses: 0,
      pushes: 0,
    });
  });

  it("weekly board carries only that week's points, while the season board sums across weeks", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, users, members } = await seedStandingsLeague({
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
    const alpha = members.get(users[0]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: alpha,
      weekId: week1Id,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: alpha,
      weekId: week2Id,
      gameId: g2!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 }); // correct, +14
    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 24 }); // incorrect, -4

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [week1Id, week2Id]);

    const weeklyRes = await getStandings(users[0]!.cookie, league.id, `?week=${week1Id}`);
    expect(weeklyRes.status).toBe(200);
    const weeklyBody = (await weeklyRes.json()) as PickemStandingsResponse;
    const weeklyRow = weeklyBody.rows.find((row) => row.userId === users[0]!.user.id)!;
    expect(weeklyRow).toMatchObject({ points: 1, differential: 14 });
    expect(weeklyBody.weekId).toBe(week1Id);

    const seasonRes = await getStandings(users[0]!.cookie, league.id);
    expect(seasonRes.status).toBe(200);
    const seasonBody = (await seasonRes.json()) as PickemStandingsResponse;
    const seasonRow = seasonBody.rows.find((row) => row.userId === users[0]!.user.id)!;
    expect(seasonRow).toMatchObject({ points: 1, differential: 10 }); // 14 - 4, summed across both weeks
    expect(seasonBody.weekId).toBeNull();
  });

  it("a member who submitted nothing still appears with 0 points", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, users, members } = await seedStandingsLeague({
      displayNames: ["Alpha", "Bravo"],
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const picker = members.get(users[0]!.user.id)!;
    const nonPicker = users[1]!;

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

    const res = await getStandings(nonPicker.cookie, league.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemStandingsResponse;
    const row = body.rows.find((r) => r.userId === nonPicker.user.id)!;
    expect(row).toMatchObject({ points: 0, differential: 0 });
  });

  it("lastUpdatedAt is an ISO timestamp once settlement has run", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, users, members } = await seedStandingsLeague({
      displayNames: ["Alpha"],
    });
    const weekId = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const alpha = members.get(users[0]!.user.id)!;
    await insertPick(db, {
      leagueSeasonId,
      leagueMemberId: alpha,
      weekId,
      gameId: g1!,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const res = await getStandings(users[0]!.cookie, league.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemStandingsResponse;
    expect(body.lastUpdatedAt).not.toBeNull();
    expect(new Date(body.lastUpdatedAt!).toString()).not.toBe("Invalid Date");
  });
});

describe("POST /api/leagues/:leagueId/pickem/weeks/:weekId/repick", () => {
  async function seedRepickLeague(opts: { settings?: PickemSettings; weeks?: SeededWeek[] } = {}) {
    const { settings, weeks = FOUR_GAME_WEEK } = opts;
    const base = await seedPickemLeagueBase(db, auth, {
      weeks,
      settings,
      members: [{ username: "member_a" }, { username: "member_b" }],
    });
    const [memberA, memberB] = base.users;
    return {
      league: base.league,
      leagueSeasonId: base.leagueSeasonId,
      weekIds: base.weekIds,
      gameIds: base.gameIds,
      memberA: memberA!,
      memberB: memberB!,
    };
  }

  /** Total pick rows one member holds in a league's current season instance. */
  async function memberPickCount(leagueSeasonId: string, leagueMemberId: string): Promise<number> {
    const rows = await db
      .select()
      .from(pickemPicks)
      .where(
        and(
          eq(pickemPicks.leagueSeasonId, leagueSeasonId),
          eq(pickemPicks.leagueMemberId, leagueMemberId),
        ),
      );
    return rows.length;
  }

  it("401s without a session", async () => {
    const { league, weekIds } = await seedRepickLeague();
    const res = await postRepick(undefined, league.id, weekIds.get("regular:1")!, {
      replacePickId: randomUUID(),
      gameId: randomUUID(),
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("404s league_not_found for a non-member", async () => {
    const { league, weekIds } = await seedRepickLeague();
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });
    const res = await postRepick(outsider.cookie, league.id, weekIds.get("regular:1")!, {
      replacePickId: randomUUID(),
      gameId: randomUUID(),
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "league_not_found" });
  });

  it("409s league_concluded on the repick path once the season has concluded", async () => {
    // The concluded check runs right after preflight, before the pick being
    // replaced is even loaded — so a garbage replacePickId/gameId still
    // exercises the refusal this test targets.
    const base = await seedPickemLeagueBase(db, auth, {
      weeks: FOUR_GAME_WEEK,
      status: LEAGUE_STATUS.CONCLUDED,
      members: [{ username: "member_a" }, { username: "member_b" }],
    });
    const memberA = base.users[0]!;
    const weekId = base.weekIds.get("regular:1")!;

    const res = await postRepick(memberA.cookie, base.league.id, weekId, {
      replacePickId: randomUUID(),
      gameId: randomUUID(),
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "league_concluded" });
  });

  it("substitutes a pick whose game was cancelled, leaving the member's total pick count unchanged", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as PickemWeekPicksResponse;
    const g1PickId = initialBody.members
      .find((m) => m.userId === memberA.user.id)!
      .picks.find((p) => p.gameId === g1)!.id;

    await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });

    const memberId = (await membersOf(db, league.id)).get(memberA.user.id)!;
    expect(await memberPickCount(leagueSeasonId, memberId)).toBe(2);

    const res = await postRepick(memberA.cookie, league.id, weekId, {
      replacePickId: g1PickId,
      gameId: g3,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemWeekPicksResponse;
    const own = body.members.find((m) => m.userId === memberA.user.id)!;
    expect(own.picks.map((p) => p.gameId).sort()).toEqual([g2, g3].sort());
    expect(own.picks.find((p) => p.gameId === g1)).toBeUndefined();

    expect(await memberPickCount(leagueSeasonId, memberId)).toBe(2);
  });

  it("substitutes a pick whose game moved out of the week", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, memberA } = await seedRepickLeague({
      weeks: [
        ...FOUR_GAME_WEEK,
        {
          weekNumber: 2,
          kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
        },
      ],
    });
    const week1Id = weekIds.get("regular:1")!;
    const week2Id = weekIds.get("regular:2")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const initial = await putPicks(memberA.cookie, league.id, week1Id, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as PickemWeekPicksResponse;
    const g1PickId = initialBody.members
      .find((m) => m.userId === memberA.user.id)!
      .picks.find((p) => p.gameId === g1)!.id;

    await setGame(db, g1!, { weekId: week2Id });

    const memberId = (await membersOf(db, league.id)).get(memberA.user.id)!;

    const res = await postRepick(memberA.cookie, league.id, week1Id, {
      replacePickId: g1PickId,
      gameId: g3,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemWeekPicksResponse;
    const own = body.members.find((m) => m.userId === memberA.user.id)!;
    expect(own.picks.map((p) => p.gameId).sort()).toEqual([g2, g3].sort());

    expect(await memberPickCount(leagueSeasonId, memberId)).toBe(2);
  });

  it("earns a substitution even when the cancellation is discovered after the replaced game's own kickoff has passed (ADR-0015: keyed on pickable, not locked)", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, , , g4] = gameIds.get("regular:1")!; // g4 kicks off 3h after g1 — still unstarted post-kickoff

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(initial.status).toBe(200);
    const g1PickId = ((await initial.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!.picks[0]!.id;

    // The cancellation is written after g1's own kickoff instant has already
    // passed — the same spec situation as an earlier cancellation, and per
    // ADR-0015 it must earn the identical substitution right.
    await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });

    const res = await postRepick(
      memberA.cookie,
      league.id,
      weekId,
      { replacePickId: g1PickId, gameId: g4, side: PICKEM_PICK_SIDE.HOME, spread: null },
      appAfterKickoff,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemWeekPicksResponse;
    const own = body.members.find((m) => m.userId === memberA.user.id)!;
    expect(own.picks.map((p) => p.gameId)).toEqual([g4]);
    expect(own.picks.find((p) => p.gameId === g1)).toBeUndefined();

    const memberId = (await membersOf(db, league.id)).get(memberA.user.id)!;
    expect(await memberPickCount(leagueSeasonId, memberId)).toBe(1);
  });

  it("409s pick_not_replaceable when the replaced pick's game is only postponed, not cancelled or moved", async () => {
    // Spec §Cancellations, Postponements & Re-picks: "Postponed within the same
    // week: pick resolves normally when played. No re-pick." This is the
    // boundary of the substitution rule — cancelled and moved earn one,
    // postponed deliberately does not.
    const { league, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!;

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(initial.status).toBe(200);
    const g1PickId = ((await initial.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!.picks[0]!.id;
    await setGame(db, g1!, { status: GAME_STATUS.POSTPONED });

    const res = await postRepick(memberA.cookie, league.id, weekId, {
      replacePickId: g1PickId,
      gameId: g2,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pick_not_replaceable" });
  });

  it("409s pick_not_replaceable when the replaced pick's game is still playable", async () => {
    const { league, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!;

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(initial.status).toBe(200);
    const g1PickId = ((await initial.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!.picks[0]!.id;

    const res = await postRepick(memberA.cookie, league.id, weekId, {
      replacePickId: g1PickId,
      gameId: g2,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pick_not_replaceable" });
  });

  it("404s pick_not_found for a replacePickId that isn't the caller's own pick, and for one that doesn't exist", async () => {
    const { league, weekIds, gameIds, memberA, memberB } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const bInitial = await putPicks(memberB.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(bInitial.status).toBe(200);
    const bPickId = ((await bInitial.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberB.user.id,
    )!.picks[0]!.id;

    const otherMembersPick = await postRepick(memberA.cookie, league.id, weekId, {
      replacePickId: bPickId,
      gameId: g2,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(otherMembersPick.status).toBe(404);
    expect(await otherMembersPick.json()).toMatchObject({ error: "pick_not_found" });

    const unknownPick = await postRepick(memberA.cookie, league.id, weekId, {
      replacePickId: randomUUID(),
      gameId: g3,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(unknownPick.status).toBe(404);
    expect(await unknownPick.json()).toMatchObject({ error: "pick_not_found" });
  });

  it("409s pick_locked when the replacement game has already kicked off", async () => {
    const { league, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!; // g1 kicks off first, g2 an hour later

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(initial.status).toBe(200);
    const g2PickId = ((await initial.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!.picks[0]!.id;
    await setGame(db, g2!, { status: GAME_STATUS.CANCELLED });

    const res = await postRepick(
      memberA.cookie,
      league.id,
      weekId,
      { replacePickId: g2PickId, gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
      appAfterKickoff,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pick_locked" });
  });

  it("409s pick_locked when the replacement's kickoff is the exact locking instant (half-open lock, arch D11)", async () => {
    const { league, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!; // g1 kicks off at exactly WEEK1_KICKOFF

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(initial.status).toBe(200);
    const g2PickId = ((await initial.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!.picks[0]!.id;
    await setGame(db, g2!, { status: GAME_STATUS.CANCELLED });

    const res = await postRepick(
      memberA.cookie,
      league.id,
      weekId,
      { replacePickId: g2PickId, gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
      appAtKickoff,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pick_locked" });
  });

  it("409s game_not_pickable when the replacement is itself cancelled", async () => {
    const { league, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!;

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(initial.status).toBe(200);
    const g1PickId = ((await initial.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!.picks[0]!.id;
    await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });
    await setGame(db, g2!, { status: GAME_STATUS.CANCELLED });

    const res = await postRepick(memberA.cookie, league.id, weekId, {
      replacePickId: g1PickId,
      gameId: g2,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "game_not_pickable" });
  });

  it("400s game_not_in_week when the replacement belongs to another week", async () => {
    const { league, weekIds, gameIds, memberA } = await seedRepickLeague({
      weeks: [
        ...FOUR_GAME_WEEK,
        {
          weekNumber: 2,
          kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
        },
      ],
    });
    const week1Id = weekIds.get("regular:1")!;
    const [g1] = gameIds.get("regular:1")!;
    const week2GameId = gameIds.get("regular:2")![0]!;

    const initial = await putPicks(memberA.cookie, league.id, week1Id, {
      picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(initial.status).toBe(200);
    const g1PickId = ((await initial.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!.picks[0]!.id;
    await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });

    const res = await postRepick(memberA.cookie, league.id, week1Id, {
      replacePickId: g1PickId,
      gameId: week2GameId,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "game_not_in_week" });
  });

  it("400s duplicate_pick when the caller already holds the replacement game", async () => {
    const { league, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!;

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(initial.status).toBe(200);
    const g1PickId = ((await initial.json()) as PickemWeekPicksResponse).members
      .find((m) => m.userId === memberA.user.id)!
      .picks.find((p) => p.gameId === g1)!.id;
    await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });

    const res = await postRepick(memberA.cookie, league.id, weekId, {
      replacePickId: g1PickId,
      gameId: g2,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "duplicate_pick" });
  });

  it("does not change picksAllowed — the repick itself never alters the cap", async () => {
    const { league, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3] = gameIds.get("regular:1")!;

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(initial.status).toBe(200);
    const g1PickId = ((await initial.json()) as PickemWeekPicksResponse).members
      .find((m) => m.userId === memberA.user.id)!
      .picks.find((p) => p.gameId === g1)!.id;

    await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });

    // Read picksAllowed AFTER the cancellation — which does its own, separate
    // reduction (ADR-0015: a cancelled game doesn't raise the cap) — but
    // BEFORE the repick, so the comparison below isolates what the repick
    // itself does to the cap: nothing.
    const preRepick = await getPicks(memberA.cookie, league.id, weekId);
    expect(preRepick.status).toBe(200);
    const before = ((await preRepick.json()) as PickemWeekPicksResponse).picksAllowed;

    const res = await postRepick(memberA.cookie, league.id, weekId, {
      replacePickId: g1PickId,
      gameId: g3,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PickemWeekPicksResponse).picksAllowed).toBe(before);
  });

  it("settles the substituted pick normally afterward, and leaves nothing behind for the pick it replaced", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2] = gameIds.get("regular:1")!;

    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null }],
    });
    expect(initial.status).toBe(200);
    const g1PickId = ((await initial.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!.picks[0]!.id;
    await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });

    const res = await postRepick(memberA.cookie, league.id, weekId, {
      replacePickId: g1PickId,
      gameId: g2,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(200);
    const g2PickId = ((await res.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!.picks[0]!.id;

    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const results = await pickResultsFor(db, leagueSeasonId);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ pickemPickId: g2PickId });
    expect(results.some((r) => r.pickemPickId === g1PickId)).toBe(false);
  });

  it("refuses the only reachable replacement when no unstarted, un-held game remains — the push stands (spec §Cancellations)", async () => {
    const { league, leagueSeasonId, weekIds, gameIds, memberA } = await seedRepickLeague();
    const weekId = weekIds.get("regular:1")!;
    const [g1, g2, g3, g4] = gameIds.get("regular:1")!;

    // The member holds every game in the slate — there is no unstarted game
    // left that isn't already theirs.
    const initial = await putPicks(memberA.cookie, league.id, weekId, {
      picks: [
        { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g3, side: PICKEM_PICK_SIDE.HOME, spread: null },
        { gameId: g4, side: PICKEM_PICK_SIDE.HOME, spread: null },
      ],
    });
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as PickemWeekPicksResponse;
    const g1PickId = initialBody.members
      .find((m) => m.userId === memberA.user.id)!
      .picks.find((p) => p.gameId === g1)!.id;

    await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });

    // The only candidate slots are games the member already holds themselves,
    // so any substitution attempt collides as a duplicate rather than finding
    // room — the reachable refusal for "no unstarted games remain".
    const res = await postRepick(memberA.cookie, league.id, weekId, {
      replacePickId: g1PickId,
      gameId: g2,
      side: PICKEM_PICK_SIDE.HOME,
      spread: null,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "duplicate_pick" });

    // The push stands: the member's pick on the cancelled game is untouched.
    const memberId = (await membersOf(db, league.id)).get(memberA.user.id)!;
    expect(await memberPickCount(leagueSeasonId, memberId)).toBe(4);
    const picksRes = await getPicks(memberA.cookie, league.id, weekId);
    expect(picksRes.status).toBe(200);
    const own = ((await picksRes.json()) as PickemWeekPicksResponse).members.find(
      (m) => m.userId === memberA.user.id,
    )!;
    expect(own.picks.find((p) => p.id === g1PickId)).toMatchObject({ gameId: g1 });
  });

  describe("cross-week duplicate (unique constraint spans all weeks, both checks are week-scoped)", () => {
    it("400s duplicate_pick, not a 500, through the batch endpoint when a held pick's game is repointed into the week being submitted", async () => {
      const { league, weekIds, gameIds, memberA } = await seedRepickLeague({
        weeks: [
          ...FOUR_GAME_WEEK,
          {
            weekNumber: 2,
            kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
          },
        ],
      });
      const week1Id = weekIds.get("regular:1")!;
      const week2Id = weekIds.get("regular:2")!;
      const week2GameId = gameIds.get("regular:2")![0]!;

      const week2Pick = await putPicks(memberA.cookie, league.id, week2Id, {
        picks: [{ gameId: week2GameId, side: PICKEM_PICK_SIDE.HOME, spread: null }],
      });
      expect(week2Pick.status).toBe(200);

      // The provider repoints the game into week 1; the pick keeps its own
      // `week_id` (ADR-0015), so it's invisible to week 1's own-picks query —
      // the `seen`/existing-picks checks in submitPickemPicks are scoped to
      // this one week, but the DB constraint spans all of them.
      await setGame(db, week2GameId, { weekId: week1Id });

      const res = await putPicks(memberA.cookie, league.id, week1Id, {
        picks: [{ gameId: week2GameId, side: PICKEM_PICK_SIDE.HOME, spread: null }],
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: "duplicate_pick",
        message: expect.any(String),
      });
    });

    it("400s duplicate_pick, not a 500, through the repick path when the replacement was repointed in alongside the member's own cross-week pick", async () => {
      const { league, weekIds, gameIds, memberA } = await seedRepickLeague({
        weeks: [
          ...FOUR_GAME_WEEK,
          {
            weekNumber: 2,
            kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000) }],
          },
        ],
      });
      const week1Id = weekIds.get("regular:1")!;
      const week2Id = weekIds.get("regular:2")!;
      const [g1] = gameIds.get("regular:1")!;
      const week2GameId = gameIds.get("regular:2")![0]!;

      const week1Pick = await putPicks(memberA.cookie, league.id, week1Id, {
        picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: null }],
      });
      expect(week1Pick.status).toBe(200);
      const g1PickId = ((await week1Pick.json()) as PickemWeekPicksResponse).members.find(
        (m) => m.userId === memberA.user.id,
      )!.picks[0]!.id;

      const week2Pick = await putPicks(memberA.cookie, league.id, week2Id, {
        picks: [{ gameId: week2GameId, side: PICKEM_PICK_SIDE.HOME, spread: null }],
      });
      expect(week2Pick.status).toBe(200);

      // g1 is cancelled, earning a substitution; the game repointed into week
      // 1 passes the in-week `alreadyPicked` check (that pick's `week_id`
      // still points at week 2), but collides with the member's own row on
      // insert via the cross-week unique constraint.
      await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });
      await setGame(db, week2GameId, { weekId: week1Id });

      const res = await postRepick(memberA.cookie, league.id, week1Id, {
        replacePickId: g1PickId,
        gameId: week2GameId,
        side: PICKEM_PICK_SIDE.HOME,
        spread: null,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: "duplicate_pick",
        message: expect.any(String),
      });
    });
  });

  describe("against the spread", () => {
    const ATS_SETTINGS: PickemSettings = {
      ...DEFAULT_PICKEM_SETTINGS,
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
    };
    const ATS_WEEK: SeededWeek[] = [
      {
        weekNumber: 1,
        kickoffs: [
          { kickoffAt: WEEK1_KICKOFF, spread: -3 },
          { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 60 * 1000), spread: -4 },
          { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 2 * 60 * 60 * 1000), spread: -5 },
          { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 3 * 60 * 60 * 1000), spread: -6 },
        ],
      },
    ];

    it("accepts the spread on the replacement pick only — the member's other unstarted picks keep their spreads byte-unchanged even after their odds have since moved (ADR-0015, PKM-7)", async () => {
      const { league, weekIds, gameIds, memberA } = await seedRepickLeague({
        settings: ATS_SETTINGS,
        weeks: ATS_WEEK,
      });
      const weekId = weekIds.get("regular:1")!;
      const [g1, g2, g3, g4] = gameIds.get("regular:1")!;

      const initial = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [
          { gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: -3 },
          { gameId: g2, side: PICKEM_PICK_SIDE.HOME, spread: -4 },
          { gameId: g3, side: PICKEM_PICK_SIDE.HOME, spread: -5 },
        ],
      });
      expect(initial.status).toBe(200);
      const initialBody = (await initial.json()) as PickemWeekPicksResponse;
      const g1PickId = initialBody.members
        .find((m) => m.userId === memberA.user.id)!
        .picks.find((p) => p.gameId === g1)!.id;

      await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });

      // The line moves under g2 and g3 while they are still unstarted — the
      // exact scenario the batch endpoint would re-price on any edit. The
      // repick endpoint must not: it prices the replacement only.
      await db.insert(oddsSnapshots).values([
        {
          gameId: g2!,
          spread: -10,
          capturedAt: new Date(WEEK1_KICKOFF.getTime() + 4 * 60 * 60 * 1000),
          createdAt: new Date(WEEK1_KICKOFF.getTime() + 4 * 60 * 60 * 1000),
        },
        {
          gameId: g3!,
          spread: -11,
          capturedAt: new Date(WEEK1_KICKOFF.getTime() + 4 * 60 * 60 * 1000),
          createdAt: new Date(WEEK1_KICKOFF.getTime() + 4 * 60 * 60 * 1000),
        },
      ]);

      const res = await postRepick(memberA.cookie, league.id, weekId, {
        replacePickId: g1PickId,
        gameId: g4,
        side: PICKEM_PICK_SIDE.HOME,
        spread: -6,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as PickemWeekPicksResponse;
      const own = body.members.find((m) => m.userId === memberA.user.id)!;

      expect(own.picks.find((p) => p.gameId === g4)).toMatchObject({ spread: -6 });
      // The whole point of this endpoint: g2/g3 keep the spreads they were
      // made against, not the moved odds.
      expect(own.picks.find((p) => p.gameId === g2)).toMatchObject({ spread: -4 });
      expect(own.picks.find((p) => p.gameId === g3)).toMatchObject({ spread: -5 });
      expect(own.picks.find((p) => p.gameId === g1)).toBeUndefined();
    });

    it("409s spread_stale when the submitted spread doesn't match the replacement's current number", async () => {
      const { league, weekIds, gameIds, memberA } = await seedRepickLeague({
        settings: ATS_SETTINGS,
        weeks: ATS_WEEK,
      });
      const weekId = weekIds.get("regular:1")!;
      const gameIdsForWeek = gameIds.get("regular:1")!;
      const g1 = gameIdsForWeek[0]!;
      const g4 = gameIdsForWeek[3]!;

      const initial = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: -3 }],
      });
      expect(initial.status).toBe(200);
      const g1PickId = ((await initial.json()) as PickemWeekPicksResponse).members.find(
        (m) => m.userId === memberA.user.id,
      )!.picks[0]!.id;
      await setGame(db, g1, { status: GAME_STATUS.CANCELLED });

      const res = await postRepick(memberA.cookie, league.id, weekId, {
        replacePickId: g1PickId,
        gameId: g4,
        side: PICKEM_PICK_SIDE.HOME,
        spread: -999,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "spread_stale" });
    });

    it("409s spread_unavailable when the replacement has no odds snapshot at all", async () => {
      const { league, weekIds, gameIds, memberA } = await seedRepickLeague({
        settings: ATS_SETTINGS,
        weeks: [
          {
            weekNumber: 1,
            kickoffs: [
              { kickoffAt: WEEK1_KICKOFF, spread: -3 },
              { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 60 * 1000) }, // no spread seeded
            ],
          },
        ],
      });
      const weekId = weekIds.get("regular:1")!;
      const [g1, g2] = gameIds.get("regular:1")!;

      const initial = await putPicks(memberA.cookie, league.id, weekId, {
        picks: [{ gameId: g1, side: PICKEM_PICK_SIDE.HOME, spread: -3 }],
      });
      expect(initial.status).toBe(200);
      const g1PickId = ((await initial.json()) as PickemWeekPicksResponse).members.find(
        (m) => m.userId === memberA.user.id,
      )!.picks[0]!.id;
      await setGame(db, g1!, { status: GAME_STATUS.CANCELLED });

      const res = await postRepick(memberA.cookie, league.id, weekId, {
        replacePickId: g1PickId,
        gameId: g2,
        side: PICKEM_PICK_SIDE.HOME,
        spread: -3,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "spread_unavailable" });
    });
  });
});
