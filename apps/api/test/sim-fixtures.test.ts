import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { games, simFixtureGames, weeks } from "@picksleagues/db";
import { SIM_GAME_DURATION_MS } from "@picksleagues/core";
import {
  GAME_STATUS,
  type SimFixtureGame,
  type SimFixtureGamesResponse,
  type SimStateResponse,
} from "@picksleagues/schemas";
import {
  adminCaller,
  buildApp,
  closeSimDb,
  db,
  get,
  loadLibraryScenario,
  patchJson,
  postJson,
  runScheduleSyncJob,
} from "./setup/sim-helpers";
import { resetDb } from "./setup/reset-db";
import { kickoffOffsetMs, WEEK_1 } from "../src/services/sim/scenarios/timing";

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeSimDb();
});

// ---------------------------------------------------------------------------
// Fixtures (SIM-3)
// ---------------------------------------------------------------------------

describe("GET /api/sim/fixtures/games", () => {
  it("lists a scenario's fixtures ordered by kickoff and filters by weekType/weekNumber", async () => {
    const { app, cookie } = await adminCaller();
    const loadRes = await postJson(app, "/api/sim/scenarios/week-move/load", undefined, cookie);
    const loadBody = (await loadRes.json()) as SimStateResponse;
    const scenarioId = loadBody.activeScenario!.id;

    const allRes = await get(app, `/api/sim/fixtures/games?scenarioId=${scenarioId}`, cookie);
    expect(allRes.status).toBe(200);
    const all = (await allRes.json()) as SimFixtureGamesResponse;
    // week-move-3 is declared week 2 but kicks off before week-move-2 — order
    // is by kickoff, not by declared week.
    expect(all.games.map((g) => g.providerGameId)).toEqual([
      "week-move-1",
      "week-move-3",
      "week-move-2",
    ]);

    const week2Res = await get(
      app,
      `/api/sim/fixtures/games?scenarioId=${scenarioId}&weekNumber=2`,
      cookie,
    );
    const week2 = (await week2Res.json()) as SimFixtureGamesResponse;
    expect(week2.games.map((g) => g.providerGameId)).toEqual(["week-move-3", "week-move-2"]);

    const postseasonRes = await get(
      app,
      `/api/sim/fixtures/games?scenarioId=${scenarioId}&weekType=postseason`,
      cookie,
    );
    const postseason = (await postseasonRes.json()) as SimFixtureGamesResponse;
    expect(postseason.games).toEqual([]);
  });

  it("projects scheduled before kickoff and final (with scores) after the game window", async () => {
    const { app, cookie } = await adminCaller();
    const loadRes = await postJson(app, "/api/sim/scenarios/mixed-week/load", undefined, cookie);
    const loadBody = (await loadRes.json()) as SimStateResponse;
    const scenarioId = loadBody.activeScenario!.id;
    const anchor = new Date(loadBody.activeScenario!.startsAt);

    const beforeRes = await get(app, `/api/sim/fixtures/games?scenarioId=${scenarioId}`, cookie);
    const before = (await beforeRes.json()) as SimFixtureGamesResponse;
    expect(before.games).toHaveLength(4);
    for (const fixture of before.games) {
      expect(fixture.projectedStatus).toBe("scheduled");
      expect(fixture.projectedHomeScore).toBeNull();
      expect(fixture.projectedAwayScore).toBeNull();
    }

    // Past the latest declared game's window (index 3 of 4, per timing.ts's
    // per-game 4-hour stagger).
    const lastKickoff = new Date(anchor.getTime() + kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 3));
    const pastEverything = new Date(lastKickoff.getTime() + SIM_GAME_DURATION_MS + 60_000);
    await postJson(
      app,
      "/api/sim/clock",
      { kind: "instant", instant: pastEverything.toISOString() },
      cookie,
    );

    const afterRes = await get(app, `/api/sim/fixtures/games?scenarioId=${scenarioId}`, cookie);
    const after = (await afterRes.json()) as SimFixtureGamesResponse;
    expect(after.games).toHaveLength(4);
    for (const fixture of after.games) {
      expect(fixture.projectedStatus).toBe("final");
      expect(fixture.projectedHomeScore).toBe(fixture.finalHomeScore);
      expect(fixture.projectedAwayScore).toBe(fixture.finalAwayScore);
    }
  });
});

