import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, isNull, and, sql } from "drizzle-orm";
import { FixedClock } from "@picksleagues/core";
import {
  leagueSeasons,
  leagues,
  pickemPickResults,
  pickemPicks,
  pickemStandings,
  survivorPickResults,
  survivorPicks,
  survivorState,
} from "@picksleagues/db";
import { AgentReconciliationResponseSchema } from "@picksleagues/schemas";
import { makeFixedAppHarness } from "./setup/fixed-app";
import { makeTestEnv } from "./setup/test-env";
import { resetDb } from "./setup/reset-db";
import { DEFAULT_PICKEM_SETTINGS, insertPick, setGame } from "./setup/league-helpers";
import { seedPickemLeague } from "./setup/pickem-league";
import { seedSurvivorSeason, insertSurvivorPick, seedSurvivorGame } from "./setup/survivor-league";
import { WEEK1_KICKOFF } from "./setup/league-app";
import { rebuildPickemLeagueSeason } from "../src/services/pickem/settlement";
import { rebuildSurvivorLeagueSeason } from "../src/services/survivor/settlement";

const { db, auth, appAt } = makeFixedAppHarness();
const clock = new FixedClock(WEEK1_KICKOFF);
const token = "synthetic_reconciliation_".repeat(2);
const headers = { authorization: `Bearer ${token}` };
const app = () => appAt(WEEK1_KICKOFF, { env: makeTestEnv({ AGENT_API_TOKEN: token }) });
const path = (id: string) => `/api/agent/v1/league-seasons/${id}/reconciliation`;
async function read(id: string) {
  const response = await app().request(path(id), { headers });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  const parsed = AgentReconciliationResponseSchema.parse(body);
  expect(body).toEqual(parsed);
  return parsed;
}
const clean = { missingCount: 0, unexpectedCount: 0, mismatchCount: 0 };

