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
import { GAME_STATUS, WEEK_TYPE, type WeekType, type JobRunResponse } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { syncNflScores } from "../src/services/nfl/sync-scores";
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
// Week 1 runs 09-08 → 09-15. Kickoffs sit inside it; the run clocks below
// straddle them so tests control which games are "active" (kicked off).
const BEFORE_KICKOFFS = new Date("2026-09-09T00:00:00.000Z");
const AFTER_KICKOFFS = new Date("2026-09-12T00:00:00.000Z");
const seedClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
const beforeClock = new FixedClock(BEFORE_KICKOFFS);
const afterClock = new FixedClock(AFTER_KICKOFFS);

/** Regular and postseason week numbers overlap, so the fake keys games by both. */
function weekKey(weekType: WeekType, weekNumber: number): string {
  return `${weekType}:${weekNumber}`;
}

/** Mutable in-memory provider that records every fetchNflWeekGames call. */
class FakeProvider implements GameDataProvider {
  structure: ProviderSeasonStructure = { seasonYear: SEASON_YEAR, weeks: [] };
  gamesByWeek = new Map<string, ProviderGame[]>();
  fetchCalls: Array<[number, WeekType, number]> = [];

  async fetchNflSeasonStructure(): Promise<ProviderSeasonStructure> {
    return this.structure;
  }

  async fetchNflWeekGames(
    seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    this.fetchCalls.push([seasonYear, weekType, weekNumber]);
    return this.gamesByWeek.get(weekKey(weekType, weekNumber)) ?? [];
  }
}

