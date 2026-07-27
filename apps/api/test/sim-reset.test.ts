import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  games,
  leagues,
  oddsSnapshots,
  simScenarios,
  sportSeasons,
  teams,
  users,
  weeks,
} from "@picksleagues/db";
import { nflSeasonYearFor } from "@picksleagues/core";
import { GAME_STATUS, type SimResetResponse } from "@picksleagues/schemas";
import {
  adminCaller,
  closeSimDb,
  db,
  expectCloseTo,
  FakeProvider,
  get,
  loadLibraryScenario,
  postJson,
  runOddsSyncJob,
  runScheduleSyncJob,
  runScoresSyncJob,
  seedFakeEspnWeek,
} from "./setup/sim-helpers";
import { providerGame } from "./setup/provider-fixtures";
import { insertLeague, seedSeason } from "./setup/league-helpers";
import { resetDb } from "./setup/reset-db";

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeSimDb();
});

// ---------------------------------------------------------------------------
// Reset (SIM-3)
// ---------------------------------------------------------------------------

describe("POST /api/sim/reset", () => {
  it("league scope deletes only that league's rows, leaving another league and ingested sports data intact", async () => {
    const { app, cookie } = await adminCaller();
    const { seasonId } = await seedSeason(db, {
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: new Date("2026-09-14T17:00:00.000Z") }] }],
    });
    const leagueA = await insertLeague(db, { seasonId });
    const leagueB = await insertLeague(db, { seasonId, name: "League B" });

    const res = await postJson(
      app,
      "/api/sim/reset",
      { scope: "league", leagueId: leagueA.id },
      cookie,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as SimResetResponse;
    expect(body.scope).toBe("league");
    expect(body.deleted.leagues).toBe(1);

    expect(await db.select().from(leagues).where(eq(leagues.id, leagueA.id))).toEqual([]);
    expect(await db.select().from(leagues).where(eq(leagues.id, leagueB.id))).toHaveLength(1);
    expect(await db.select().from(games)).toHaveLength(1);
    expect(await db.select().from(sportSeasons)).toHaveLength(1);
  });

  it("an unknown league 404s with league_not_found", async () => {
    const { app, cookie } = await adminCaller();

    const res = await postJson(
      app,
      "/api/sim/reset",
      { scope: "league", leagueId: "00000000-0000-4000-8000-000000000000" },
      cookie,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "league_not_found" });
  });

  it("environment scope deletes all league + ingested sports data but leaves users/sessions intact — the caller's own session still works afterward", async () => {
    const { app, cookie, userId } = await adminCaller();
    const { seasonId } = await seedSeason(db, {
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: new Date("2026-09-14T17:00:00.000Z") }] }],
    });
    await insertLeague(db, { seasonId });

    const res = await postJson(app, "/api/sim/reset", { scope: "environment" }, cookie);
    expect(res.status).toBe(200);

    expect(await db.select().from(leagues)).toEqual([]);
    expect(await db.select().from(games)).toEqual([]);
    expect(await db.select().from(sportSeasons)).toEqual([]);
    const teamRows = await db.select().from(teams);
    expect(teamRows.length).toBeGreaterThan(0);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user).toBeDefined();

    // The trap the service comments call out: prove the session itself
    // still authenticates a follow-up request.
    const follow = await get(app, "/api/sim/state", cookie);
    expect(follow.status).toBe(200);
  });

  it("environment scope with dropScenario clears the active scenario and returns the clock offset to 0", async () => {
    const { app, cookie } = await adminCaller();
    await postJson(app, "/api/sim/scenarios/mixed-week/load", undefined, cookie);
    await postJson(app, "/api/sim/clock", { kind: "advance", ms: 3_600_000 }, cookie);

    const res = await postJson(
      app,
      "/api/sim/reset",
      { scope: "environment", dropScenario: true },
      cookie,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as SimResetResponse;
    expect(body.state.activeScenario).toBeNull();
    expect(body.state.clock.offsetMs).toBe(0);
  });

  // Regression: without dropScenario, environment reset rebases the clock to
  // the active scenario's own `startsAt` (reset.ts) — otherwise the wiped
  // season re-ingests with every game already past kickoff, and sync-odds
  // only snapshots unstarted games, so the spreads ATS scoring needs would be
  // gone for good. This is the full odds-recoverability cycle the fix exists
  // for: sync, go final, reset, re-sync, and prove odds come back.
  it("environment reset without dropScenario rewinds the clock so odds are recoverable after a sync+final cycle", async () => {
    const { app, cookie } = await adminCaller();
    const scenario = await loadLibraryScenario(app, cookie);
    const scheduleQuery = `?season=${scenario.seasonYear}`;

    expect((await runScheduleSyncJob(app, scheduleQuery)).status).toBe(200);
    expect((await runOddsSyncJob(app, scheduleQuery)).status).toBe(200);
    const firstSnapshots = await db.select().from(oddsSnapshots);
    expect(firstSnapshots.length).toBeGreaterThan(0);

    const [week] = await db.select().from(weeks);
    const clockRes = await postJson(
      app,
      "/api/sim/clock",
      { kind: "week", weekId: week!.id, anchor: "after_last_game" },
      cookie,
    );
    expect(clockRes.status).toBe(200);
    expect((await runScoresSyncJob(app)).status).toBe(200);
    const finalGames = await db.select().from(games);
    expect(finalGames.length).toBeGreaterThan(0);
    for (const row of finalGames) {
      expect(row.status).toBe(GAME_STATUS.FINAL);
    }

    const resetRes = await postJson(app, "/api/sim/reset", { scope: "environment" }, cookie);
    expect(resetRes.status).toBe(200);
    const resetBody = (await resetRes.json()) as SimResetResponse;
    // The regression: before the fix, the clock was left wherever it had
    // drifted to (past every game), so this re-sync captured zero snapshots.
    expectCloseTo(resetBody.state.clock.now, new Date(scenario.startsAt));

    expect((await runScheduleSyncJob(app, scheduleQuery)).status).toBe(200);
    expect((await runOddsSyncJob(app, scheduleQuery)).status).toBe(200);
    const secondSnapshots = await db.select().from(oddsSnapshots);
    expect(secondSnapshots.length).toBeGreaterThan(0);
  });

  // Regression: `dropScenario` must delete only the loaded scenario's row —
  // an imported replay costs a full ESPN crawl, and resetting one scenario
  // must not destroy the others (reset.ts).
  it("environment reset with dropScenario deletes only the active scenario, leaving other stored scenarios intact", async () => {
    const fakeEspn = new FakeProvider();
    const pastYear = nflSeasonYearFor(new Date()) - 1;
    seedFakeEspnWeek(
      fakeEspn,
      pastYear,
      {
        weekNumber: 1,
        startsAt: `${pastYear}-09-06T00:00:00.000Z`,
        endsAt: `${pastYear}-09-13T00:00:00.000Z`,
      },
      [
        providerGame({
          providerGameId: "reset-drop-g1",
          weekNumber: 1,
          status: GAME_STATUS.FINAL,
          homeScore: 24,
          awayScore: 17,
        }),
      ],
    );
    const { app, cookie } = await adminCaller(fakeEspn);

    const replayRes = await postJson(
      app,
      "/api/sim/scenarios/replay",
      { seasonYear: pastYear },
      cookie,
    );
    expect(replayRes.status).toBe(200);
    const replaySlug = `replay-nfl-${pastYear}`;

    // Loading the library scenario makes IT the active one — the replay
    // scenario stays stored but inactive.
    await loadLibraryScenario(app, cookie);

    const res = await postJson(
      app,
      "/api/sim/reset",
      { scope: "environment", dropScenario: true },
      cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SimResetResponse;
    expect(body.deleted.sim_scenarios).toBe(1);

    const remaining = await db.select().from(simScenarios);
    expect(remaining.map((row) => row.slug)).toEqual([replaySlug]);
  });
});
