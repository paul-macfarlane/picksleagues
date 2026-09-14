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
  AgentLeagueDiscoveryResponseSchema,
  AgentGameResponseSchema,
  AgentLeagueDiagnosticsResponseSchema,
  AgentWeekResponseSchema,
} from "@picksleagues/schemas";
import { makeFixedAppHarness } from "./setup/fixed-app";
import { makeTestEnv } from "./setup/test-env";
import { resetDb } from "./setup/reset-db";
import {
  seedSeason,
  insertPick,
  insertLeague,
  membersOf,
  seasonIdFor,
  SEED_AT,
} from "./setup/league-helpers";
import { seedPickemLeague } from "./setup/pickem-league";
import {
  seedSurvivorSeason,
  seedSurvivorLeague,
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
      dataUpdatedAt: SEED_AT.toISOString(),
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
      dataUpdatedAt: null,
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
      dataUpdatedAt: SEED_AT.toISOString(),
    });
  });
});

it.each(["pickem", "survivor"] as const)(
  "%s detects result scope corruption in both directions without double-counting",
  async (mode) => {
    const seed = mode === "pickem" ? seedPickemLeague : seedSurvivorLeague;
    const fixture = await seed(db, auth, {
      members: [{}, {}],
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
    });
    const other = await insertLeague(db, {
      seasonId: fixture.seasonId,
      mode,
      members: fixture.users.map((u) => ({ userId: u.user.id, role: "member" })),
    });
    const otherSeasonId = await seasonIdFor(db, other.id);
    const otherMembers = await membersOf(db, other.id);
    const memberIds = fixture.users.map((u) => fixture.members.get(u.user.id)!);
    const weekId = fixture.weekIds.get("regular:1")!;
    const gameId = fixture.gameIds.get("regular:1")![0]!;
    const [game] = await db
      .select({ teamId: games.homeTeamId })
      .from(games)
      .where(eq(games.id, gameId));
    for (const [index, leagueMemberId] of memberIds.entries()) {
      const input = { leagueSeasonId: fixture.leagueSeasonId, leagueMemberId, weekId, gameId };
      const result = {
        leagueSeasonId: index === 0 ? otherSeasonId : fixture.leagueSeasonId,
        leagueMemberId: index === 0 ? otherMembers.get(fixture.users[0]!.user.id)! : memberIds[0]!,
        weekId,
        outcome: "correct" as const,
        settledAt: SEED_AT,
      };
      if (mode === "pickem") {
        const pick = await insertPick(db, { ...input, side: "home" });
        await db.insert(pickemPickResults).values({ ...result, pickemPickId: pick.id, points: 1 });
      } else {
        const pick = await insertSurvivorPick(db, { ...input, teamId: game!.teamId });
        await db.insert(survivorPickResults).values({ ...result, survivorPickId: pick.id });
      }
    }
    expect(await get(`league-seasons/${fixture.leagueSeasonId}/diagnostics`)).toMatchObject({
      submittedPickCount: 2,
      gradedPickCount: 1,
      ungradedPickCount: 0,
      inconsistentRowCount: 2,
    });
    expect(await get(`league-seasons/${otherSeasonId}/diagnostics`)).toMatchObject({
      submittedPickCount: 0,
      gradedPickCount: 1,
      inconsistentRowCount: 1,
    });
  },
);

describe("agent league discovery", () => {
  it("pages supported targets in UUID order, including concluded/private leagues and excluding other seasons/modes", async () => {
    const { seasonId } = await seedSeason(db, { weeks: [] });
    const expected = [];
    for (const [mode, status] of [
      ["pickem", "active"],
      ["survivor", "active"],
      ["pickem", "concluded"],
    ] as const) {
      const league = await insertLeague(db, {
        seasonId,
        mode,
        status,
        name: "PRIVATE_NAME",
        duesAmount: 123,
      });
      expected.push({ leagueSeasonId: await seasonIdFor(db, league.id), mode, status });
    }
    await insertLeague(db, { seasonId, mode: "march_madness" });
    const other = await seedSeason(db, { year: 2025, weeks: [] });
    await insertLeague(db, { seasonId: other.seasonId });
    expected.sort((a, b) => a.leagueSeasonId.localeCompare(b.leagueSeasonId));
    const rawFirst = await get(`league-seasons?seasonId=${seasonId}&limit=2`);
    const first = AgentLeagueDiscoveryResponseSchema.parse(rawFirst);
    expect(first).toEqual({
      seasonId,
      items: expected.slice(0, 2),
      nextCursor: expected[1]!.leagueSeasonId,
    });
    expect(rawFirst).toEqual(first);
    const second = await get(
      `league-seasons?seasonId=${seasonId}&limit=2&cursor=${first.nextCursor}`,
    );
    expect(second).toEqual({ seasonId, items: expected.slice(2), nextCursor: null });
    expect(JSON.stringify(first)).not.toContain("PRIVATE_NAME");
    // Cursor is a position, not a row dependency: a deleted target must not break resumption.
    await db.delete(leagueSeasons).where(eq(leagueSeasons.id, first.nextCursor!));
    expect(
      await get(`league-seasons?seasonId=${seasonId}&limit=2&cursor=${first.nextCursor}`),
    ).toEqual(second);
    const audit = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(audit).toMatchObject({ operation: "agentLeagueDiscovery", status: 200 });
    expect(JSON.stringify(audit)).not.toContain(seasonId);
  });

  it("caps pages at 100, defaults to 50 and ends an exact page without a spurious cursor", async () => {
    const { seasonId } = await seedSeason(db, { weeks: [] });
    for (let i = 0; i < 101; i++) await insertLeague(db, { seasonId });
    const defaultPage = AgentLeagueDiscoveryResponseSchema.parse(
      await get(`league-seasons?seasonId=${seasonId}`),
    );
    expect(defaultPage.items).toHaveLength(50);
    expect(defaultPage.nextCursor).toBe(defaultPage.items[49]!.leagueSeasonId);
    const full = AgentLeagueDiscoveryResponseSchema.parse(
      await get(`league-seasons?seasonId=${seasonId}&limit=100`),
    );
    expect(full.items).toHaveLength(100);
    const last = AgentLeagueDiscoveryResponseSchema.parse(
      await get(`league-seasons?seasonId=${seasonId}&limit=1&cursor=${full.nextCursor}`),
    );
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
  });

  it("returns an empty page for empty, unknown and non-NFL seasons", async () => {
    const empty = await seedSeason(db, { weeks: [] });
    const nonNfl = await seedSeason(db, { sport: "ncaamb", year: 2027, weeks: [] });
    await insertLeague(db, { seasonId: nonNfl.seasonId });
    for (const seasonId of [empty.seasonId, nonNfl.seasonId, randomUUID()]) {
      expect(await get(`league-seasons?seasonId=${seasonId}`)).toEqual({
        seasonId,
        items: [],
        nextCursor: null,
      });
    }
  });

  it.each([
    "",
    "seasonId=bad",
    `seasonId=${randomUUID()}&cursor=bad`,
    ...["0", "101", "-1", "1.5", "nope"].map((limit) => `seasonId=${randomUUID()}&limit=${limit}`),
  ])("refuses invalid discovery queries without echoing input: %s", async (query) => {
    const response = await app().request(`/api/agent/v1/league-seasons?${query}`, { headers });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "validation",
      message: "Invalid diagnostic identifier.",
    });
  });

  it("requires the agent credential and refuses mutations", async () => {
    const url = `/api/agent/v1/league-seasons?seasonId=${randomUUID()}`;
    expect((await app().request(url)).status).toBe(401);
    const response = await app().request(url, { headers, method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
