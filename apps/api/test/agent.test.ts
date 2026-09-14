import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  games,
  leagueSeasons,
  pickemPickResults,
  pickemStandings,
  survivorPickResults,
} from "@picksleagues/db";
import {
  AgentGameResponseSchema,
  AgentLeagueDiagnosticsResponseSchema,
  AgentWeekResponseSchema,
} from "@picksleagues/schemas";
import { makeFixedAppHarness } from "./setup/fixed-app";
import { makeTestEnv } from "./setup/test-env";
import { resetDb } from "./setup/reset-db";
import { seedSeason, insertPick, SEED_AT } from "./setup/league-helpers";
import { seedPickemLeague } from "./setup/pickem-league";
import {
  seedSurvivorSeason,
  insertSurvivorPick,
  insertSurvivorState,
} from "./setup/survivor-league";
import { WEEK1_KICKOFF } from "./setup/league-app";

const { db, auth, appAt } = makeFixedAppHarness();
const token = "synthetic_agent_token_".repeat(2);
const headers = { authorization: `Bearer ${token}` };
const app = (now = WEEK1_KICKOFF) => appAt(now, { env: makeTestEnv({ AGENT_API_TOKEN: token }) });
const get = async (path: string, now = WEEK1_KICKOFF) => {
  const response = await app(now).request(`/api/agent/v1/${path}`, { headers });
  expect(response.status).toBe(200);
  return response.json();
};

