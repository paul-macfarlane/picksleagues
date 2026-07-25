import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { games, simFixtureGames, weeks } from "@picksleagues/db";
import { SIM_GAME_DURATION_MS } from "@picksleagues/core";
import { GAME_STATUS, type JobRunResponse, type SimStateResponse } from "@picksleagues/schemas";
import {
  adminCaller,
  closeSimDb,
  db,
  expectCloseTo,
  FakeProvider,
  loadLibraryScenario,
  postJson,
  runScheduleSyncJob,
  runScoresSyncJob,
  seedFakeEspnWeek,
} from "./setup/sim-helpers";
import { providerGame } from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { kickoffOffsetMs, WEEK_1 } from "../src/services/sim/scenarios/timing";

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeSimDb();
});

// ---------------------------------------------------------------------------
// Scenario load + provider swap (SIM-1/SIM-3)
// ---------------------------------------------------------------------------

describe("POST /api/sim/scenarios/{slug}/load", () => {
  it("loads a library scenario: writes fixtures, sets it active, positions the clock at its startsAt", async () => {
    const { app, cookie } = await adminCaller();

    const res = await postJson(app, "/api/sim/scenarios/mixed-week/load", undefined, cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SimStateResponse;
    expect(body.activeScenario).toMatchObject({ slug: "mixed-week", gameCount: 4 });
    // Same request, but `clock.now()` is re-read a second time after the
    // offset write (readSimState re-derives `now` from the same clock
    // instance) — a couple of milliseconds later than `startsAt` itself.
    expectCloseTo(body.clock.now, new Date(body.activeScenario!.startsAt));

    const fixtureRows = await db
      .select()
      .from(simFixtureGames)
      .where(eq(simFixtureGames.scenarioId, body.activeScenario!.id));
    expect(fixtureRows).toHaveLength(4);
  });

  it("loading the same slug twice is idempotent: the scenario keeps its id and the fixture count doesn't double", async () => {
    const { app, cookie } = await adminCaller();

    const first = await postJson(app, "/api/sim/scenarios/mixed-week/load", undefined, cookie);
    const firstBody = (await first.json()) as SimStateResponse;

    const second = await postJson(app, "/api/sim/scenarios/mixed-week/load", undefined, cookie);
    const secondBody = (await second.json()) as SimStateResponse;

    expect(secondBody.activeScenario!.id).toBe(firstBody.activeScenario!.id);
    expect(secondBody.activeScenario!.gameCount).toBe(firstBody.activeScenario!.gameCount);
    const fixtureRows = await db
      .select()
      .from(simFixtureGames)
      .where(eq(simFixtureGames.scenarioId, firstBody.activeScenario!.id));
    expect(fixtureRows).toHaveLength(4);
  });

  it("an unknown slug 404s with scenario_not_found", async () => {
    const { app, cookie } = await adminCaller();

    const res = await postJson(
      app,
      "/api/sim/scenarios/not-a-real-scenario/load",
      undefined,
      cookie,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "scenario_not_found" });
  });

  it("the provider actually swaps: schedule sync ingests ESPN by default, and the loaded scenario's games once one is active", async () => {
    const fakeEspn = new FakeProvider();
    const espnSeasonYear = 2001;
    seedFakeEspnWeek(
      fakeEspn,
      espnSeasonYear,
      { weekNumber: 1, startsAt: "2001-09-06T00:00:00.000Z", endsAt: "2001-09-13T00:00:00.000Z" },
      [providerGame({ providerGameId: "espn-game-1", weekNumber: 1 })],
    );
    const { app, cookie } = await adminCaller(fakeEspn);

    // No scenario loaded — the default source is ESPN (arch §Environments).
    const espnRun = await runScheduleSyncJob(app, `?season=${espnSeasonYear}`);
    expect(espnRun.status).toBe(200);
    const afterEspn = await db.select({ id: games.providerGameId }).from(games);
    expect(afterEspn.map((row) => row.id)).toEqual(["espn-game-1"]);

    // Loading a scenario swaps the data source for the SAME sync job.
    const loadRes = await postJson(app, "/api/sim/scenarios/mixed-week/load", undefined, cookie);
    const loadBody = (await loadRes.json()) as SimStateResponse;
    const scenarioSeasonYear = loadBody.activeScenario!.seasonYear;

    const scenarioRun = await runScheduleSyncJob(app, `?season=${scenarioSeasonYear}`);
    expect(scenarioRun.status).toBe(200);
    const afterScenario = (await db.select({ id: games.providerGameId }).from(games)).map(
      (row) => row.id,
    );
    expect(afterScenario).toEqual(
      expect.arrayContaining(["mixed-week-1", "mixed-week-2", "mixed-week-3", "mixed-week-4"]),
    );
    // The earlier ESPN-sourced row is untouched — proves this was a swap of
    // the *source*, not a wipe-and-reload.
    expect(afterScenario).toContain("espn-game-1");
  });

  it("clock-projected ingestion: scheduled+null before kickoff, final+scores after the game window (ADR-0012)", async () => {
    const { app, cookie } = await adminCaller();

    const loadRes = await postJson(app, "/api/sim/scenarios/mixed-week/load", undefined, cookie);
    const loadBody = (await loadRes.json()) as SimStateResponse;
    const scenarioSeasonYear = loadBody.activeScenario!.seasonYear;

    // The clock is positioned at the scenario's startsAt on load — before
    // every declared kickoff (timing.ts's offsets are all positive).
    const beforeRun = await runScheduleSyncJob(app, `?season=${scenarioSeasonYear}`);
    expect(beforeRun.status).toBe(200);

    const scheduledRows = await db.select().from(games);
    expect(scheduledRows).toHaveLength(4);
    for (const row of scheduledRows) {
      expect(row.status).toBe(GAME_STATUS.SCHEDULED);
      expect(row.homeScore).toBeNull();
      expect(row.awayScore).toBeNull();
    }

    const [week] = await db.select().from(weeks);
    const clockRes = await postJson(
      app,
      "/api/sim/clock",
      { kind: "week", weekId: week!.id, anchor: "after_last_game" },
      cookie,
    );
    expect(clockRes.status).toBe(200);

    const scoresRun = await runScoresSyncJob(app);
    expect(scoresRun.status).toBe(200);
    expect(((await scoresRun.json()) as JobRunResponse).status).toBe("ok");

    const finalRows = await db.select().from(games);
    const expectedScores: Record<string, [number, number]> = {
      "mixed-week-1": [27, 17],
      "mixed-week-2": [20, 24],
      "mixed-week-3": [24, 20],
      "mixed-week-4": [30, 13],
    };
    expect(finalRows).toHaveLength(4);
    for (const row of finalRows) {
      expect(row.status).toBe(GAME_STATUS.FINAL);
      const [home, away] = expectedScores[row.providerGameId]!;
      expect(row.homeScore).toBe(home);
      expect(row.awayScore).toBe(away);
    }
  });

  // The riskiest of the three projected states (scheduled/in_progress/final)
  // was previously only unit-tested against `projectFixtureGame` directly —
  // this proves it actually reaches the ingested `games` row through the real
  // schedule sync, the same path scheduled/final are already covered through above.
  it("clock-projected ingestion: in_progress mid-game reaches the ingested games row", async () => {
    const { app, cookie } = await adminCaller();
    const scenario = await loadLibraryScenario(app, cookie);
    const anchor = new Date(scenario.startsAt);

    const firstKickoff = new Date(anchor.getTime() + kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 0));
    const midGame = new Date(firstKickoff.getTime() + SIM_GAME_DURATION_MS / 2);
    const clockRes = await postJson(
      app,
      "/api/sim/clock",
      { kind: "instant", instant: midGame.toISOString() },
      cookie,
    );
    expect(clockRes.status).toBe(200);

    const syncRes = await runScheduleSyncJob(app, `?season=${scenario.seasonYear}`);
    expect(syncRes.status).toBe(200);

    const [row] = await db.select().from(games).where(eq(games.providerGameId, "mixed-week-1"));
    expect(row?.status).toBe(GAME_STATUS.IN_PROGRESS);
    expect(row?.homeScore).toBe(0);
    expect(row?.awayScore).toBe(0);
  });
});