describe("PATCH /api/sim/fixtures/games/{gameId}", () => {
  async function loadedFixtures(app: ReturnType<typeof buildApp>, cookie: string) {
    const loadRes = await postJson(app, "/api/sim/scenarios/mixed-week/load", undefined, cookie);
    const loadBody = (await loadRes.json()) as SimStateResponse;
    const listRes = await get(
      app,
      `/api/sim/fixtures/games?scenarioId=${loadBody.activeScenario!.id}`,
      cookie,
    );
    return ((await listRes.json()) as SimFixtureGamesResponse).games;
  }

  it("updates kickoff/spread/finalStatus/scores and returns the updated row", async () => {
    const { app, cookie } = await adminCaller();
    const fixtures = await loadedFixtures(app, cookie);
    const target = fixtures[0]!;
    const newKickoff = new Date(new Date(target.kickoffAt).getTime() + 3_600_000).toISOString();

    const res = await patchJson(
      app,
      `/api/sim/fixtures/games/${target.id}`,
      {
        kickoffAt: newKickoff,
        spread: 4.5,
        finalStatus: "cancelled",
        finalHomeScore: null,
        finalAwayScore: null,
      },
      cookie,
    );

    expect(res.status).toBe(200);
    const updated = (await res.json()) as SimFixtureGame;
    expect(updated).toMatchObject({
      id: target.id,
      kickoffAt: newKickoff,
      spread: 4.5,
      finalStatus: "cancelled",
      finalHomeScore: null,
      finalAwayScore: null,
      projectedStatus: "cancelled",
    });
  });

  it("an unknown fixture id 404s with fixture_not_found", async () => {
    const { app, cookie } = await adminCaller();

    const res = await patchJson(
      app,
      "/api/sim/fixtures/games/00000000-0000-4000-8000-000000000000",
      { spread: 1 },
      cookie,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "fixture_not_found" });
  });

  it("an empty body 400s", async () => {
    const { app, cookie } = await adminCaller();
    const fixtures = await loadedFixtures(app, cookie);

    const res = await patchJson(app, `/api/sim/fixtures/games/${fixtures[0]!.id}`, {}, cookie);

    expect(res.status).toBe(400);
  });

  // Regression: updateFixtureGame judges coherence on the field values as
  // MERGED with the existing stored row, not the patch body in isolation — a
  // caller can null one score while `finalStatus` stays `final` in the stored
  // row and never appears in the request at all (fixtures.ts).
  describe("refuses a fixture that would end up final with a missing score", () => {
    it.each([
      {
        label: "nulling one score while finalStatus stays final in the stored row",
        patch: { finalHomeScore: null },
      },
      {
        label: "explicitly setting finalStatus final with both scores null",
        patch: { finalStatus: "final" as const, finalHomeScore: null, finalAwayScore: null },
      },
    ])("$label", async ({ patch }) => {
      const { app, cookie } = await adminCaller();
      const fixtures = await loadedFixtures(app, cookie);
      const target = fixtures[0]!;
      expect(target).toMatchObject({
        finalStatus: "final",
        finalHomeScore: 27,
        finalAwayScore: 17,
      });

      const res = await patchJson(app, `/api/sim/fixtures/games/${target.id}`, patch, cookie);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "validation" });

      const [stored] = await db
        .select()
        .from(simFixtureGames)
        .where(eq(simFixtureGames.id, target.id));
      expect(stored).toMatchObject({
        finalStatus: "final",
        finalHomeScore: 27,
        finalAwayScore: 17,
      });
    });
  });

  it("the legitimate path still works: clear the status first, then set final with both scores", async () => {
    const { app, cookie } = await adminCaller();
    const fixtures = await loadedFixtures(app, cookie);
    const target = fixtures[0]!;

    const clearRes = await patchJson(
      app,
      `/api/sim/fixtures/games/${target.id}`,
      { finalStatus: "cancelled", finalHomeScore: null, finalAwayScore: null },
      cookie,
    );
    expect(clearRes.status).toBe(200);

    const refinalizeRes = await patchJson(
      app,
      `/api/sim/fixtures/games/${target.id}`,
      { finalStatus: "final", finalHomeScore: 21, finalAwayScore: 17 },
      cookie,
    );
    expect(refinalizeRes.status).toBe(200);
    const updated = (await refinalizeRes.json()) as SimFixtureGame;
    expect(updated).toMatchObject({ finalStatus: "final", finalHomeScore: 21, finalAwayScore: 17 });
  });

  // End-to-end proof of the invariant the guard protects: a refused edit must
  // never let ingestion (ingest-season.ts) write a `games` row at status
  // `final` with a null score — the one state settlement can't defend against.
  it("a refused edit never lets a final+null-score row reach the ingested games table", async () => {
    const { app, cookie } = await adminCaller();
    const scenario = await loadLibraryScenario(app, cookie);
    const fixturesRes = await get(app, `/api/sim/fixtures/games?scenarioId=${scenario.id}`, cookie);
    const fixtures = ((await fixturesRes.json()) as SimFixtureGamesResponse).games;
    const target = fixtures[0]!;

    const refusedRes = await patchJson(
      app,
      `/api/sim/fixtures/games/${target.id}`,
      { finalHomeScore: null },
      cookie,
    );
    expect(refusedRes.status).toBe(400);

    // Ingest once (scheduled), then jump past every kickoff and ingest again —
    // the same sequence "clock-projected ingestion" exercises for the happy
    // path, here proving the refused edit above left nothing exploitable.
    expect((await runScheduleSyncJob(app, `?season=${scenario.seasonYear}`)).status).toBe(200);
    const [week] = await db.select().from(weeks);
    const clockRes = await postJson(
      app,
      "/api/sim/clock",
      { kind: "week", weekId: week!.id, anchor: "after_last_game" },
      cookie,
    );
    expect(clockRes.status).toBe(200);
    expect((await runScheduleSyncJob(app, `?season=${scenario.seasonYear}`)).status).toBe(200);

    const rows = await db.select().from(games);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.status === GAME_STATUS.FINAL && (row.homeScore === null || row.awayScore === null),
      ).toBe(false);
    }
  });
});
