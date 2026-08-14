import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, nflGameStatContext, games, nflTeamSeasonStats, teams } from "@picksleagues/db";
import { FixedClock, type ProviderNflGameStatContext } from "@picksleagues/core";
import { SPORT, WEEK_TYPE, type WeekType } from "@picksleagues/schemas";
import { StatsFakeProvider } from "./setup/fake-provider";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { syncNflStats } from "../src/services/nfl/sync-stats";
import {
  providerGame,
  providerNflTeamSeasonRecord as record,
  providerWeek,
} from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

// Instantiated for its env-shape side effects in other suites; here it keeps
// the file consistent with its siblings' setup.
makeTestEnv();

const SEASON_YEAR = 2026;
// Mid-week-1: past g1's kickoff, before g2's — so g1 is started, g2 is not.
const STATS_NOW = new Date("2026-09-12T00:00:00.000Z");
const seedClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
const statsClock = new FixedClock(STATS_NOW);

function weekKey(weekType: WeekType, weekNumber: number): string {
  return `${weekType}:${weekNumber}`;
}

const db = createDb(getTestDatabaseUrl());
const provider = new StatsFakeProvider();

function context(providerGameId: string, marker: string): ProviderNflGameStatContext {
  return {
    providerGameId,
    home: {
      injuries: [{ athleteName: marker, position: "WR", status: "Out", injuryType: "Ankle" }],
      fpiWinPct: 61.5,
      atsSummary: null,
      lastFive: [],
    },
    away: { injuries: [], fpiWinPct: 38.5, atsSummary: "1-0", lastFive: [] },
  };
}

/** Seeds the season + week 1 (two games, one already kicked off at STATS_NOW). */
async function seedSchedule() {
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
          kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
        }),
        providerGame({
          providerGameId: "g2",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        }),
      ],
    ],
  ]);
  await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
}

async function statsRows(seasonYear: number) {
  return db
    .select({
      abbreviation: teams.abbreviation,
      wins: nflTeamSeasonStats.wins,
      streak: nflTeamSeasonStats.streak,
      updatedAt: nflTeamSeasonStats.updatedAt,
    })
    .from(nflTeamSeasonStats)
    .innerJoin(teams, eq(nflTeamSeasonStats.teamId, teams.id))
    .where(eq(nflTeamSeasonStats.seasonYear, seasonYear));
}

beforeEach(async () => {
  await resetDb(db);
  provider.structure = { seasonYear: SEASON_YEAR, weeks: [] };
  provider.gamesByWeek = new Map();
  provider.recordsByYear = new Map();
  provider.contextByGameId = new Map();
  provider.recordFetches = [];
});

afterAll(async () => {
  await db.$client.end();
});

