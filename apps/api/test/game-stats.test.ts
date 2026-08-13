import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, games } from "@picksleagues/db";
import {
  FixedClock,
  type ProviderGame,
  type ProviderGameStatContext,
  type ProviderSeasonStructure,
  type ProviderTeamSeasonRecord,
} from "@picksleagues/core";
import { WEEK_TYPE, type GameStatsResponse, type WeekType } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { syncNflStats } from "../src/services/nfl/sync-stats";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { BaseFakeProvider } from "./setup/fake-provider";
import { providerGame, providerWeek } from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

const SEASON_YEAR = 2026;
const NOW = new Date("2026-09-12T00:00:00.000Z");
const seedClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
const nowClock = new FixedClock(NOW);

function weekKey(weekType: WeekType, weekNumber: number): string {
  return `${weekType}:${weekNumber}`;
}

class FakeProvider extends BaseFakeProvider {
  structure: ProviderSeasonStructure = { seasonYear: SEASON_YEAR, weeks: [] };
  gamesByWeek = new Map<string, ProviderGame[]>();
  recordsByYear = new Map<number, ProviderTeamSeasonRecord[]>();
  contextByGameId = new Map<string, ProviderGameStatContext>();

  override async fetchNflSeasonStructure(): Promise<ProviderSeasonStructure> {
    return this.structure;
  }

  override async fetchNflWeekGames(
    _seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    return this.gamesByWeek.get(weekKey(weekType, weekNumber)) ?? [];
  }

  override async fetchNflTeamSeasonRecords(
    seasonYear: number,
  ): Promise<ProviderTeamSeasonRecord[]> {
    return this.recordsByYear.get(seasonYear) ?? [];
  }

  override async fetchNflGameStatContext(
    providerGameId: string,
  ): Promise<ProviderGameStatContext | null> {
    return this.contextByGameId.get(providerGameId) ?? null;
  }
}

const db = createDb(getTestDatabaseUrl());
const provider = new FakeProvider();
const auth = createAuth({ env: makeTestEnv(), db });
const app = createApp({
  auth,
  env: makeTestEnv(),
  db,
  clock: async () => nowClock,
  provider: async () => provider,
});

function record(
  providerTeamId: string,
  seasonYear: number,
  overrides?: Partial<ProviderTeamSeasonRecord>,
): ProviderTeamSeasonRecord {
  return {
    providerTeamId,
    seasonYear,
    wins: 0,
    losses: 0,
    ties: 0,
    homeWins: 0,
    homeLosses: 0,
    homeTies: 0,
    roadWins: 0,
    roadLosses: 0,
    roadTies: 0,
    streak: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    ...overrides,
  };
}

/** Seeds the schedule (one unstarted week-1 game) and runs the stats sync. */
async function seedAll() {
  provider.structure = {
    seasonYear: SEASON_YEAR,
    weeks: [providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z")],
  };
  provider.gamesByWeek = new Map([
    [
      weekKey(WEEK_TYPE.REGULAR, 1),
      [
        providerGame({
          providerGameId: "g1",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        }),
      ],
    ],
  ]);
  await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
  await syncNflStats(db, nowClock, provider, {});
  const [game] = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.providerGameId, "g1"));
  return game!.id;
}

async function getStats(gameId: string, cookie?: string) {
  return app.request(`/api/games/${gameId}/stats`, {
    headers: cookie ? { cookie } : {},
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

describe("GET /api/games/{gameId}/stats", () => {
  it("401s with no session", async () => {
    const res = await getStats("00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(401);
  });

  it("404s for an unknown game", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const res = await getStats("00000000-0000-4000-8000-000000000000", cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "game_not_found" });
  });

  it("serves records with derived averages plus the synced context", async () => {
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
      home: {
        injuries: [{ athleteName: "A. Safety", position: "S", status: "Out", injuryType: "Ankle" }],
        fpiWinPct: 61.5,
        atsSummary: "1-0",
        lastFive: [
          { result: "W", opponentAbbr: "AWY", teamScore: 27, opponentScore: 20, atHome: true },
        ],
      },
      away: { injuries: [], fpiWinPct: 38.5, atsSummary: null, lastFive: [] },
    });
    const gameId = await seedAll();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await getStats(gameId, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameStatsResponse;

    expect(body.home).toMatchObject({
      seasonYear: SEASON_YEAR,
      wins: 1,
      homeWins: 1,
      streak: 1,
      gamesPlayed: 1,
      avgPointsFor: 27,
      avgPointsAgainst: 20,
      scoringOffenseRank: 1,
      scoringDefenseRank: 1,
    });
    expect(body.away).toMatchObject({
      seasonYear: SEASON_YEAR,
      losses: 1,
      gamesPlayed: 1,
      scoringOffenseRank: 2,
      scoringDefenseRank: 2,
    });
    expect(body.context).toMatchObject({
      home: {
        injuries: [{ athleteName: "A. Safety", status: "Out" }],
        fpiWinPct: 61.5,
        atsSummary: "1-0",
      },
      away: { fpiWinPct: 38.5, atsSummary: null },
    });
    // The as-of stamps the sheet must show (spec §UI conventions).
    expect(body.home?.updatedAt).toBe(NOW.toISOString());
    expect(body.context?.updatedAt).toBe(NOW.toISOString());
  });

  it("falls back to the prior season per team while the current one has no games", async () => {
    // Current season: all-zero records (week 1). Prior: real finals.
    provider.recordsByYear.set(SEASON_YEAR, [
      record("hom-id", SEASON_YEAR),
      record("awy-id", SEASON_YEAR),
    ]);
    provider.recordsByYear.set(SEASON_YEAR - 1, [
      record("hom-id", SEASON_YEAR - 1, {
        wins: 11,
        losses: 6,
        streak: -1,
        pointsFor: 379,
        pointsAgainst: 325,
      }),
    ]);
    const gameId = await seedAll();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await getStats(gameId, cookie);
    const body = (await res.json()) as GameStatsResponse;

    // Home has prior-season numbers, labeled with the season they describe.
    expect(body.home).toMatchObject({ seasonYear: SEASON_YEAR - 1, wins: 11, streak: -1 });
    // Away has no prior row: its current all-zero row serves, honestly zeroed.
    expect(body.away).toMatchObject({
      seasonYear: SEASON_YEAR,
      gamesPlayed: 0,
      avgPointsFor: null,
    });
    // No context synced for this game.
    expect(body.context).toBeNull();
  });
});