beforeEach(async () => {
  await resetDb(db);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$client.end());

async function pickem() {
  const seed = await seedPickemLeague(db, auth, {
    members: [{}, {}],
    settings: { ...DEFAULT_PICKEM_SETTINGS, pickType: "against_the_spread" },
    weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
  });
  const gameId = seed.gameIds.get("regular:1")![0]!;
  const weekId = seed.weekIds.get("regular:1")!;
  const memberId = seed.members.get(seed.users[0]!.user.id)!;
  const pick = await insertPick(db, {
    leagueSeasonId: seed.leagueSeasonId,
    leagueMemberId: memberId,
    gameId,
    weekId,
    side: "home",
    spreadAtPick: -3,
  });
  await setGame(db, gameId, { status: "final", homeScore: 24, awayScore: 21, spread: -7 });
  await rebuildPickemLeagueSeason(db, clock, seed.leagueSeasonId);
  return { ...seed, gameId, weekId, memberId, pick };
}

describe("aggregate scoring reconciliation", () => {
  it("uses the accepted ATS spread, detects mutually consistent wrong points, and never repairs", async () => {
    const seed = await pickem();
    const initial = await read(seed.leagueSeasonId);
    expect(initial.results).toMatchObject({ ...clean, expectedCount: 1 });
    expect(initial.standings).toMatchObject({ ...clean, expectedCount: 4 });
    expect(initial.survivorState).toBeNull();
    await db.update(pickemPickResults).set({ points: 1, outcome: "correct" });
    await db
      .update(pickemStandings)
      .set({ points: 1, wins: 1, pushes: 0 })
      .where(eq(pickemStandings.leagueMemberId, seed.memberId));
    const beforeResults = await db.select().from(pickemPickResults);
    const beforeStandings = await db.select().from(pickemStandings);
    const result = await read(seed.leagueSeasonId);
    expect(result.results).toMatchObject({ ...clean, mismatchCount: 1 });
    expect(result.standings).toMatchObject({ ...clean, mismatchCount: 2 });
    expect(await db.select().from(pickemPickResults)).toEqual(beforeResults);
    expect(await db.select().from(pickemStandings)).toEqual(beforeStandings);
    const serialized = JSON.stringify(result);
    for (const secret of [seed.memberId, seed.pick.id, seed.gameId, seed.users[0]!.user.id, token])
      expect(serialized).not.toContain(secret);
  });

  it("separates missing results/standings, rank drift and unexpected results after score reversion", async () => {
    const seed = await pickem();
    await db.delete(pickemPickResults);
    await db
      .delete(pickemStandings)
      .where(
        and(eq(pickemStandings.leagueMemberId, seed.memberId), isNull(pickemStandings.weekId)),
      );
    expect((await read(seed.leagueSeasonId)).results).toMatchObject({ ...clean, missingCount: 1 });
    expect((await read(seed.leagueSeasonId)).standings).toMatchObject({
      ...clean,
      missingCount: 1,
    });
    await rebuildPickemLeagueSeason(db, clock, seed.leagueSeasonId);
    await db
      .update(pickemStandings)
      .set({ rank: 9 })
      .where(eq(pickemStandings.leagueMemberId, seed.memberId));
    expect((await read(seed.leagueSeasonId)).standings).toMatchObject({
      ...clean,
      mismatchCount: 2,
    });
    await setGame(db, seed.gameId, { status: "scheduled", homeScore: null, awayScore: null });
    expect((await read(seed.leagueSeasonId)).results).toMatchObject({
      ...clean,
      expectedCount: 0,
      unexpectedCount: 1,
    });
  });

  it("reports cancellation as a push and missing-score finals as ungradeable", async () => {
    const seed = await pickem();
    await setGame(db, seed.gameId, { status: "cancelled", homeScore: null, awayScore: null });
    expect((await read(seed.leagueSeasonId)).results).toMatchObject(clean);
    await setGame(db, seed.gameId, { status: "final", homeScore: null });
    expect((await read(seed.leagueSeasonId)).results).toMatchObject({
      ...clean,
      expectedCount: 0,
      unexpectedCount: 1,
    });
  });

  it("replays Survivor revival and later elimination, detects state corruption and corrected history", async () => {
    const seed = await seedSurvivorSeason(db, auth, { weekCount: 2, memberCount: 3 });
    const [first, second] = seed.weeks;
    for (const memberId of seed.memberIds) {
      await insertSurvivorPick(db, {
        leagueSeasonId: seed.leagueSeasonId,
        leagueMemberId: memberId,
        weekId: first!.weekId,
        gameId: first!.gameId,
        teamId: first!.awayTeamId,
      });
    }
    await setGame(db, first!.gameId, { status: "final", homeScore: 10, awayScore: 0 });
    // Week 1 revives everyone. Week 2 has one winner and two missed picks, ending the season.
    await insertSurvivorPick(db, {
      leagueSeasonId: seed.leagueSeasonId,
      leagueMemberId: seed.memberIds[0]!,
      weekId: second!.weekId,
      gameId: second!.gameId,
      teamId: second!.homeTeamId,
    });
    await setGame(db, second!.gameId, { status: "final", homeScore: 10, awayScore: 0 });
    await rebuildSurvivorLeagueSeason(db, clock, seed.leagueSeasonId);
    const initial = await read(seed.leagueSeasonId);
    expect(initial.results).toMatchObject({ ...clean, expectedCount: 4 });
    expect(initial.survivorState).toMatchObject({ ...clean, expectedCount: 3 });
    expect(initial.releasedFlagMismatchCount).toBe(0);
    await db.update(survivorState).set({ revivedCount: 9 });
    const before = await db.select().from(survivorState);
    expect((await read(seed.leagueSeasonId)).survivorState).toMatchObject({
      ...clean,
      mismatchCount: 3,
    });
    expect(await db.select().from(survivorState)).toEqual(before);
    // A correction invalidates the entire chronological prefix, including later result rows.
    await setGame(db, first!.gameId, { status: "scheduled", homeScore: null, awayScore: null });
    const corrected = await read(seed.leagueSeasonId);
    expect(corrected.results).toMatchObject({ ...clean, expectedCount: 0, unexpectedCount: 4 });
    expect(corrected.survivorState).toMatchObject({
      ...clean,
      expectedCount: 0,
      unexpectedCount: 3,
    });
  });

  it("honors incomplete-week provisional elimination without premature results or future grading", async () => {
    const seed = await seedSurvivorSeason(db, auth, { weekCount: 2, memberCount: 2 });
    const first = seed.weeks[0]!;
    await seedSurvivorGame(db, { weekId: first.weekId, kickoffAt: WEEK1_KICKOFF });
    for (const [i, memberId] of seed.memberIds.entries()) {
      await insertSurvivorPick(db, {
        leagueSeasonId: seed.leagueSeasonId,
        leagueMemberId: memberId,
        weekId: first.weekId,
        gameId: first.gameId,
        teamId: i === 0 ? first.homeTeamId : first.awayTeamId,
      });
    }
    await setGame(db, first.gameId, { status: "final", homeScore: 10, awayScore: 0 });
    await setGame(db, seed.weeks[1]!.gameId, { status: "final", homeScore: 10, awayScore: 0 });
    await rebuildSurvivorLeagueSeason(db, clock, seed.leagueSeasonId);
    const result = await read(seed.leagueSeasonId);
    expect(result.results).toMatchObject({ ...clean, expectedCount: 0 });
    expect(result.survivorState).toMatchObject({ ...clean, expectedCount: 1 });
    await db.delete(survivorState);
    expect((await read(seed.leagueSeasonId)).survivorState).toMatchObject({
      ...clean,
      missingCount: 1,
    });
  });

  it.each(["cancelled", "final"] as const)(
    "checks Survivor %s team-release flags and result corruption",
    async (status) => {
      const seed = await seedSurvivorSeason(db, auth);
      const week = seed.weeks[0]!;
      const pick = await insertSurvivorPick(db, {
        leagueSeasonId: seed.leagueSeasonId,
        leagueMemberId: seed.memberIds[0]!,
        weekId: week.weekId,
        gameId: week.gameId,
        teamId: week.homeTeamId,
      });
      await setGame(db, week.gameId, { status, homeScore: 10, awayScore: 10 });
      await rebuildSurvivorLeagueSeason(db, clock, seed.leagueSeasonId);
      expect((await read(seed.leagueSeasonId)).results).toMatchObject(clean);
      expect((await read(seed.leagueSeasonId)).releasedFlagMismatchCount).toBe(0);
      await db
        .update(survivorPicks)
        .set({ released: status !== "cancelled" })
        .where(eq(survivorPicks.id, pick.id));
      await db.update(survivorPickResults).set({ outcome: "incorrect" });
      const before = await db.select().from(survivorPicks);
      const result = await read(seed.leagueSeasonId);
      expect(result.results).toMatchObject({ ...clean, mismatchCount: 1 });
      expect(result.releasedFlagMismatchCount).toBe(1);
      expect(await db.select().from(survivorPicks)).toEqual(before);
    },
  );

  it("sanitizes a scorer exception containing private pick identifiers", async () => {
    const seed = await pickem();
    await db
      .update(pickemPicks)
      .set({ spreadAtPick: null })
      .where(eq(pickemPicks.id, seed.pick.id));
    const logs = vi.mocked(console.log);
    logs.mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await app().request(path(seed.leagueSeasonId), { headers });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal", message: "Something went wrong." });
    expect(errors).toHaveBeenCalled();
    expect(JSON.parse(String(logs.mock.calls.at(-1)?.[0]))).toMatchObject({
      operation: "agentScoringReconciliation",
      status: 500,
    });
    const output = JSON.stringify([...logs.mock.calls, ...errors.mock.calls]);
    for (const value of [seed.pick.id, seed.memberId, seed.leagueSeasonId, token])
      expect(output).not.toContain(value);
  });

  it("refuses anonymous/writing calls and distinguishes missing resources from unsupported modes", async () => {
    expect((await app().request(path(randomUUID()))).status).toBe(401);
    expect((await app().request(path(randomUUID()), { headers, method: "POST" })).status).toBe(405);
    expect((await app().request(path(randomUUID()), { headers })).status).toBe(404);
    const seed = await seedPickemLeague(db, auth, { members: [{}], weeks: [] });
    // Empty pre-settlement standings are reported as missing, not a proof of scoring corruption.
    expect((await read(seed.leagueSeasonId)).standings).toMatchObject({
      ...clean,
      expectedCount: 1,
      missingCount: 1,
    });
    await db
      .update(leagueSeasons)
      .set({ settings: sql`'{}'::jsonb` })
      .where(eq(leagueSeasons.id, seed.leagueSeasonId));
    const response = await app().request(path(seed.leagueSeasonId), { headers });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal", message: "Something went wrong." });
    await db.update(leagues).set({ mode: "march_madness" }).where(eq(leagues.id, seed.league.id));
    expect(await read(seed.leagueSeasonId)).toMatchObject({
      status: "unsupported_mode",
      results: null,
      standings: null,
      survivorState: null,
      releasedFlagMismatchCount: null,
    });
  });
});
