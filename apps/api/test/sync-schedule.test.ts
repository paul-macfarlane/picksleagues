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

// September → nflSeasonYearFor maps to 2026, so a bare (cron-style) trigger
// defaults to season 2026.
const FIXED_NOW = new Date("2026-09-15T12:00:00.000Z");
const SEASON_YEAR = 2026;

/** Mutable in-memory provider — reshape `structure`/`gamesByWeek` between runs. */
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
    kickoffAt: new Date("2026-09-13T17:00:00.000Z"),
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
  clock: async () => new FixedClock(FIXED_NOW),
  provider,
});

function runSyncSchedule(query = "", secret: string | null = testEnv.JOB_SECRET) {
  return app.request(`/api/jobs/sync-schedule${query}`, {
    method: "POST",
    headers: secret ? { "x-job-secret": secret } : {},
  });
}

async function runOk(query = ""): Promise<Record<string, string | number | boolean>> {
  const res = await runSyncSchedule(query);
  expect(res.status).toBe(200);
  const body = (await res.json()) as JobRunResponse;
  expect(body.status).toBe("ok");
  return body.details ?? {};
}

/** Baseline: two weeks, two games in week 1, one in week 2. */
function seedBaselineProvider() {
  provider.structure = {
    seasonYear: SEASON_YEAR,
    weeks: [
      providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
      providerWeek(2, "2026-09-15T00:00:00.000Z", "2026-09-22T00:00:00.000Z"),
    ],
  };
  provider.gamesByWeek = new Map([
    [
      1,
      [
        providerGame({ providerGameId: "g1", weekNumber: 1 }),
        providerGame({ providerGameId: "g2", weekNumber: 1 }),
      ],
    ],
    [2, [providerGame({ providerGameId: "g3", weekNumber: 2 })]],
  ]);
}

beforeEach(async () => {
  // FK order: odds_snapshots → games → weeks → sport_seasons.
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

describe("POST /api/jobs/sync-schedule", () => {
  it("401s without the x-job-secret header", async () => {
    const res = await runSyncSchedule("", null);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("first run creates the season, weeks, and games with counters in the envelope", async () => {
    seedBaselineProvider();

    const details = await runOk();
    expect(details).toMatchObject({
      seasonYear: SEASON_YEAR,
      weeksUpserted: 2,
      gamesCreated: 3,
      gamesUpdated: 0,
      postponements: 0,
      cancellations: 0,
      weekMoves: 0,
      kickoffChanges: 0,
    });

    const [season] = await db.select().from(sportSeasons);
    expect(season).toMatchObject({ sport: "nfl", year: SEASON_YEAR });
    expect(await db.select().from(weeks)).toHaveLength(2);
    expect(await db.select().from(games)).toHaveLength(3);
  });

  it("is idempotent: a second run with identical data leaves every row byte-identical and creates nothing", async () => {
    seedBaselineProvider();
    await runOk();
    const first = await db.select().from(games).orderBy(games.providerGameId);

    const details = await runOk();
    expect(details).toMatchObject({ gamesCreated: 0, gamesUpdated: 3 });

    const second = await db.select().from(games).orderBy(games.providerGameId);
    expect(second).toEqual(first);
  });

  it("updates kickoffAt and counts a kickoff change", async () => {
    seedBaselineProvider();
    await runOk();

    const moved = new Date("2026-09-14T20:00:00.000Z");
    provider.gamesByWeek.set(1, [
      providerGame({ providerGameId: "g1", weekNumber: 1, kickoffAt: moved }),
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);

    const details = await runOk();
    expect(details).toMatchObject({ kickoffChanges: 1, gamesCreated: 0 });
    const [g1] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    expect(g1?.kickoffAt).toEqual(moved);
  });

  it.each([
    { label: "postponed", status: GAME_STATUS.POSTPONED, counter: "postponements" },
    { label: "cancelled", status: GAME_STATUS.CANCELLED, counter: "cancellations" },
  ])("updates status to $label and counts it", async ({ status, counter }) => {
    seedBaselineProvider();
    await runOk();

    provider.gamesByWeek.set(1, [
      providerGame({ providerGameId: "g1", weekNumber: 1, status }),
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);

    const details = await runOk();
    expect(details[counter]).toBe(1);
    const [g1] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    expect(g1?.status).toBe(status);
  });

  it("moves a game to another week and counts the week move", async () => {
    seedBaselineProvider();
    await runOk();
    const [before] = await db.select().from(games).where(eq(games.providerGameId, "g1"));

    // g1 leaves week 1 and reappears in week 2's fetch.
    provider.gamesByWeek.set(1, [providerGame({ providerGameId: "g2", weekNumber: 1 })]);
    provider.gamesByWeek.set(2, [
      providerGame({ providerGameId: "g3", weekNumber: 2 }),
      providerGame({ providerGameId: "g1", weekNumber: 2 }),
    ]);

    const details = await runOk();
    expect(details).toMatchObject({ weekMoves: 1, gamesCreated: 0 });
    const [after] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    expect(after?.weekId).not.toBe(before?.weekId);

    const [week2] = await db.select().from(weeks).where(eq(weeks.weekNumber, 2));
    expect(after?.weekId).toBe(week2?.id);
  });

  it("never clobbers admin override fields on re-sync (arch D15)", async () => {
    seedBaselineProvider();
    await runOk();

    const overriddenAt = new Date("2026-09-16T00:00:00.000Z");
    const overrideKickoff = new Date("2026-12-25T00:00:00.000Z");
    await db
      .update(games)
      .set({
        overrideStatus: GAME_STATUS.CANCELLED,
        overrideKickoffAt: overrideKickoff,
        overrideHomeScore: 42,
        overriddenAt,
      })
      .where(eq(games.providerGameId, "g1"));

    // Provider data for g1 changes across the board.
    provider.gamesByWeek.set(1, [
      providerGame({
        providerGameId: "g1",
        weekNumber: 1,
        status: GAME_STATUS.FINAL,
        kickoffAt: new Date("2026-09-13T18:00:00.000Z"),
        homeScore: 21,
        awayScore: 17,
      }),
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);

    await runOk();

    const [g1] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    // Provider fields followed the re-sync...
    expect(g1?.status).toBe(GAME_STATUS.FINAL);
    expect(g1?.homeScore).toBe(21);
    expect(g1?.awayScore).toBe(17);
    expect(g1?.kickoffAt).toEqual(new Date("2026-09-13T18:00:00.000Z"));
    // ...while every override_* field stayed byte-identical.
    expect(g1?.overrideStatus).toBe(GAME_STATUS.CANCELLED);
    expect(g1?.overrideKickoffAt).toEqual(overrideKickoff);
    expect(g1?.overrideHomeScore).toBe(42);
    expect(g1?.overriddenAt).toEqual(overriddenAt);
  });

  it("narrows to a single week when ?week= is given (only that week's games are fetched)", async () => {
    seedBaselineProvider();

    const details = await runOk("?week=1");
    // Both week rows are still synced (cheap structure data), but only week 1's
    // games were fetched and upserted.
    expect(details).toMatchObject({ weeksUpserted: 2, gamesCreated: 2 });
    const gameRows = await db.select().from(games);
    expect(gameRows.map((g) => g.providerGameId).sort()).toEqual(["g1", "g2"]);
  });

  it("honors an explicit ?season=", async () => {
    seedBaselineProvider();
    provider.structure.seasonYear = 2025;

    const details = await runOk("?season=2025");
    expect(details.seasonYear).toBe(2025);
    const [season] = await db.select().from(sportSeasons);
    expect(season?.year).toBe(2025);
  });
});
