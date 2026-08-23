import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { games, sportSeasons } from "@picksleagues/db";
import {
  FixedClock,
  type ProviderGame,
  type ProviderSeasonStructure,
  type ProviderWeek,
} from "@picksleagues/core";
import { GAME_STATUS, WEEK_TYPE, type WeekType, type JobRunResponse } from "@picksleagues/schemas";
import { BaseFakeProvider } from "./setup/fake-provider";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { syncNflScores } from "../src/services/nfl/sync-scores";
import { providerGame, providerWeek } from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { makeFixedAppHarness } from "./setup/fixed-app";
import { makeTestEnv } from "./setup/test-env";
import { runScoresSyncJob } from "./setup/jobs";

const testEnv = makeTestEnv();

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
class FakeProvider extends BaseFakeProvider {
  structure: ProviderSeasonStructure = { seasonYear: SEASON_YEAR, weeks: [] };
  gamesByWeek = new Map<string, ProviderGame[]>();
  fetchCalls: Array<[number, WeekType, number]> = [];

  override async fetchNflSeasonStructure(): Promise<ProviderSeasonStructure> {
    return this.structure;
  }

  override async fetchNflWeekGames(
    seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    this.fetchCalls.push([seasonYear, weekType, weekNumber]);
    return this.gamesByWeek.get(weekKey(weekType, weekNumber)) ?? [];
  }
}

const { db, appAt } = makeFixedAppHarness();
const provider = new FakeProvider();
const app = appAt(afterClock.now(), { env: testEnv, provider: async () => provider });

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
  await resetDb(db);
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
        period: 2,
        clockSeconds: 421,
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
    // Live state lands with the scores it was observed alongside (DATA-8), and
    // `updated_at` is the as-of instant reads serve for it.
    expect(g2?.period).toBe(2);
    expect(g2?.clockSeconds).toBe(421);
    expect(g2?.updatedAt).toEqual(AFTER_KICKOFFS);
  });

  /**
   * The whole reason the game clock is part of change detection: between two
   * polls of a game whose score hasn't moved, the clock still has, and the
   * as-of stamp the UI shows is `updated_at` — a tick the job declined to
   * persist would be served under a minutes-old timestamp.
   */
  it("persists a clock-only change, moving the as-of stamp with it", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
      }),
    ]);

    const inProgress = (period: number, clockSeconds: number) =>
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 7,
        awayScore: 3,
        period,
        clockSeconds,
      });

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [inProgress(2, 421)]);
    await syncNflScores(db, afterClock, provider, {});

    // Same score, same status, five minutes of game clock later.
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [inProgress(2, 121)]);
    const laterClock = new FixedClock(new Date(AFTER_KICKOFFS.getTime() + 5 * 60 * 1000));
    const details = await syncNflScores(db, laterClock, provider, {});
    expect(details).toMatchObject({ gamesUpdated: 1, wentFinal: 0 });

    const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
    expect(g2?.clockSeconds).toBe(121);
    expect(g2?.updatedAt).toEqual(laterClock.now());
  });

  it("clears the live state when a game goes final", async () => {
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
        homeScore: 21,
        awayScore: 17,
        period: 4,
        clockSeconds: 12,
      }),
    ]);
    await syncNflScores(db, afterClock, provider, {});

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
    expect(g2?.status).toBe(GAME_STATUS.FINAL);
    expect(g2?.period).toBeNull();
    expect(g2?.clockSeconds).toBeNull();
  });

  it("no-ops when the provider repeats identical live state", async () => {
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
        period: 2,
        clockSeconds: 421,
      }),
    ]);
    await syncNflScores(db, afterClock, provider, {});

    const laterClock = new FixedClock(new Date(AFTER_KICKOFFS.getTime() + 5 * 60 * 1000));
    const details = await syncNflScores(db, laterClock, provider, {});
    expect(details).toMatchObject({ gamesUpdated: 0, wentFinal: 0 });

    // Nothing moved, so the as-of stamp stays honest about when this reading
    // was actually observed.
    const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
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

/**
 * Same offseason roll-forward as sync-odds: with the derived season concluded,
 * a season-derived run must target the next season's weeks. The bare path's
 * active-games gate is season-agnostic (it joins each active game's own
 * season), so the roll-forward shows up on the season-derived explicit week.
 */