function providerWeek(
  weekNumber: number,
  startsAt: string,
  endsAt: string,
  weekType: WeekType = WEEK_TYPE.REGULAR,
  label = `Week ${weekNumber}`,
): ProviderWeek {
  return { weekType, weekNumber, label, startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
}

function providerGame(
  overrides: Partial<ProviderGame> & { providerGameId: string; weekNumber: number },
): ProviderGame {
  return {
    weekType: WEEK_TYPE.REGULAR,
    homeTeamAbbr: "HOM",
    homeTeamName: "Home Team",
    awayTeamAbbr: "AWY",
    awayTeamName: "Away Team",
    kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
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
  clock: async () => afterClock,
  provider,
});

/** Seeds one season + the given week with its games via the real schedule sync. */
async function seedSchedule(
  weekGames: ProviderGame[],
  week: ProviderWeek = providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
) {
  provider.structure = { seasonYear: SEASON_YEAR, weeks: [week] };
  provider.gamesByWeek = new Map([[weekKey(week.weekType, week.weekNumber), weekGames]]);
  await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
  provider.fetchCalls = [];
}

beforeEach(async () => {
  // FK order: odds_snapshots → games → weeks → sport_seasons.
  await db.delete(oddsSnapshots);
  await db.delete(games);
  await db.delete(weeks);
  await db.delete(sportSeasons);
  provider.structure = { seasonYear: SEASON_YEAR, weeks: [] };
  provider.gamesByWeek = new Map();
  provider.fetchCalls = [];
});

afterAll(async () => {
  await db.$client.end();
});

describe("syncNflScores", () => {
  it("no-ops without a single provider call when nothing has kicked off", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);

    const details = await syncNflScores(db, beforeClock, provider, {});
    expect(details).toEqual({ skipped: true, reason: "no_active_games", activeGames: 0 });
    expect(provider.fetchCalls).toHaveLength(0);
  });

  it("updates scores for an in-progress game", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 7,
        awayScore: 3,
      }),
    ]);

    const details = await syncNflScores(db, afterClock, provider, {});
    expect(details).toMatchObject({
      activeGames: 1,
      weeksFetched: 1,
      gamesUpdated: 1,
      wentFinal: 0,
      missingFromProvider: 0,
      unknownProviderGames: 0,
    });

    const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
    expect(g2?.status).toBe(GAME_STATUS.IN_PROGRESS);
    expect(g2?.homeScore).toBe(7);
    expect(g2?.awayScore).toBe(3);
    expect(g2?.updatedAt).toEqual(AFTER_KICKOFFS);
  });

  it("counts a transition to final and writes the final score", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        status: GAME_STATUS.FINAL,
        homeScore: 21,
        awayScore: 17,
      }),
    ]);

    const details = await syncNflScores(db, afterClock, provider, {});
    expect(details).toMatchObject({ gamesUpdated: 1, wentFinal: 1 });

    const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
    expect(g2?.status).toBe(GAME_STATUS.FINAL);
    expect(g2?.homeScore).toBe(21);
    expect(g2?.awayScore).toBe(17);
  });

  it("never clobbers admin override fields on re-sync (arch D15)", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);

    const overriddenAt = new Date("2026-09-11T18:00:00.000Z");
    await db
      .update(games)
      .set({
        overrideStatus: GAME_STATUS.CANCELLED,
        overrideHomeScore: 42,
        overrideAwayScore: 9,
        overriddenAt,
      })
      .where(eq(games.providerGameId, "g2"));

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        status: GAME_STATUS.FINAL,
        homeScore: 21,
        awayScore: 17,
      }),
    ]);

    await syncNflScores(db, afterClock, provider, {});

    const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
    // Provider fields followed the re-sync...
    expect(g2?.status).toBe(GAME_STATUS.FINAL);
    expect(g2?.homeScore).toBe(21);
    expect(g2?.awayScore).toBe(17);
    // ...while every override_* field stayed byte-identical.
    expect(g2?.overrideStatus).toBe(GAME_STATUS.CANCELLED);
    expect(g2?.overrideHomeScore).toBe(42);
    expect(g2?.overrideAwayScore).toBe(9);
    expect(g2?.overriddenAt).toEqual(overriddenAt);
  });

  it("ignores a provider game that isn't in our tables (never creates games)", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 3,
        awayScore: 0,
      }),
      providerGame({ providerGameId: "unknown", weekNumber: 1, status: GAME_STATUS.IN_PROGRESS }),
    ]);

    const details = await syncNflScores(db, afterClock, provider, {});
    expect(details).toMatchObject({ gamesUpdated: 1, unknownProviderGames: 1 });
    expect(await db.select().from(games)).toHaveLength(1);
  });

  it("leaves a game the provider no longer returns untouched and counts it", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g1",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      }),
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);

    // Provider only returns g1 now.
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g1",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 7,
        awayScore: 0,
      }),
    ]);

    const details = await syncNflScores(db, afterClock, provider, {});
    expect(details).toMatchObject({ gamesUpdated: 1, missingFromProvider: 1 });

    const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
    expect(g2?.status).toBe(GAME_STATUS.SCHEDULED);
    expect(g2?.homeScore).toBeNull();
    expect(g2?.awayScore).toBeNull();
  });

  it("bypasses the active gate when an explicit season/week is given", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 10,
        awayScore: 6,
      }),
    ]);

    // beforeClock: no game has kicked off, so the active-games gate is empty —
    // an explicit trigger must still refresh the requested week.
    const details = await syncNflScores(db, beforeClock, provider, {
      seasonYear: SEASON_YEAR,
      weekNumber: 1,
    });
    expect(details).toMatchObject({ activeGames: 0, weeksFetched: 1, gamesUpdated: 1 });
    expect(provider.fetchCalls).toEqual([[SEASON_YEAR, WEEK_TYPE.REGULAR, 1]]);
  });

  it("takes the explicit path for a lone week (season derived), not the active-games gate", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 10,
        awayScore: 6,
      }),
    ]);

    // beforeClock: nothing has kicked off, so the gate alone would return
    // no_active_games — a lone week must still refresh via the explicit path,
    // with the season derived from the clock (2026).
    const details = await syncNflScores(db, beforeClock, provider, { weekNumber: 1 });
    expect(details).toMatchObject({ activeGames: 0, weeksFetched: 1, gamesUpdated: 1 });
    expect(provider.fetchCalls).toEqual([[SEASON_YEAR, WEEK_TYPE.REGULAR, 1]]);
  });

  it("refreshes an active postseason game (gate resolves the postseason week triple)", async () => {
    await seedSchedule(
      [
        providerGame({
          providerGameId: "post1",
          weekType: WEEK_TYPE.POSTSEASON,
          weekNumber: 1,
          kickoffAt: new Date("2027-01-10T18:00:00.000Z"),
        }),
      ],
      providerWeek(
        1,
        "2027-01-09T00:00:00.000Z",
        "2027-01-13T00:00:00.000Z",
        WEEK_TYPE.POSTSEASON,
        "Wild Card",
      ),
    );

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.POSTSEASON, 1), [
      providerGame({
        providerGameId: "post1",
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 1,
        kickoffAt: new Date("2027-01-10T18:00:00.000Z"),
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 14,
        awayScore: 10,
      }),
    ]);

    // Clock sits after the Wild Card kickoff, so the postseason game is active
    // and the gate resolves its (season, postseason, 1) triple.
    const postseasonClock = new FixedClock(new Date("2027-01-10T21:00:00.000Z"));
    const details = await syncNflScores(db, postseasonClock, provider, {});
    expect(details).toMatchObject({ activeGames: 1, weeksFetched: 1, gamesUpdated: 1 });
    expect(provider.fetchCalls).toEqual([[SEASON_YEAR, WEEK_TYPE.POSTSEASON, 1]]);

    const [post1] = await db.select().from(games).where(eq(games.providerGameId, "post1"));
    expect(post1?.status).toBe(GAME_STATUS.IN_PROGRESS);
    expect(post1?.homeScore).toBe(14);
    expect(post1?.awayScore).toBe(10);
  });

  it("is idempotent: a second run with identical provider data updates nothing", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        status: GAME_STATUS.FINAL,
        homeScore: 21,
        awayScore: 17,
      }),
    ]);

    const first = await syncNflScores(db, afterClock, provider, {});
    expect(first).toMatchObject({ gamesUpdated: 1, wentFinal: 1 });

    // A final game is no longer active, so the second run no-ops entirely.
    const second = await syncNflScores(db, afterClock, provider, {});
    expect(second).toEqual({ skipped: true, reason: "no_active_games", activeGames: 0 });

    // Forcing the same data through the explicit path re-confirms zero writes.
    const third = await syncNflScores(db, afterClock, provider, {
      seasonYear: SEASON_YEAR,
      weekNumber: 1,
    });
    expect(third).toMatchObject({ gamesUpdated: 0, wentFinal: 0 });
  });
});

describe("POST /api/jobs/nfl/sync-scores", () => {
  it("401s without the x-job-secret header", async () => {
    const res = await app.request("/api/jobs/nfl/sync-scores", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("rejects an invalid weekType with a 400", async () => {
    const res = await app.request("/api/jobs/nfl/sync-scores?weekType=garbage", {
      method: "POST",
      headers: { "x-job-secret": testEnv.JOB_SECRET },
    });
    expect(res.status).toBe(400);
  });

  it("returns the job envelope with the score counters", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 7,
        awayScore: 3,
      }),
    ]);

    const res = await app.request("/api/jobs/nfl/sync-scores", {
      method: "POST",
      headers: { "x-job-secret": testEnv.JOB_SECRET },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobRunResponse;
    expect(body.status).toBe("ok");
    expect(body.details).toMatchObject({ gamesUpdated: 1, wentFinal: 0 });
  });
});
