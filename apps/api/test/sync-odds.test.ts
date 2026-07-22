import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, games, oddsSnapshots, sportSeasons, weeks } from "@picksleagues/db";
import {
  FixedClock,
  type Env,
  type GameDataProvider,
  type ProviderGame,
  type ProviderSeasonStructure,
  type ProviderWeek,
} from "@picksleagues/core";
import { GAME_STATUS, type JobRunResponse } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { syncSchedule } from "../src/services/sync-schedule";
import { syncOdds } from "../src/services/sync-odds";
import { getTestDatabaseUrl } from "./setup/test-database-url";

const testEnv: Env = {
  APP_ENV: "local",
  DATABASE_URL: getTestDatabaseUrl(),
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  DISCORD_CLIENT_ID: "discord-id",
  DISCORD_CLIENT_SECRET: "discord-secret",
  JOB_SECRET: "b".repeat(32),
  ADMIN_USER_IDS: [],
};

const SEASON_YEAR = 2026;
// Week 1 runs 09-08 → 09-15; "now" sits mid-week, after g1's kickoff and
// before g2/g3's, so g1 is started and g2/g3 are not.
const ODDS_NOW = new Date("2026-09-12T00:00:00.000Z");
const seedClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
const oddsClock = new FixedClock(ODDS_NOW);

class FakeProvider implements GameDataProvider {
  structure: ProviderSeasonStructure = { seasonYear: SEASON_YEAR, weeks: [] };
  gamesByWeek = new Map<number, ProviderGame[]>();

  async fetchSeasonStructure(): Promise<ProviderSeasonStructure> {
    return this.structure;
  }

  async fetchWeekGames(_seasonYear: number, weekNumber: number): Promise<ProviderGame[]> {
    return this.gamesByWeek.get(weekNumber) ?? [];
  }
}

