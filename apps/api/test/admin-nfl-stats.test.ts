import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { games } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  WEEK_TYPE,
  type AdminNflGameStatContextsResponse,
  type AdminNflTeamSeasonStatsResponse,
} from "@picksleagues/schemas";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { syncNflStats } from "../src/services/nfl/sync-stats";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { StatsFakeProvider } from "./setup/fake-provider";
import {
  providerGame,
  providerNflTeamSeasonRecord as record,
  providerWeek,
} from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { makeFixedAppHarness, withCookie } from "./setup/fixed-app";

/**
 * The admin stats surface (STAT-7): read-only browsers over the two stats
 * tables, which serve the stored rows exactly as the sync wrote them.
 */

const SEASON_YEAR = 2026;
const NOW = new Date("2026-09-12T00:00:00.000Z");
const seedClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
const nowClock = new FixedClock(NOW);

const provider = new StatsFakeProvider();
const { db, auth, appAt, adminCaller } = makeFixedAppHarness();
const app = appAt(nowClock.now(), { provider: async () => provider });

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

function getAdminStats(cookie: string | undefined, season?: number) {
  const query = season === undefined ? "" : `?season=${season}`;
  return app.request(`/api/admin/nfl-stats${query}`, {
    headers: withCookie(cookie),
  });
}

function getContexts(cookie: string | undefined, weekId: string) {
  return app.request(`/api/admin/nfl-stat-contexts?weekId=${weekId}`, {
    headers: withCookie(cookie),
  });
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
    for (const request of [getAdminStats(undefined), getContexts(undefined, weekId)]) {
      expect((await request).status).toBe(401);
    }
    for (const request of [getAdminStats(cookie), getContexts(cookie, weekId)]) {
      expect((await request).status).toBe(403);
    }
  });
});

describe("GET /api/admin/nfl-stats", () => {
  it("serves the stored season years and the newest season's rows by default", async () => {
    await seedAll();
    const { cookie } = await adminCaller(app);

    const res = await getAdminStats(cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminNflTeamSeasonStatsResponse;

    expect(body.seasonYears).toEqual([SEASON_YEAR]);
    expect(body.seasonYear).toBe(SEASON_YEAR);
    expect(body.stats).toHaveLength(2);
    // Ordered by abbreviation; the row is what the sync wrote.
    expect(body.stats[0]).toMatchObject({ team: { abbreviation: "AWY" }, losses: 1 });
  });

  it("a requested year with no rows is an empty list under that year, not a fallback", async () => {
    await seedAll();
    const { cookie } = await adminCaller(app);

    const res = await getAdminStats(cookie, 2019);
    const body = (await res.json()) as AdminNflTeamSeasonStatsResponse;
    expect(body.seasonYear).toBe(2019);
    expect(body.stats).toEqual([]);
    expect(body.seasonYears).toEqual([SEASON_YEAR]);
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

    const { cookie } = await adminCaller(app);
    const res = await getContexts(cookie, weekId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminNflGameStatContextsResponse;

    expect(body.games).toHaveLength(2);
    const [synced, unsynced] = body.games;
    expect(synced?.context).toMatchObject({ payload: { home: { fpiWinPct: 61.5 } } });
    // The gap is visible, not hidden — that's the browser's verification value.
    expect(unsynced?.context).toBeNull();
  });
});