beforeEach(async () => {
  await resetDb(db);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$client.end());

describe("agent diagnostics", () => {
  it("reports missing ingestion without inventing job health", async () => {
    expect(await get("system")).toMatchObject({
      environment: "local",
      serverTime: WEEK1_KICKOFF.toISOString(),
      seasonYear: 2026,
      seasonId: null,
      currentWeekId: null,
      dataUpdatedAt: null,
      anomalies: ["no_season"],
    });
  });

  it("pins every game status, nullable spreads and the exact kickoff boundary", async () => {
    const fixture = await seedSeason(db, {
      weeks: [
        {
          weekNumber: 1,
          kickoffs: Array.from({ length: 5 }, () => ({ kickoffAt: WEEK1_KICKOFF })),
        },
      ],
    });
    const weekId = fixture.weekIds.get("regular:1")!;
    const ids = fixture.gameIds.get("regular:1")!;
    const statuses = ["scheduled", "in_progress", "final", "postponed", "cancelled"] as const;
    for (const [i, id] of ids.entries())
      await db
        .update(games)
        .set({ status: statuses[i], updatedAt: SEED_AT })
        .where(eq(games.id, id));
    const before = AgentWeekResponseSchema.parse(
      await get(`weeks/${weekId}`, new Date(WEEK1_KICKOFF.getTime() - 1)),
    );
    expect(before.scheduledAfterKickoffCount).toBe(0);
    const at = AgentWeekResponseSchema.parse(await get(`weeks/${weekId}`));
    expect(at).toMatchObject({
      gameCounts: { scheduled: 1, in_progress: 1, final: 1, postponed: 1, cancelled: 1 },
      missingSpreadCount: 5,
      finalWithoutScoreCount: 1,
      scheduledAfterKickoffCount: 1,
      dataUpdatedAt: SEED_AT.toISOString(),
    });
    const game = AgentGameResponseSchema.parse(await get(`games/${ids[0]}`));
    expect(game).toMatchObject({
      gameId: ids[0],
      weekId,
      spread: null,
      hasSpreadSource: false,
      homeTeam: { abbreviation: "HOM" },
      awayTeam: { abbreviation: "AWY" },
      gameStateUpdatedAt: SEED_AT.toISOString(),
    });
    expect(game.anomalies).toContain("scheduled_after_kickoff");
    await db
      .update(games)
      .set({ spread: -3, spreadSource: "private provider text", updatedAt: WEEK1_KICKOFF })
      .where(eq(games.id, ids[0]!));
    const updated = await get(`games/${ids[0]}`);
    expect(updated).toMatchObject({
      spread: -3,
      hasSpreadSource: true,
      gameStateUpdatedAt: WEEK1_KICKOFF.toISOString(),
    });
    expect(JSON.stringify(updated)).not.toContain("private provider text");
    expect(await get("system")).toMatchObject({
      seasonId: fixture.seasonId,
      currentWeekId: weekId,
      dataUpdatedAt: WEEK1_KICKOFF.toISOString(),
    });
  });

  it("returns an empty week and safe 404s", async () => {
    const fixture = await seedSeason(db, { weeks: [{ weekNumber: 1 }] });
    expect(await get(`weeks/${fixture.weekIds.get("regular:1")}`)).toMatchObject({
      dataUpdatedAt: null,
      missingSpreadCount: 0,
      anomalies: ["no_games"],
    });
    for (const path of [
      `weeks/${randomUUID()}`,
      `games/${randomUUID()}`,
      `league-seasons/${randomUUID()}/diagnostics`,
    ]) {
      const response = await app().request(`/api/agent/v1/${path}`, { headers });
      expect(response.status).toBe(404);
    }
  });

  it("accepts neither real admin cookies nor the jobs secret, and agent tokens grant no admin rights", async () => {
    const { createAuthenticatedUser, grantAdmin } = await import("./setup/auth-helpers");
    const { cookie, user } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    for (const otherHeaders of [{ cookie }, { "x-job-secret": makeTestEnv().JOB_SECRET }]) {
      expect((await app().request("/api/agent/v1/system", { headers: otherHeaders })).status).toBe(
        401,
      );
    }
    expect((await app().request("/api/admin/leagues", { headers })).status).toBe(401);
    expect((await app().request("/api/jobs/sync-scores", { method: "POST", headers })).status).toBe(
      401,
    );
  });

  it("counts Pick'em grading gaps and standing mismatches without exposing identities or settings extras", async () => {
    const fixture = await seedPickemLeague(db, auth, {
      leagueName: "private league name",
      members: [{ username: "private_person", displayName: "Private Person" }, {}],
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }, { kickoffAt: WEEK1_KICKOFF }] },
      ],
    });
    const weekId = fixture.weekIds.get("regular:1")!;
    const ids = fixture.gameIds.get("regular:1")!;
    const memberId = fixture.members.get(fixture.users[0]!.user.id)!;
    await db
      .update(leagueSeasons)
      .set({
        settings: sql`${leagueSeasons.settings} || '{"privateExtra":"private@example.com"}'::jsonb`,
      })
      .where(eq(leagueSeasons.id, fixture.leagueSeasonId));
    for (const id of ids)
      await db
        .update(games)
        .set({ status: "final", homeScore: 21, awayScore: 7 })
        .where(eq(games.id, id));
    const picks = [];
    for (const gameId of ids)
      picks.push(
        await insertPick(db, {
          leagueSeasonId: fixture.leagueSeasonId,
          leagueMemberId: memberId,
          weekId,
          gameId,
          side: "home",
          spreadAtPick: -3,
        }),
      );
    await db.insert(pickemPickResults).values({
      pickemPickId: picks[0]!.id,
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberId,
      weekId,
      outcome: "correct",
      points: 1,
      settledAt: SEED_AT,
    });
    await db.insert(pickemStandings).values({
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: memberId,
      weekId: null,
      points: 999,
      rank: 1,
      updatedAt: SEED_AT,
    });
    const raw = await get(`league-seasons/${fixture.leagueSeasonId}/diagnostics`);
    expect(AgentLeagueDiagnosticsResponseSchema.parse(raw)).toMatchObject({
      memberCount: 2,
      submittedPickCount: 2,
      gradedPickCount: 1,
      ungradedPickCount: 1,
      ungradedResolvedPickCount: 1,
      standingStateRowCount: 1,
      missingStandingCount: 1,
      inconsistentRowCount: 1,
      duplicateRowCount: 0,
    });
    const serialized = JSON.stringify(raw);
    for (const forbidden of [
      "private league name",
      "private_person",
      "Private Person",
      "private@example.com",
      memberId,
      fixture.users[0]!.user.id,
      "privateExtra",
      "leagueId",
      "dues",
    ])
      expect(serialized).not.toContain(forbidden);
    expect(raw).toEqual(AgentLeagueDiagnosticsResponseSchema.parse(raw));
  });

  it("treats missing Survivor state as alive while detecting invalid stored state and unresolved grading", async () => {
    const fixture = await seedSurvivorSeason(db, auth, { memberCount: 2 });
    const week = fixture.weeks[0]!;
    const path = `league-seasons/${fixture.leagueSeasonId}/diagnostics`;
    expect(await get(path)).toMatchObject({
      memberCount: 2,
      standingStateRowCount: 0,
      missingStandingCount: 0,
      inconsistentRowCount: 0,
    });
    const pick = await insertSurvivorPick(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: fixture.memberIds[0]!,
      weekId: week.weekId,
      gameId: week.gameId,
      teamId: week.homeTeamId,
    });
    await db.update(games).set({ status: "cancelled" }).where(eq(games.id, week.gameId));
    expect(await get(path)).toMatchObject({ submittedPickCount: 1, ungradedResolvedPickCount: 1 });
    await db.insert(survivorPickResults).values({
      survivorPickId: pick.id,
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: fixture.memberIds[0]!,
      weekId: week.weekId,
      outcome: "push",
      settledAt: SEED_AT,
    });
    await insertSurvivorState(db, {
      leagueSeasonId: fixture.leagueSeasonId,
      leagueMemberId: fixture.memberIds[0]!,
      livesRemaining: 0,
    });
    expect(await get(path)).toMatchObject({
      gradedPickCount: 1,
      ungradedPickCount: 0,
      ungradedResolvedPickCount: 0,
      standingStateRowCount: 1,
      missingStandingCount: 0,
      inconsistentRowCount: 1,
      duplicateRowCount: 0,
    });
  });
});
