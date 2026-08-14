import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminAudit, createDb, games } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  WEEK_TYPE,
  type AdminNflGameStatContextsResponse,
  type AdminNflTeamSeasonStatsResponse,
  type NflGameStatContextOverrideRequest,
  type NflGameStatsResponse,
  type NflTeamSeasonStatsOverrideRequest,
} from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { syncNflStats } from "../src/services/nfl/sync-stats";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import { StatsFakeProvider } from "./setup/fake-provider";
import {
  providerGame,
  providerNflTeamSeasonRecord as record,
  providerWeek,
} from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

/**
 * The admin stats surface (STAT-7, ADR-0041): browsers over the two stats
 * tables, override writes onto them, and the properties the architecture makes
 * promises about — precedence through the read serializers (member and admin),
 * derived ranks following the *resolved* facts, a re-sync that can't clobber a
 * correction, an audit row in the same transaction, and clean full-clear
 * revert (arch D15).
 */

const SEASON_YEAR = 2026;
const NOW = new Date("2026-09-12T00:00:00.000Z");
const seedClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
const nowClock = new FixedClock(NOW);

const db = createDb(getTestDatabaseUrl());
const provider = new StatsFakeProvider();
const auth = createAuth({ env: makeTestEnv(), db });
const app = createApp({
  auth,
  env: makeTestEnv(),
  db,
  clock: async () => nowClock,
  provider: async () => provider,
});

const HOME_CONTEXT = {
  injuries: [{ athleteName: "A. Safety", position: "S", status: "Out", injuryType: "Ankle" }],
  fpiWinPct: 61.5,
  atsSummary: "1-0",
  lastFive: [
    { result: "W" as const, opponentAbbr: "AWY", teamScore: 27, opponentScore: 20, atHome: true },
  ],
};

/**
 * Two teams with one played game each (home team ahead on both sides of the
 * ball) plus a context payload on the one game — enough to exercise records,
 * rank derivation, and the context layer.
 */
