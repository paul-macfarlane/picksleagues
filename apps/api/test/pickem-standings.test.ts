import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueMembers, users } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  SURVIVOR_PUSH_TIE_RESOLUTION,
  GAME_STATUS,
  LEAGUE_MODE,
  MEMBER_ROLE,
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  WEEK_TYPE,
  type PickemStandingsResponse,
  type PickemSettings,
} from "@picksleagues/schemas";
import { settlePickemLeagueSeasonWeeks } from "../src/services/pickem/settlement";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import {
  insertLeague,
  insertPick,
  SEED_AT,
  seedSeason,
  setGame,
  type SeededWeek,
} from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF } from "./setup/league-app";
import { seedPickemLeague as seedPickemLeagueBase } from "./setup/pickem-league";
import { resetDb } from "./setup/reset-db";

const { db, auth, getStandings } = makeLeagueTestHarness();

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
   * straight into `pickem_picks` and drive `settlePickemLeagueSeasonWeeks` rather
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
    // for a Survivor league instead of refusing.
    const { seasonId } = await seedSeason(db, {
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
    });
    const member = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId,
      mode: LEAGUE_MODE.SURVIVOR,
      settings: {
        startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        endWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        pickType: PICK_TYPE.STRAIGHT_UP,
        pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
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
    expect(body.rows.every((row) => row.points === 0)).toBe(true);
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
    await settlePickemLeagueSeasonWeeks(
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
    expect(joinerRow).toMatchObject({ points: 0 });
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

    // Alpha and Bravo win by different margins and still tie: points are the
    // only ordering input (ADR-0018).
    await setGame(db, g1!, { status: GAME_STATUS.FINAL, homeScore: 30, awayScore: 20 }); // alpha: correct, 1pt
    await setGame(db, g2!, { status: GAME_STATUS.FINAL, homeScore: 25, awayScore: 24 }); // bravo: correct, 1pt
    await setGame(db, g3!, { status: GAME_STATUS.FINAL, homeScore: 15, awayScore: 20 }); // charlie: incorrect, 0pts

    const clock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    await settlePickemLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const res = await getStandings(users[0]!.cookie, league.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemStandingsResponse;

    expect(body.rows.map((row) => row.displayName)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(body.rows[0]).toMatchObject({ points: 1, rank: 1, isViewer: true });
    expect(body.rows[1]).toMatchObject({ points: 1, rank: 1, isViewer: false });
    expect(body.rows[2]).toMatchObject({ points: 0, rank: 3, isViewer: false }); // skips rank 2
  });

  /**
   * The genuinely distinct avatar path: standings select a narrow projection
   * rather than the whole user row, so this is the one call site where
   * resolution depends on the query having asked for the override column at all
   * (ADR-0022).
   */
  it("shows a league-mate a member's avatar override in place of their provider image", async () => {
    // `users` is shadowed by the seed's own binding in the tests around this
    // one; aliased here so the table import stays reachable.
    const { league, users: seeded } = await seedStandingsLeague();
    const viewer = seeded[0]!;
    const other = seeded[1]!;
    await db
      .update(users)
      .set({
        image: "https://provider.example.invalid/from-oauth.png",
        imageOverride: "https://cdn.example.invalid/member-set.png",
      })
      .where(eq(users.id, other.user.id));

    const res = await getStandings(viewer.cookie, league.id);

    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemStandingsResponse;
    expect(body.rows.find((row) => row.userId === other.user.id)?.image).toBe(
      "https://cdn.example.invalid/member-set.png",
    );
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
    await settlePickemLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

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
    await settlePickemLeagueSeasonWeeks(db, clock, leagueSeasonId, [week1Id, week2Id]);

    const weeklyRes = await getStandings(users[0]!.cookie, league.id, `?week=${week1Id}`);
    expect(weeklyRes.status).toBe(200);
    const weeklyBody = (await weeklyRes.json()) as PickemStandingsResponse;
    const weeklyRow = weeklyBody.rows.find((row) => row.userId === users[0]!.user.id)!;
    expect(weeklyRow).toMatchObject({ points: 1 });
    expect(weeklyBody.weekId).toBe(week1Id);

    const seasonRes = await getStandings(users[0]!.cookie, league.id);
    expect(seasonRes.status).toBe(200);
    const seasonBody = (await seasonRes.json()) as PickemStandingsResponse;
    const seasonRow = seasonBody.rows.find((row) => row.userId === users[0]!.user.id)!;
    expect(seasonRow).toMatchObject({ points: 1, wins: 1, losses: 1 }); // summed across both weeks
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
    await settlePickemLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const res = await getStandings(nonPicker.cookie, league.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemStandingsResponse;
    const row = body.rows.find((r) => r.userId === nonPicker.user.id)!;
    expect(row).toMatchObject({ points: 0 });
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
    await settlePickemLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);

    const res = await getStandings(users[0]!.cookie, league.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemStandingsResponse;
    expect(body.lastUpdatedAt).not.toBeNull();
    expect(new Date(body.lastUpdatedAt!).toString()).not.toBe("Invalid Date");
  });
});