describe("syncNflScores: offseason season roll-forward", () => {
  const NEXT_SEASON_YEAR = SEASON_YEAR + 1;
  // July 2027 → nflSeasonYearFor derives 2026, the concluded season.
  const offseasonClock = new FixedClock(new Date("2027-07-27T00:00:00.000Z"));

  async function seedSeason(seasonYear: number, week: ProviderWeek, weekGames: ProviderGame[]) {
    provider.structure = { seasonYear, weeks: [week] };
    provider.gamesByWeek = new Map([[weekKey(week.weekType, week.weekNumber), weekGames]]);
    await syncNflSchedule(db, seedClock, provider, { seasonYear });
    provider.fetchCalls = [];
  }

  /** The derived default season, played out and final — nothing left active. */
  function seedConcludedDefaultSeason() {
    return seedSeason(
      SEASON_YEAR,
      providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
      [
        providerGame({
          providerGameId: "g2",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
          status: GAME_STATUS.FINAL,
          homeScore: 21,
          awayScore: 17,
        }),
      ],
    );
  }

  function seedUpcomingSeason() {
    return seedSeason(
      NEXT_SEASON_YEAR,
      providerWeek(1, "2027-09-09T00:00:00.000Z", "2027-09-16T00:00:00.000Z"),
      [
        providerGame({
          providerGameId: "n1",
          weekNumber: 1,
          kickoffAt: new Date("2027-09-12T17:00:00.000Z"),
        }),
      ],
    );
  }

  it("default season concluded + next season synced: a season-derived week targets the NEXT season", async () => {
    await seedConcludedDefaultSeason();
    await seedUpcomingSeason();
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "n1",
        weekNumber: 1,
        kickoffAt: new Date("2027-09-12T17:00:00.000Z"),
        status: GAME_STATUS.POSTPONED,
      }),
    ]);

    const details = await syncNflScores(db, offseasonClock, provider, { weekNumber: 1 });
    expect(details).toMatchObject({ weeksFetched: 1, gamesUpdated: 1 });
    expect(provider.fetchCalls).toEqual([[NEXT_SEASON_YEAR, WEEK_TYPE.REGULAR, 1]]);

    const [n1] = await db.select().from(games).where(eq(games.providerGameId, "n1"));
    expect(n1?.status).toBe(GAME_STATUS.POSTPONED);

    // Idempotent: the same provider data a second time writes nothing.
    provider.fetchCalls = [];
    const second = await syncNflScores(db, offseasonClock, provider, { weekNumber: 1 });
    expect(second).toMatchObject({ gamesUpdated: 0, wentFinal: 0 });
  });

  it("default season concluded + NO next season row: stays on the default and never creates one", async () => {
    await seedConcludedDefaultSeason();
    const seasonsBefore = await db.select().from(sportSeasons);

    const details = await syncNflScores(db, offseasonClock, provider, { weekNumber: 1 });
    expect(details).toMatchObject({ weeksFetched: 1 });
    expect(provider.fetchCalls).toEqual([[SEASON_YEAR, WEEK_TYPE.REGULAR, 1]]);
    // Creating next year's season is schedule-sync's job — recurring syncs only
    // ever query reference data.
    expect(await db.select().from(sportSeasons)).toEqual(seasonsBefore);
  });

  it("an explicit season still wins over the roll-forward", async () => {
    await seedConcludedDefaultSeason();
    await seedUpcomingSeason();

    const details = await syncNflScores(db, offseasonClock, provider, {
      seasonYear: SEASON_YEAR,
      weekNumber: 1,
    });
    expect(details).toMatchObject({ weeksFetched: 1 });
    expect(provider.fetchCalls).toEqual([[SEASON_YEAR, WEEK_TYPE.REGULAR, 1]]);
  });

  it("a bare run in the offseason stays a clean no-op (nothing is in flight)", async () => {
    await seedConcludedDefaultSeason();
    await seedUpcomingSeason();

    const details = await syncNflScores(db, offseasonClock, provider, {});
    expect(details).toEqual({ skipped: true, reason: "no_active_games", activeGames: 0 });
    expect(provider.fetchCalls).toHaveLength(0);
  });
});

describe("POST /api/jobs/nfl/sync-scores", () => {
  it("rejects an invalid weekType with a 400", async () => {
    const res = await runScoresSyncJob(app, "?weekType=garbage");
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

    const res = await runScoresSyncJob(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobRunResponse;
    expect(body.status).toBe("ok");
    expect(body.details).toMatchObject({ gamesUpdated: 1, wentFinal: 0 });
  });
});