async function seedAll() {
  provider.structure = {
    seasonYear: SEASON_YEAR,
    weeks: [providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z")],
  };
  provider.gamesByWeek = new Map([
    [
      StatsFakeProvider.weekKey(WEEK_TYPE.REGULAR, 1),
      [
        providerGame({
          providerGameId: "g1",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        }),
      ],
    ],
  ]);
  provider.recordsByYear.set(SEASON_YEAR, [
    record("hom-id", SEASON_YEAR, {
      wins: 1,
      homeWins: 1,
      streak: 1,
      pointsFor: 27,
      pointsAgainst: 20,
    }),
    record("awy-id", SEASON_YEAR, {
      losses: 1,
      roadLosses: 1,
      streak: -1,
      pointsFor: 20,
      pointsAgainst: 27,
    }),
  ]);
  provider.contextByGameId.set("g1", {
    providerGameId: "g1",
    home: HOME_CONTEXT,
    away: { injuries: [], fpiWinPct: 38.5, atsSummary: null, lastFive: [] },
  });
  await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
  await syncNflStats(db, nowClock, provider, {});

  const [game] = await db.select({ id: games.id, weekId: games.weekId }).from(games);
  return { gameId: game!.id, weekId: game!.weekId };
}

async function adminCaller() {
  const { user, cookie } = await createAuthenticatedUser(auth);
  await grantAdmin(db, user.id);
  return { cookie, userId: user.id };
}

function getAdminStats(cookie: string | undefined, season?: number) {
  const query = season === undefined ? "" : `?season=${season}`;
  return app.request(`/api/admin/nfl-stats${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

function putStatsOverride(
  cookie: string | undefined,
  statsId: string,
  body: NflTeamSeasonStatsOverrideRequest,
) {
  return app.request(`/api/admin/nfl-stats/${statsId}/override`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function getContexts(cookie: string | undefined, weekId: string) {
  return app.request(`/api/admin/nfl-stat-contexts?weekId=${weekId}`, {
    headers: cookie ? { cookie } : {},
  });
}

function putContextOverride(
  cookie: string | undefined,
  gameId: string,
  body: NflGameStatContextOverrideRequest,
) {
  return app.request(`/api/admin/nfl-stat-contexts/${gameId}/override`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** The member-facing read — where precedence must ultimately hold. */
async function memberStats(cookie: string, gameId: string): Promise<NflGameStatsResponse> {
  const res = await app.request(`/api/games/${gameId}/nfl-stats`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as NflGameStatsResponse;
}

async function statsRowId(cookie: string, abbreviation: string): Promise<string> {
  const res = await getAdminStats(cookie);
  const body = (await res.json()) as AdminNflTeamSeasonStatsResponse;
  const row = body.stats.find((stats) => stats.team.abbreviation === abbreviation);
  if (!row) throw new Error(`no stats row for ${abbreviation}`);
  return row.id;
}

beforeEach(async () => {
  await resetDb(db);
  provider.structure = { seasonYear: SEASON_YEAR, weeks: [] };
  provider.gamesByWeek = new Map();
  provider.recordsByYear = new Map();
  provider.contextByGameId = new Map();
});

afterAll(async () => {
  await db.$client.end();
});

describe("admin stats browsers — auth", () => {
  it("401s with no session and 403s without the admin role", async () => {
    const { weekId } = await seedAll();
    const { cookie } = await createAuthenticatedUser(auth);
    for (const request of [
      getAdminStats(undefined),
      getContexts(undefined, weekId),
      putStatsOverride(undefined, "00000000-0000-4000-8000-000000000000", { wins: 1 }),
      putContextOverride(undefined, "00000000-0000-4000-8000-000000000000", {}),
    ]) {
      expect((await request).status).toBe(401);
    }
    for (const request of [
      getAdminStats(cookie),
      getContexts(cookie, weekId),
      putStatsOverride(cookie, "00000000-0000-4000-8000-000000000000", { wins: 1 }),
      putContextOverride(cookie, "00000000-0000-4000-8000-000000000000", {}),
    ]) {
      expect((await request).status).toBe(403);
    }
  });
});

describe("GET /api/admin/nfl-stats", () => {
  it("serves the stored season years and the newest season's rows by default", async () => {
    await seedAll();
    const { cookie } = await adminCaller();

    const res = await getAdminStats(cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminNflTeamSeasonStatsResponse;

    expect(body.seasonYears).toEqual([SEASON_YEAR]);
    expect(body.seasonYear).toBe(SEASON_YEAR);
    expect(body.stats).toHaveLength(2);
    // Ordered by abbreviation; provider block = what the sync wrote, override
    // block empty, effective = provider.
    expect(body.stats[0]).toMatchObject({
      team: { abbreviation: "AWY" },
      losses: 1,
      overrideLosses: null,
      effectiveLosses: 1,
      overriddenAt: null,
    });
  });

  it("a requested year with no rows is an empty list under that year, not a fallback", async () => {
    await seedAll();
    const { cookie } = await adminCaller();

    const res = await getAdminStats(cookie, 2019);
    const body = (await res.json()) as AdminNflTeamSeasonStatsResponse;
    expect(body.seasonYear).toBe(2019);
    expect(body.stats).toEqual([]);
    expect(body.seasonYears).toEqual([SEASON_YEAR]);
  });
});

describe("PUT /api/admin/nfl-stats/{statsId}/override", () => {
  it("404s for an unknown row", async () => {
    const { cookie } = await adminCaller();
    const res = await putStatsOverride(cookie, "00000000-0000-4000-8000-000000000000", {
      wins: 1,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "team_season_stats_not_found" });
  });

  it("400s an empty body — at least one field is required", async () => {
    await seedAll();
    const { cookie } = await adminCaller();
    const id = await statsRowId(cookie, "AWY");
    expect((await putStatsOverride(cookie, id, {})).status).toBe(400);
  });

  it("resolves override ?? provider everywhere: admin blocks, member read, and rank derivation", async () => {
    const { gameId } = await seedAll();
    const { cookie } = await adminCaller();
    const awayId = await statsRowId(cookie, "AWY");

    // Flip the away team to the stronger offense (30 ppg vs home's 27).
    const res = await putStatsOverride(cookie, awayId, { wins: 1, losses: 0, pointsFor: 30 });
    expect(res.status).toBe(200);
    const { stats } = (await res.json()) as {
      stats: AdminNflTeamSeasonStatsResponse["stats"][number];
    };
    expect(stats).toMatchObject({
      wins: 0,
      overrideWins: 1,
      effectiveWins: 1,
      pointsFor: 20,
      overridePointsFor: 30,
      effectivePointsFor: 30,
      // Untouched field keeps provider truth through the resolved block.
      pointsAgainst: 27,
      effectivePointsAgainst: 27,
    });
    expect(stats.overriddenAt).toBe(NOW.toISOString());

    const body = await memberStats(cookie, gameId);
    // The member read serves resolved facts…
    expect(body.away).toMatchObject({ wins: 1, losses: 0, pointsFor: 30, avgPointsFor: 30 });
    // …and the rank pool ranks the *corrected* record for every team: away's
    // overridden 30 ppg now out-ranks home's provider 27.
    expect(body.away?.scoringOffenseRank).toBe(1);
    expect(body.home?.scoringOffenseRank).toBe(2);
  });

  it("writes the audit row in the same transaction, prior value = the override layer", async () => {
    await seedAll();
    const { cookie, userId } = await adminCaller();
    const awayId = await statsRowId(cookie, "AWY");

    await putStatsOverride(cookie, awayId, { wins: 1 });
    await putStatsOverride(cookie, awayId, { wins: 2 });

    const rows = await db.select().from(adminAudit);
    expect(rows).toHaveLength(2);
    const second = rows.find(
      (row) => (row.priorValue as { overrideWins: number | null }).overrideWins === 1,
    );
    expect(second).toMatchObject({
      adminUserId: userId,
      action: ADMIN_AUDIT_ACTION.NFL_TEAM_SEASON_STATS_OVERRIDE,
      targetTable: ADMIN_AUDIT_TARGET_TABLE.NFL_TEAM_SEASON_STATS,
      targetId: awayId,
    });
  });

  it("a re-sync updates provider facts without clobbering the correction", async () => {
    await seedAll();
    const { cookie } = await adminCaller();
    const awayId = await statsRowId(cookie, "AWY");
    await putStatsOverride(cookie, awayId, { streak: 3 });

    // The provider moves on (away team wins one) and the sync runs again.
    provider.recordsByYear.set(SEASON_YEAR, [
      record("hom-id", SEASON_YEAR, {
        wins: 1,
        homeWins: 1,
        streak: 1,
        pointsFor: 27,
        pointsAgainst: 20,
      }),
      record("awy-id", SEASON_YEAR, {
        wins: 1,
        losses: 1,
        roadLosses: 1,
        streak: 1,
        pointsFor: 44,
        pointsAgainst: 44,
      }),
    ]);
    await syncNflStats(db, nowClock, provider, {});

    const res = await getAdminStats(cookie);
    const body = (await res.json()) as AdminNflTeamSeasonStatsResponse;
    const away = body.stats.find((row) => row.team.abbreviation === "AWY");
    // Provider block took the sync; the override layer and its precedence held.
    expect(away).toMatchObject({
      wins: 1,
      pointsFor: 44,
      streak: 1,
      overrideStreak: 3,
      effectiveStreak: 3,
      effectiveWins: 1,
    });
  });

  it("three-state: omitted keeps, null clears, and a full clear reverts cleanly", async () => {
    await seedAll();
    const { cookie } = await adminCaller();
    const awayId = await statsRowId(cookie, "AWY");
    await putStatsOverride(cookie, awayId, { wins: 1, streak: 3 });

    // Omitting `wins` leaves it; nulling `streak` clears it.
    let res = await putStatsOverride(cookie, awayId, { streak: null });
    let { stats } = (await res.json()) as {
      stats: AdminNflTeamSeasonStatsResponse["stats"][number];
    };
    expect(stats).toMatchObject({ overrideWins: 1, overrideStreak: null, effectiveStreak: -1 });
    expect(stats.overriddenAt).toBe(NOW.toISOString());

    // Clearing the last override reverts the row to never-corrected shape.
    res = await putStatsOverride(cookie, awayId, { wins: null });
    ({ stats } = (await res.json()) as {
      stats: AdminNflTeamSeasonStatsResponse["stats"][number];
    });
    expect(stats).toMatchObject({
      overrideWins: null,
      overriddenBy: null,
      overriddenAt: null,
      effectiveWins: 0,
    });
  });
});

describe("GET /api/admin/nfl-stat-contexts", () => {
  it("lists the week's games, including one the sync has no context for", async () => {
    const { weekId } = await seedAll();
    // A second game the context sync never reached.
    provider.gamesByWeek.get(StatsFakeProvider.weekKey(WEEK_TYPE.REGULAR, 1))!.push(
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T20:00:00.000Z"),
      }),
    );
    await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });

    const { cookie } = await adminCaller();
    const res = await getContexts(cookie, weekId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminNflGameStatContextsResponse;

    expect(body.games).toHaveLength(2);
    const [synced, unsynced] = body.games;
    expect(synced?.context).toMatchObject({
      payload: { home: { fpiWinPct: 61.5 } },
      overridePayload: null,
      effective: { home: { fpiWinPct: 61.5 } },
    });
    // The gap is visible, not hidden — that's the browser's verification value.
    expect(unsynced?.context).toBeNull();
  });
});

describe("PUT /api/admin/nfl-stat-contexts/{gameId}/override", () => {
  it("404s for an unknown game and for a game without a context row", async () => {
    const { weekId } = await seedAll();
    provider.gamesByWeek.get(StatsFakeProvider.weekKey(WEEK_TYPE.REGULAR, 1))!.push(
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T20:00:00.000Z"),
      }),
    );
    await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
    const { cookie } = await adminCaller();

    const unknown = await putContextOverride(cookie, "00000000-0000-4000-8000-000000000000", {});
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "game_stat_context_not_found" });

    const res = await getContexts(cookie, weekId);
    const body = (await res.json()) as AdminNflGameStatContextsResponse;
    const contextless = body.games.find((game) => game.context === null);
    const noContext = await putContextOverride(cookie, contextless!.gameId, {});
    expect(noContext.status).toBe(404);
  });

  it("a sparse override wins field-by-field on the member read; the rest keeps syncing", async () => {
    const { gameId } = await seedAll();
    const { cookie, userId } = await adminCaller();

    const res = await putContextOverride(cookie, gameId, {
      home: { injuries: [] },
    });
    expect(res.status).toBe(200);

    let body = await memberStats(cookie, gameId);
    // The overridden field masks the provider's report…
    expect(body.context?.home.injuries).toEqual([]);
    // …while the same side's other fields still serve provider truth.
    expect(body.context?.home).toMatchObject({ fpiWinPct: 61.5, atsSummary: "1-0" });
    expect(body.context?.away).toMatchObject({ fpiWinPct: 38.5 });

    // Audit row, same transaction, prior = the previous (empty) layer.
    const audit = await db.select().from(adminAudit);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      adminUserId: userId,
      action: ADMIN_AUDIT_ACTION.NFL_GAME_STAT_CONTEXT_OVERRIDE,
      targetTable: ADMIN_AUDIT_TARGET_TABLE.NFL_GAME_STAT_CONTEXT,
      priorValue: { overridePayload: null, overriddenBy: null, overriddenAt: null },
    });

    // A re-sync with fresh provider data updates the payload under the
    // override: FPI moves, the injury mask holds.
    provider.contextByGameId.set("g1", {
      providerGameId: "g1",
      home: { ...HOME_CONTEXT, fpiWinPct: 70 },
      away: { injuries: [], fpiWinPct: 30, atsSummary: null, lastFive: [] },
    });
    await syncNflStats(db, nowClock, provider, {});
    body = await memberStats(cookie, gameId);
    expect(body.context?.home).toMatchObject({ injuries: [], fpiWinPct: 70 });
  });

  it("an empty body clears the layer back to never-corrected", async () => {
    const { gameId, weekId } = await seedAll();
    const { cookie } = await adminCaller();
    await putContextOverride(cookie, gameId, { home: { fpiWinPct: 99 } });

    const res = await putContextOverride(cookie, gameId, {});
    expect(res.status).toBe(200);

    const list = await getContexts(cookie, weekId);
    const body = (await list.json()) as AdminNflGameStatContextsResponse;
    expect(body.games[0]?.context).toMatchObject({
      overridePayload: null,
      overriddenBy: null,
      overriddenAt: null,
      effective: { home: { fpiWinPct: 61.5 } },
    });
  });

  it("an empty-object side normalizes away — {} carries no override", async () => {
    const { gameId, weekId } = await seedAll();
    const { cookie } = await adminCaller();

    await putContextOverride(cookie, gameId, { home: {}, away: {} });
    const list = await getContexts(cookie, weekId);
    const body = (await list.json()) as AdminNflGameStatContextsResponse;
    expect(body.games[0]?.context).toMatchObject({ overridePayload: null, overriddenAt: null });
  });
});