function providerWeek(weekNumber: number, startsAt: string, endsAt: string): ProviderWeek {
  return { weekNumber, startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
}

function providerGame(
  overrides: Partial<ProviderGame> & { providerGameId: string; weekNumber: number },
): ProviderGame {
  return {
    homeTeamAbbr: "HOM",
    homeTeamName: "Home Team",
    awayTeamAbbr: "AWY",
    awayTeamName: "Away Team",
    kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
    status: GAME_STATUS.SCHEDULED,
    homeScore: null,
    awayScore: null,
    spread: null,
    ...overrides,
  };
}

const db = createDb(getTestDatabaseUrl());
const provider = new FakeProvider();
const app = createApp({
  env: testEnv,
  db,
  clock: async () => oddsClock,
  provider,
});

/** Seeds one season + week 1 with the given games via the real schedule sync. */
async function seedSchedule(weekGames: ProviderGame[]) {
  provider.structure = {
    seasonYear: SEASON_YEAR,
    weeks: [providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z")],
  };
  provider.gamesByWeek = new Map([[1, weekGames]]);
  await syncSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
}

beforeEach(async () => {
  await db.delete(oddsSnapshots);
  await db.delete(games);
  await db.delete(weeks);
  await db.delete(sportSeasons);
  provider.structure = { seasonYear: SEASON_YEAR, weeks: [] };
  provider.gamesByWeek = new Map();
});

afterAll(async () => {
  await db.$client.end();
});

describe("syncOdds", () => {
  it("snapshots only unstarted games (a game past its kickoff is excluded)", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g1",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
        spread: -3.5,
      }),
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    const details = await syncOdds(db, oddsClock, provider, {});
    expect(details).toMatchObject({
      seasonYear: SEASON_YEAR,
      weekNumber: 1,
      unstartedGames: 1,
      snapshotsInserted: 1,
      gamesWithoutOdds: 0,
    });

    const snapshots = await db.select().from(oddsSnapshots);
    expect(snapshots).toHaveLength(1);
    const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
    expect(snapshots[0]).toMatchObject({ gameId: g2?.id, spread: 2.5 });
  });

  it("stamps capturedAt from the injected clock, not the DB clock", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    await syncOdds(db, oddsClock, provider, {});

    const [snapshot] = await db.select().from(oddsSnapshots);
    expect(snapshot?.capturedAt).toEqual(ODDS_NOW);
    expect(snapshot?.createdAt).toEqual(ODDS_NOW);
  });

  it("counts unstarted games without a provider line and inserts no snapshot for them", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
      providerGame({
        providerGameId: "g3",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T20:00:00.000Z"),
        spread: null,
      }),
    ]);

    const details = await syncOdds(db, oddsClock, provider, {});
    expect(details).toMatchObject({ unstartedGames: 2, snapshotsInserted: 1, gamesWithoutOdds: 1 });
    expect(await db.select().from(oddsSnapshots)).toHaveLength(1);
  });

  it("appends a fresh snapshot per game on every run (odds history is intentional)", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    await syncOdds(db, oddsClock, provider, {});
    await syncOdds(db, oddsClock, provider, {});

    expect(await db.select().from(oddsSnapshots)).toHaveLength(2);
  });

  it("pre-season: with no in-progress week, falls back to the next upcoming week and snapshots it", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    // Clock sits before week 1 starts (2026-09-08), so there is no in-progress
    // week — the next-upcoming-week fallback resolves week 1.
    const preSeasonClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
    const details = await syncOdds(db, preSeasonClock, provider, {});
    expect(details).toMatchObject({ weekNumber: 1, unstartedGames: 1, snapshotsInserted: 1 });
    expect(await db.select().from(oddsSnapshots)).toHaveLength(1);
  });

  it("off-season: after every week has ended with no explicit week, no_current_week and writes nothing", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    // Clock sits after week 1 ends (2026-09-15) with no later week to fall to.
    const offSeasonClock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    const details = await syncOdds(db, offSeasonClock, provider, {});
    expect(details).toMatchObject({ skipped: true, reason: "no_current_week" });
    expect(await db.select().from(oddsSnapshots)).toHaveLength(0);
  });

  it("explicit week: snapshots the requested week's unstarted games", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    const details = await syncOdds(db, oddsClock, provider, { weekNumber: 1 });
    expect(details).toMatchObject({ seasonYear: SEASON_YEAR, weekNumber: 1, snapshotsInserted: 1 });
    expect(await db.select().from(oddsSnapshots)).toHaveLength(1);
  });

  it("explicit week that isn't synced returns week_not_synced (distinct from the derived no_current_week)", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    const details = await syncOdds(db, oddsClock, provider, { weekNumber: 5 });
    expect(details).toMatchObject({ skipped: true, reason: "week_not_synced" });
    expect(await db.select().from(oddsSnapshots)).toHaveLength(0);
  });

  it("no-ops when the season has not been synced and writes nothing", async () => {
    const details = await syncOdds(db, oddsClock, provider, {});
    expect(details).toMatchObject({ skipped: true, reason: "season_not_synced" });
    expect(await db.select().from(sportSeasons)).toHaveLength(0);
    expect(await db.select().from(weeks)).toHaveLength(0);
    expect(await db.select().from(oddsSnapshots)).toHaveLength(0);
  });

  it("ignores a provider game that isn't in our tables (never creates games/weeks)", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    // Provider now reports an extra game we never ingested.
    provider.gamesByWeek.set(1, [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
      providerGame({
        providerGameId: "unknown",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: -7,
      }),
    ]);

    const details = await syncOdds(db, oddsClock, provider, {});
    expect(details).toMatchObject({ unstartedGames: 1, snapshotsInserted: 1 });
    expect(await db.select().from(games)).toHaveLength(1);
    expect(await db.select().from(weeks)).toHaveLength(1);
    expect(await db.select().from(oddsSnapshots)).toHaveLength(1);
  });
});

describe("POST /api/jobs/sync-odds", () => {
  it("401s without the x-job-secret header", async () => {
    const res = await app.request("/api/jobs/sync-odds", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("returns the job envelope with the odds counters", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    const res = await app.request("/api/jobs/sync-odds", {
      method: "POST",
      headers: { "x-job-secret": testEnv.JOB_SECRET },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobRunResponse;
    expect(body.status).toBe("ok");
    expect(body.details).toMatchObject({ weekNumber: 1, snapshotsInserted: 1 });
  });
});