describe("syncNflStats", () => {
  it("skips when the season has never been synced — never creates reference data", async () => {
    const details = await syncNflStats(db, statsClock, provider, { seasonYear: SEASON_YEAR });
    expect(details).toEqual({ skipped: true, reason: "season_not_synced" });
    expect(provider.recordFetches).toHaveLength(0);
  });

  it("skips loudly on an explicitly requested week that isn't synced, before writing anything", async () => {
    await seedSchedule();
    provider.recordsByYear.set(SEASON_YEAR, [record("hom-id", SEASON_YEAR, { wins: 1 })]);

    const details = await syncNflStats(db, statsClock, provider, { weekNumber: 9 });

    expect(details).toEqual({ skipped: true, reason: "week_not_synced" });
    // The skip resolves before the team-stats write — a backfill aimed at a
    // week that doesn't exist must not half-run.
    expect(await statsRows(SEASON_YEAR)).toEqual([]);
  });

  it("upserts team season records and per-game context for unstarted games only", async () => {
    await seedSchedule();
    provider.recordsByYear.set(SEASON_YEAR, [
      record("hom-id", SEASON_YEAR, { wins: 1, streak: 1, pointsFor: 24, pointsAgainst: 20 }),
      record("awy-id", SEASON_YEAR, { losses: 1, streak: -1, pointsFor: 20, pointsAgainst: 24 }),
    ]);
    provider.contextByGameId.set("g1", context("g1", "started-game-context"));
    provider.contextByGameId.set("g2", context("g2", "unstarted-game-context"));

    const details = await syncNflStats(db, statsClock, provider, {});
    expect(details).toMatchObject({
      seasonYear: SEASON_YEAR,
      teamStatsUpdated: 2,
      priorSeasonTeamStatsUpdated: 0,
      unstartedGames: 1,
      contextsUpdated: 1,
      contextsMissing: 0,
    });

    const rows = await statsRows(SEASON_YEAR);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.abbreviation === "HOM")).toMatchObject({ wins: 1, streak: 1 });

    // Only the unstarted game got context — g1 kicked off, its sheet keeps
    // whatever was last synced pregame (here: nothing).
    const contexts = await db
      .select({ gameId: nflGameStatContext.gameId, payload: nflGameStatContext.payload })
      .from(nflGameStatContext);
    expect(contexts).toHaveLength(1);
    const [g2] = await db
      .select({ id: games.id })
      .from(games)
      .where(eq(games.providerGameId, "g2"));
    expect(contexts[0]!.gameId).toBe(g2!.id);
    expect(contexts[0]!.payload.home.injuries[0]!.athleteName).toBe("unstarted-game-context");
  });

  it("re-running over unmoved data writes nothing and keeps updated_at honest", async () => {
    await seedSchedule();
    provider.recordsByYear.set(SEASON_YEAR, [record("hom-id", SEASON_YEAR, { wins: 1 })]);
    provider.contextByGameId.set("g2", context("g2", "same"));

    await syncNflStats(db, statsClock, provider, {});
    const [before] = await statsRows(SEASON_YEAR);

    const laterClock = new FixedClock(new Date(STATS_NOW.getTime() + 60 * 60 * 1000));
    const details = await syncNflStats(db, laterClock, provider, {});
    expect(details).toMatchObject({ teamStatsUpdated: 0, contextsUpdated: 0 });

    const [after] = await statsRows(SEASON_YEAR);
    expect(after!.updatedAt).toEqual(before!.updatedAt);
  });

  it("backfills the prior season exactly while the current one has no games", async () => {
    await seedSchedule();
    // All-zero current records: the week-1 fallback window.
    provider.recordsByYear.set(SEASON_YEAR, [record("hom-id", SEASON_YEAR)]);
    provider.recordsByYear.set(SEASON_YEAR - 1, [
      record("hom-id", SEASON_YEAR - 1, { wins: 11, losses: 6, streak: -1 }),
    ]);

    const details = await syncNflStats(db, statsClock, provider, {});
    expect(details).toMatchObject({ teamStatsUpdated: 1, priorSeasonTeamStatsUpdated: 1 });
    expect(await statsRows(SEASON_YEAR - 1)).toEqual([
      expect.objectContaining({ abbreviation: "HOM", wins: 11, streak: -1 }),
    ]);

    // Once the current season has games, the prior year is not refetched.
    provider.recordsByYear.set(SEASON_YEAR, [record("hom-id", SEASON_YEAR, { wins: 1 })]);
    provider.recordFetches = [];
    await syncNflStats(db, statsClock, provider, {});
    expect(provider.recordFetches).toEqual([SEASON_YEAR]);
  });

  it("counts games the provider has no context for without failing the run", async () => {
    await seedSchedule();
    // No contexts registered at all.
    const details = await syncNflStats(db, statsClock, provider, {});
    expect(details).toMatchObject({ unstartedGames: 1, contextsUpdated: 0, contextsMissing: 1 });
  });

  it("skips provider teams that have never been synced rather than minting rows", async () => {
    await seedSchedule();
    provider.recordsByYear.set(SEASON_YEAR, [
      record("hom-id", SEASON_YEAR, { wins: 1 }),
      record("never-synced-id", SEASON_YEAR, { wins: 9 }),
    ]);

    const details = await syncNflStats(db, statsClock, provider, {});
    expect(details).toMatchObject({ teamStatsUpdated: 1 });
    const allRows = await db
      .select({ sport: teams.sport })
      .from(nflTeamSeasonStats)
      .innerJoin(teams, eq(nflTeamSeasonStats.teamId, teams.id));
    expect(allRows).toHaveLength(1);
    expect(allRows[0]!.sport).toBe(SPORT.NFL);
  });
});
