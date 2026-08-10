import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { simFixtureGames, simFixtureTeams, simScenarios } from "@picksleagues/db";
import { latestCompletedNflSeasonYear } from "@picksleagues/core";
import { isReplayableSeasonYear } from "../src/services/sim/replay";
import { GAME_STATUS, type JobRunResponse, type SimStateResponse } from "@picksleagues/schemas";
import {
  adminCaller,
  closeSimDb,
  db,
  FakeProvider,
  get,
  postJson,
  seedFakeEspnWeek,
} from "./setup/sim-helpers";
import { providerGame, providerTeam } from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeSimDb();
});

// ---------------------------------------------------------------------------
// Replay importer (SIM-6)
// ---------------------------------------------------------------------------

describe("POST /api/sim/scenarios/replay", () => {
  function seedPastSeason(fakeEspn: FakeProvider, seasonYear: number) {
    seedFakeEspnWeek(
      fakeEspn,
      seasonYear,
      {
        weekNumber: 1,
        startsAt: `${seasonYear}-09-06T00:00:00.000Z`,
        endsAt: `${seasonYear}-09-13T00:00:00.000Z`,
      },
      [
        providerGame({
          providerGameId: "replay-g1",
          weekNumber: 1,
          homeTeamAbbr: "AAA",
          homeTeamName: "Team AAA",
          homeTeamProviderId: "aaa-id",
          awayTeamAbbr: "BBB",
          awayTeamName: "Team BBB",
          awayTeamProviderId: "bbb-id",
          // Must land inside the real past — the importer derives the
          // scenario's `startsAt` from the earliest kickoff, and a loaded
          // replay's clock must sit strictly before real time.
          kickoffAt: new Date(`${seasonYear}-09-08T17:00:00.000Z`),
          status: GAME_STATUS.FINAL,
          homeScore: 27,
          awayScore: 20,
        }),
        providerGame({
          providerGameId: "replay-g2",
          weekNumber: 1,
          homeTeamAbbr: "CCC",
          homeTeamName: "Team CCC",
          homeTeamProviderId: "ccc-id",
          awayTeamAbbr: "DDD",
          awayTeamName: "Team DDD",
          awayTeamProviderId: "ddd-id",
          kickoffAt: new Date(`${seasonYear}-09-08T20:00:00.000Z`),
          status: GAME_STATUS.FINAL,
          homeScore: 14,
          awayScore: 21,
        }),
      ],
    );
  }

  it("imports a past NFL season as a replay scenario with synthesized spreads for every completed game", async () => {
    const fakeEspn = new FakeProvider();
    const pastYear = latestCompletedNflSeasonYear(new Date());
    seedPastSeason(fakeEspn, pastYear);
    // Only AAA appears in the teams listing — the other three exercise the
    // fallback the importer builds from the game row, which has no logo to
    // offer. Regression (FB-1): a replayed season's teams must carry the
    // listing's logos, or every board rendered from a replay is logo-less.
    fakeEspn.teams = [
      providerTeam({
        providerTeamId: "aaa-id",
        abbreviation: "AAA",
        name: "Team AAA",
        location: "Cityville",
        logoLightUrl: "https://logos.example/aaa-light.png",
        logoDarkUrl: "https://logos.example/aaa-dark.png",
      }),
    ];
    const { app, cookie } = await adminCaller(fakeEspn);

    const res = await postJson(app, "/api/sim/scenarios/replay", { seasonYear: pastYear }, cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as JobRunResponse;
    expect(body.status).toBe("ok");
    expect(body.details).toMatchObject({
      slug: `replay-nfl-${pastYear}`,
      seasonYear: pastYear,
      games: 2,
      spreadsSynthesized: 2,
      gamesWithoutResult: 0,
    });

    const [scenario] = await db
      .select()
      .from(simScenarios)
      .where(eq(simScenarios.slug, `replay-nfl-${pastYear}`));
    expect(scenario).toBeDefined();
    const fixtureRows = await db
      .select()
      .from(simFixtureGames)
      .where(eq(simFixtureGames.scenarioId, scenario!.id));
    expect(fixtureRows).toHaveLength(2);
    for (const fixture of fixtureRows) {
      expect(fixture.spread).not.toBeNull();
    }

    const teamRows = await db
      .select()
      .from(simFixtureTeams)
      .where(eq(simFixtureTeams.scenarioId, scenario!.id))
      .orderBy(asc(simFixtureTeams.abbreviation));
    expect(
      teamRows.map((t) => [t.abbreviation, t.location, t.logoLightUrl, t.logoDarkUrl]),
    ).toEqual([
      [
        "AAA",
        "Cityville",
        "https://logos.example/aaa-light.png",
        "https://logos.example/aaa-dark.png",
      ],
      ["BBB", "Team BBB", null, null],
      ["CCC", "Team CCC", null, null],
      ["DDD", "Team DDD", null, null],
    ]);
  });

  it("re-importing the same season is idempotent and reproducible: fixture count unchanged, spreads byte-identical", async () => {
    const fakeEspn = new FakeProvider();
    const pastYear = latestCompletedNflSeasonYear(new Date());
    seedPastSeason(fakeEspn, pastYear);
    const { app, cookie } = await adminCaller(fakeEspn);
    const slug = `replay-nfl-${pastYear}`;

    await postJson(app, "/api/sim/scenarios/replay", { seasonYear: pastYear }, cookie);
    const [firstScenario] = await db.select().from(simScenarios).where(eq(simScenarios.slug, slug));
    const firstFixtures = await db
      .select()
      .from(simFixtureGames)
      .where(eq(simFixtureGames.scenarioId, firstScenario!.id))
      .orderBy(asc(simFixtureGames.providerGameId));

    const secondRes = await postJson(
      app,
      "/api/sim/scenarios/replay",
      { seasonYear: pastYear },
      cookie,
    );
    expect(secondRes.status).toBe(200);
    const [secondScenario] = await db
      .select()
      .from(simScenarios)
      .where(eq(simScenarios.slug, slug));
    const secondFixtures = await db
      .select()
      .from(simFixtureGames)
      .where(eq(simFixtureGames.scenarioId, secondScenario!.id))
      .orderBy(asc(simFixtureGames.providerGameId));

    expect(secondScenario!.id).toBe(firstScenario!.id);
    expect(secondFixtures).toHaveLength(firstFixtures.length);
    expect(secondFixtures.map((f) => f.spread)).toEqual(firstFixtures.map((f) => f.spread));
    expect(secondFixtures.map((f) => f.providerGameId)).toEqual(
      firstFixtures.map((f) => f.providerGameId),
    );
  });

  // Regression (SIM-7): the control panel's season picker counts down from
  // `latestReplayableSeasonYear`, so if that field is ever off by one the
  // panel's *default* option is the one the guard below rejects. It was, when
  // the SPA derived candidates from the calendar year instead — an NFL season
  // runs Aug–Feb, so Jan–Jul the previous calendar year is still in progress.
  it("state's latestReplayableSeasonYear is the newest year the import guard accepts", async () => {
    const { app, cookie } = await adminCaller();

    const state = (await (await get(app, "/api/sim/state", cookie)).json()) as SimStateResponse;
    const realNow = new Date(state.clock.realNow);

    expect(isReplayableSeasonYear(realNow, state.latestReplayableSeasonYear)).toBe(true);
    expect(isReplayableSeasonYear(realNow, state.latestReplayableSeasonYear + 1)).toBe(false);
  });

  // Asking for an unfinished season is a client mistake, so it refuses as a
  // typed 400 rather than a thrown job failure — the latter would log at error
  // level and read like an ESPN outage (engineering rules §Route plumbing).
  it("a season that is not in the past is a typed 400 refusal, not a job failure", async () => {
    const { app, cookie } = await adminCaller();
    const notYetCompletedYear = latestCompletedNflSeasonYear(new Date()) + 1;

    const res = await postJson(
      app,
      "/api/sim/scenarios/replay",
      { seasonYear: notYetCompletedYear },
      cookie,
    );

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: "season_not_available",
    });
  });

  // Regression: the past-season guard must read REAL time. Loading a replay
  // parks the simulated clock inside that very season, which previously made
  // the season un-reimportable — exactly when an operator would refresh it.
  it("still allows re-import while the replayed season is loaded and the clock sits inside it", async () => {
    const fakeEspn = new FakeProvider();
    const pastYear = latestCompletedNflSeasonYear(new Date());
    seedPastSeason(fakeEspn, pastYear);
    const { app, cookie } = await adminCaller(fakeEspn);

    await postJson(app, "/api/sim/scenarios/replay", { seasonYear: pastYear }, cookie);

    // Loading parks the simulated clock inside the replayed season — this is
    // the stored-scenario load branch, and the state that used to make the
    // season look "not in the past" to its own importer.
    const loadRes = await postJson(
      app,
      `/api/sim/scenarios/replay-nfl-${pastYear}/load`,
      {},
      cookie,
    );
    expect(loadRes.status).toBe(200);
    const loaded = (await loadRes.json()) as SimStateResponse;
    expect(loaded.activeScenario?.slug).toBe(`replay-nfl-${pastYear}`);
    // Parked at the scenario's own start, well behind real time — a stored
    // scenario's fixtures keep their historical timestamps and are not shifted.
    expect(loaded.clock.now).toBe(loaded.activeScenario!.startsAt);
    expect(new Date(loaded.clock.now).getTime()).toBeLessThan(
      new Date(loaded.clock.realNow).getTime(),
    );
    expect(loaded.clock.offsetMs).toBeLessThan(0);

    const reimport = await postJson(
      app,
      "/api/sim/scenarios/replay",
      { seasonYear: pastYear },
      cookie,
    );
    expect(reimport.status).toBe(200);
    expect(((await reimport.json()) as JobRunResponse).status).toBe("ok");
  });
});
