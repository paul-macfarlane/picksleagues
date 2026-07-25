import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  games,
  getSimClockOffsetMs,
  getSimState,
  leagues,
  oddsSnapshots,
  simFixtureGames,
  simScenarios,
  sportSeasons,
  teams,
  users,
  weeks,
} from "@picksleagues/db";
import {
  isSimEnabled,
  nflSeasonYearFor,
  resolveClock,
  resolveGameDataProvider,
  SIM_GAME_DURATION_MS,
  type Env,
  type GameDataProvider,
  type ProviderGame,
  type ProviderSeasonStructure,
  type ProviderTeam,
} from "@picksleagues/core";
import {
  GAME_STATUS,
  WEEK_TYPE,
  type JobRunResponse,
  type SimFixtureGame,
  type SimFixtureGamesResponse,
  type SimResetResponse,
  type SimStateResponse,
  type WeekType,
} from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { readSimFixtureSnapshot } from "../src/services/sim/fixtures";
import { kickoffOffsetMs, WEEK_1 } from "../src/services/sim/scenarios/timing";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, seedSeason } from "./setup/league-helpers";
import { providerGame, providerWeek } from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

const TEST_JOB_SECRET = makeTestEnv().JOB_SECRET;

// ---------------------------------------------------------------------------
// Fake ESPN stand-in, shared by the provider-swap, clock-projection, and
// replay-importer tests. Scoped by season year (rather than the single-year
// shape nfl-sync-schedule.test.ts uses) because the replay tests must seed a
// season distinct from whatever "current" resolves to at real test-run time.
// ---------------------------------------------------------------------------

function yearWeekKey(seasonYear: number, weekType: WeekType, weekNumber: number): string {
  return `${seasonYear}:${weekType}:${weekNumber}`;
}

class FakeProvider implements GameDataProvider {
  structureByYear = new Map<number, ProviderSeasonStructure>();
  gamesByYearWeek = new Map<string, ProviderGame[]>();
  teams: ProviderTeam[] = [];

  async fetchNflSeasonStructure(seasonYear: number): Promise<ProviderSeasonStructure> {
    return this.structureByYear.get(seasonYear) ?? { seasonYear, weeks: [] };
  }

  async fetchNflWeekGames(
    seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    return this.gamesByYearWeek.get(yearWeekKey(seasonYear, weekType, weekNumber)) ?? [];
  }

  async fetchNflTeams(): Promise<ProviderTeam[]> {
    return this.teams;
  }
}

/** Never exercised by tests that build an app but never touch the provider. */
const UNUSED_PROVIDER = new FakeProvider();

/** Loads one season's structure + one week's games into a `FakeProvider` in one call. */
function seedFakeEspnWeek(
  provider: FakeProvider,
  seasonYear: number,
  week: { weekNumber: number; weekType?: WeekType; startsAt: string; endsAt: string },
  weekGames: ProviderGame[],
) {
  const weekType = week.weekType ?? WEEK_TYPE.REGULAR;
  const existing = provider.structureByYear.get(seasonYear) ?? { seasonYear, weeks: [] };
  provider.structureByYear.set(seasonYear, {
    seasonYear,
    weeks: [...existing.weeks, providerWeek(week.weekNumber, week.startsAt, week.endsAt, weekType)],
  });
  provider.gamesByYearWeek.set(yearWeekKey(seasonYear, weekType, week.weekNumber), weekGames);
}

// ---------------------------------------------------------------------------
// App/auth harness — mirrors admin.test.ts/admin-data.test.ts's idiom: one
// shared `db`/`auth`, a `buildApp` factory per test.
// ---------------------------------------------------------------------------

const db = createDb(getTestDatabaseUrl());
const auth = createAuth({ env: makeTestEnv(), db });

/**
 * Mirrors apps/api/src/runtime.ts's real wiring: a real offset-reading clock
 * (never a `FixedClock`, which would ignore any offset the tests below
 * persist via `/api/sim/clock`) and the provider resolved from whatever
 * scenario is active, exactly like production. This is what makes the
 * provider-swap and clock-projection claims (SIM-1/SIM-2) observable
 * end-to-end through the real HTTP surface rather than asserted against the
 * service functions directly.
 */
function buildApp(
  adminUserIds: string[] = [],
  opts: { fakeEspn?: GameDataProvider; envOverrides?: Partial<Env> } = {},
) {
  const fakeEspn = opts.fakeEspn ?? UNUSED_PROVIDER;
  const env = makeTestEnv({ ADMIN_USER_IDS: adminUserIds, ...opts.envOverrides });
  const simEnabled = isSimEnabled(env);
  return createApp({
    auth,
    db,
    env,
    espnProvider: fakeEspn,
    clock: () => resolveClock(simEnabled, () => getSimClockOffsetMs(db)),
    provider: async (clock) => {
      const { activeScenarioId } = await getSimState(db);
      return resolveGameDataProvider({
        simEnabled,
        espn: fakeEspn,
        clock,
        activeScenarioId,
        readFixtures: (scenarioId) => readSimFixtureSnapshot(db, scenarioId),
      });
    },
  });
}

/** Signs in a user, seeds them into the admin role, and returns an admin-ready app. */
async function adminCaller(fakeEspn?: GameDataProvider) {
  const { user, cookie } = await createAuthenticatedUser(auth);
  return { app: buildApp([user.id], { fakeEspn }), cookie, userId: user.id };
}

function withCookie(cookie?: string): Record<string, string> {
  return cookie ? { cookie } : {};
}

function get(app: ReturnType<typeof buildApp>, path: string, cookie?: string) {
  return app.request(path, { headers: { ...withCookie(cookie) } });
}

function postJson(app: ReturnType<typeof buildApp>, path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: "POST",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...withCookie(cookie),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function patchJson(app: ReturnType<typeof buildApp>, path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify(body),
  });
}

function runScheduleSyncJob(app: ReturnType<typeof buildApp>, query = "") {
  return app.request(`/api/jobs/nfl/sync-schedule${query}`, {
    method: "POST",
    headers: { "x-job-secret": TEST_JOB_SECRET },
  });
}

function runScoresSyncJob(app: ReturnType<typeof buildApp>, query = "") {
  return app.request(`/api/jobs/nfl/sync-scores${query}`, {
    method: "POST",
    headers: { "x-job-secret": TEST_JOB_SECRET },
  });
}

function runOddsSyncJob(app: ReturnType<typeof buildApp>, query = "") {
  return app.request(`/api/jobs/nfl/sync-odds${query}`, {
    method: "POST",
    headers: { "x-job-secret": TEST_JOB_SECRET },
  });
}

/** Loads a library scenario and returns its serialized `activeScenario` — the
 * id/seasonYear/startsAt every regression test below anchors its sync/clock
 * calls to. */
async function loadLibraryScenario(
  app: ReturnType<typeof buildApp>,
  cookie: string,
  slug = "mixed-week",
) {
  const res = await postJson(app, `/api/sim/scenarios/${slug}/load`, undefined, cookie);
  const body = (await res.json()) as SimStateResponse;
  if (!body.activeScenario) {
    throw new Error(`loadLibraryScenario: ${slug} did not become active`);
  }
  return body.activeScenario;
}

/**
 * `POST /api/sim/clock`'s own response reflects the offset from BEFORE the
 * request (documented: "in force from the next request onward" — the
 * middleware resolves the clock once, ahead of the handler's write), so every
 * assertion here goes through a follow-up `GET /api/sim/state`. That request
 * resolves a fresh clock off real wall time, so even an algebraically exact
 * target instant lands a few milliseconds off — a tight tolerance, not
 * asserting simulated time loosely.
 */
function expectCloseTo(actualIso: string, expected: Date, toleranceMs = 2_000): void {
  expect(Math.abs(new Date(actualIso).getTime() - expected.getTime())).toBeLessThan(toleranceMs);
}

// ---------------------------------------------------------------------------
// Directly-seeded week+games for the clock-anchor tests (SIM-2) — these
// exercise `resolveWeekAnchorInstant` against our own ingested rows, never a
// scenario, so they stay independent of the fixture/provider machinery.
// ---------------------------------------------------------------------------

const ANCHOR_WEEK_START = new Date("2026-09-08T00:00:00.000Z");
const ANCHOR_WEEK_END = new Date("2026-09-15T00:00:00.000Z");
const ANCHOR_GAME1_KICKOFF = new Date("2026-09-14T17:00:00.000Z");
const ANCHOR_GAME2_KICKOFF = new Date("2026-09-14T20:00:00.000Z");

/** Only `week.id` is ever read by callers — narrowed to that. */
async function seedAnchorWeek(
  opts: { game1OverrideKickoffAt?: Date; game2OverrideKickoffAt?: Date } = {},
): Promise<{ week: string }> {
  const { weekIds } = await seedSeason(db, {
    year: 2026,
    weeks: [
      {
        weekNumber: 1,
        startsAt: ANCHOR_WEEK_START,
        endsAt: ANCHOR_WEEK_END,
        kickoffs: [
          { kickoffAt: ANCHOR_GAME1_KICKOFF, overrideKickoffAt: opts.game1OverrideKickoffAt },
          { kickoffAt: ANCHOR_GAME2_KICKOFF, overrideKickoffAt: opts.game2OverrideKickoffAt },
        ],
      },
    ],
  });
  return { week: weekIds.get(`${WEEK_TYPE.REGULAR}:1`)! };
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

// ---------------------------------------------------------------------------
// Route gating (ADR-0011): session + admin role on every route, and
// non-registration in production.
// ---------------------------------------------------------------------------

const SIM_ROUTE_CASES: { method: string; path: string; body?: unknown }[] = [
  { method: "GET", path: "/api/sim/state" },
  { method: "POST", path: "/api/sim/clock", body: { kind: "reset" } },
  { method: "POST", path: "/api/sim/scenarios/mixed-week/load" },
  { method: "POST", path: "/api/sim/scenarios/replay", body: { seasonYear: 2020 } },
  {
    method: "GET",
    path: "/api/sim/fixtures/games?scenarioId=00000000-0000-4000-8000-000000000000",
  },
  {
    method: "PATCH",
    path: "/api/sim/fixtures/games/00000000-0000-4000-8000-000000000000",
    body: { spread: 1 },
  },
  { method: "POST", path: "/api/sim/reset", body: { scope: "environment" } },
];

function requestRoute(
  app: ReturnType<typeof buildApp>,
  route: { method: string; path: string; body?: unknown },
  cookie?: string,
) {
  return app.request(route.path, {
    method: route.method,
    headers: {
      ...(route.body !== undefined ? { "content-type": "application/json" } : {}),
      ...withCookie(cookie),
    },
    body: route.body !== undefined ? JSON.stringify(route.body) : undefined,
  });
}

describe("sim route gating", () => {
  it.each(SIM_ROUTE_CASES)("401s with no session cookie: $method $path", async (route) => {
    const app = buildApp();

    const res = await requestRoute(app, route);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it.each(SIM_ROUTE_CASES)(
    "403s for a signed-in non-admin caller: $method $path",
    async (route) => {
      const { cookie } = await createAuthenticatedUser(auth);
      const app = buildApp();

      const res = await requestRoute(app, route, cookie);

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "not_admin" });
    },
  );

  it("production: sim routes are not registered at all — GET /api/sim/state 404s even for an admin (ADR-0011)", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    const app = buildApp([user.id], { envOverrides: { APP_ENV: "production" } });

    const res = await get(app, "/api/sim/state", cookie);

    expect(res.status).toBe(404);
  });

  it("SIM_ENABLED=false in a non-prod env: sim routes are not registered — GET /api/sim/state 404s for an admin", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    const app = buildApp([user.id], {
      envOverrides: { APP_ENV: "local", SIM_ENABLED: false },
    });

    const res = await get(app, "/api/sim/state", cookie);

    expect(res.status).toBe(404);
  });

  it("production overrides SIM_ENABLED=true: sim routes stay unregistered — GET /api/sim/state 404s for an admin", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    const app = buildApp([user.id], {
      envOverrides: { APP_ENV: "production", SIM_ENABLED: true },
    });

    const res = await get(app, "/api/sim/state", cookie);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Clock (SIM-2): POST /api/sim/clock
// ---------------------------------------------------------------------------

describe("POST /api/sim/clock", () => {
  it("instant sets the offset so a subsequent GET /api/sim/state reports now equal to that instant", async () => {
    const { app, cookie } = await adminCaller();
    const target = new Date("2031-03-15T12:00:00.000Z");

    const setRes = await postJson(
      app,
      "/api/sim/clock",
      { kind: "instant", instant: target.toISOString() },
      cookie,
    );
    expect(setRes.status).toBe(200);

    const stateRes = await get(app, "/api/sim/state", cookie);
    const body = (await stateRes.json()) as SimStateResponse;
    expect(Math.abs(new Date(body.clock.now).getTime() - target.getTime())).toBeLessThan(5_000);
  });

  it.each([
    { label: "positive ms advances now forward", ms: 3_600_000 },
    { label: "negative ms shifts now backward", ms: -3_600_000 },
  ])("$label", async ({ ms }) => {
    const { app, cookie } = await adminCaller();
    const baselineRes = await get(app, "/api/sim/state", cookie);
    const baselineNow = new Date(
      ((await baselineRes.json()) as SimStateResponse).clock.now,
    ).getTime();

    const res = await postJson(app, "/api/sim/clock", { kind: "advance", ms }, cookie);
    expect(res.status).toBe(200);

    const afterRes = await get(app, "/api/sim/state", cookie);
    const afterNow = new Date(((await afterRes.json()) as SimStateResponse).clock.now).getTime();
    expect(Math.abs(afterNow - baselineNow - ms)).toBeLessThan(5_000);
  });

  // Regression guard: the handler's own `Clock` was resolved from the offset in
  // force BEFORE the write, so a response that derived `now` from it would
  // report a `now`/`realNow`/`offsetMs` triple that contradicts itself. The
  // POST body must describe the clock it just wrote, not the one it arrived
  // with, and must agree with what the next request reads back.
  it.each([
    { label: "advance", body: { kind: "advance", ms: 7_200_000 } },
    { label: "instant", body: { kind: "instant", instant: "2027-01-15T18:30:00.000Z" } },
    { label: "reset", body: { kind: "reset" } },
  ])("POST /sim/clock returns a self-consistent clock for $label", async ({ body }) => {
    const { app, cookie } = await adminCaller();

    const res = await postJson(app, "/api/sim/clock", body, cookie);
    expect(res.status).toBe(200);
    const posted = ((await res.json()) as SimStateResponse).clock;

    // now === realNow + offsetMs, exactly — these are derived, not sampled.
    expect(new Date(posted.now).getTime()).toBe(
      new Date(posted.realNow).getTime() + posted.offsetMs,
    );

    const readBack = ((await (await get(app, "/api/sim/state", cookie)).json()) as SimStateResponse)
      .clock;
    expect(readBack.offsetMs).toBe(posted.offsetMs);
    expectCloseTo(readBack.now, new Date(posted.now));
  });

  it("reset returns offsetMs to 0 and now back to approximately real time", async () => {
    const { app, cookie } = await adminCaller();
    await postJson(app, "/api/sim/clock", { kind: "advance", ms: 3_600_000 }, cookie);

    const before = Date.now();
    const res = await postJson(app, "/api/sim/clock", { kind: "reset" }, cookie);
    expect(res.status).toBe(200);

    const stateRes = await get(app, "/api/sim/state", cookie);
    const body = (await stateRes.json()) as SimStateResponse;
    expect(body.clock.offsetMs).toBe(0);
    expect(Math.abs(new Date(body.clock.now).getTime() - before)).toBeLessThan(5_000);
  });

  describe("week anchors", () => {
    it("week_start lands exactly on the week's startsAt", async () => {
      const { app, cookie } = await adminCaller();
      const { week } = await seedAnchorWeek();

      const res = await postJson(
        app,
        "/api/sim/clock",
        { kind: "week", weekId: week, anchor: "week_start" },
        cookie,
      );
      expect(res.status).toBe(200);

      const stateRes = await get(app, "/api/sim/state", cookie);
      const body = (await stateRes.json()) as SimStateResponse;
      expectCloseTo(body.clock.now, ANCHOR_WEEK_START);
    });

    it("before_first_kickoff lands strictly before the earliest effective kickoff", async () => {
      const { app, cookie } = await adminCaller();
      const { week } = await seedAnchorWeek();

      const res = await postJson(
        app,
        "/api/sim/clock",
        { kind: "week", weekId: week, anchor: "before_first_kickoff" },
        cookie,
      );
      expect(res.status).toBe(200);

      const stateRes = await get(app, "/api/sim/state", cookie);
      const body = (await stateRes.json()) as SimStateResponse;
      expect(new Date(body.clock.now).getTime()).toBeLessThan(ANCHOR_GAME1_KICKOFF.getTime());
    });

    it("after_last_game lands past the last kickoff's game window — every game in the week would project to final", async () => {
      const { app, cookie } = await adminCaller();
      const { week } = await seedAnchorWeek();

      const res = await postJson(
        app,
        "/api/sim/clock",
        { kind: "week", weekId: week, anchor: "after_last_game" },
        cookie,
      );
      expect(res.status).toBe(200);

      const stateRes = await get(app, "/api/sim/state", cookie);
      const body = (await stateRes.json()) as SimStateResponse;
      const nowMs = new Date(body.clock.now).getTime();

      // Matches projectFixtureGame's own boundary rule (`nowMs < kickoffMs +
      // SIM_GAME_DURATION_MS` => in_progress, else final) — landing at or past
      // this instant for every game's kickoff is exactly what "projects to
      // final" means.
      for (const kickoff of [ANCHOR_GAME1_KICKOFF, ANCHOR_GAME2_KICKOFF]) {
        expect(nowMs).toBeGreaterThanOrEqual(kickoff.getTime() + SIM_GAME_DURATION_MS);
      }
    });

    // Regression: `resolveWeekAnchorInstant` takes `least`/`greatest` of the
    // provider and override kickoff per game, not the effective kickoff alone
    // (clock.ts). An override that pulls the LAST game's kickoff earlier must
    // not drag `after_last_game` in front of that game's real (provider)
    // window — the anchor is conservative, never after a game that hasn't
    // actually finished.
    it("after_last_game does not move earlier when the last game's kickoff is overridden earlier", async () => {
      const { app, cookie } = await adminCaller();
      const overriddenEarlier = new Date(ANCHOR_GAME2_KICKOFF.getTime() - 12 * 60 * 60 * 1000);
      const { week } = await seedAnchorWeek({ game2OverrideKickoffAt: overriddenEarlier });

      const res = await postJson(
        app,
        "/api/sim/clock",
        { kind: "week", weekId: week, anchor: "after_last_game" },
        cookie,
      );
      expect(res.status).toBe(200);

      const stateRes = await get(app, "/api/sim/state", cookie);
      const body = (await stateRes.json()) as SimStateResponse;
      const nowMs = new Date(body.clock.now).getTime();

      expect(nowMs).toBeGreaterThanOrEqual(ANCHOR_GAME2_KICKOFF.getTime() + SIM_GAME_DURATION_MS);
    });

    // Symmetric regression: an override that pushes the FIRST game's kickoff
    // LATER must not drag `before_first_kickoff` past that game's real
    // (provider) kickoff — landing there would already show the game locked.
    it("before_first_kickoff does not move later when the first game's kickoff is overridden later", async () => {
      const { app, cookie } = await adminCaller();
      const overriddenLater = new Date(ANCHOR_GAME1_KICKOFF.getTime() + 12 * 60 * 60 * 1000);
      const { week } = await seedAnchorWeek({ game1OverrideKickoffAt: overriddenLater });

      const res = await postJson(
        app,
        "/api/sim/clock",
        { kind: "week", weekId: week, anchor: "before_first_kickoff" },
        cookie,
      );
      expect(res.status).toBe(200);

      const stateRes = await get(app, "/api/sim/state", cookie);
      const body = (await stateRes.json()) as SimStateResponse;
      const nowMs = new Date(body.clock.now).getTime();

      expect(nowMs).toBeLessThan(ANCHOR_GAME1_KICKOFF.getTime());
    });
  });

  it("an unknown weekId 404s with week_not_found", async () => {
    const { app, cookie } = await adminCaller();

    const res = await postJson(
      app,
      "/api/sim/clock",
      { kind: "week", weekId: "00000000-0000-4000-8000-000000000000", anchor: "week_start" },
      cookie,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "week_not_found" });
  });

  it("a real week with zero games 404s with week_has_no_games for before_first_kickoff, but week_start still succeeds", async () => {
    const { app, cookie } = await adminCaller();
    const { weekIds } = await seedSeason(db, {
      year: 2026,
      weeks: [
        {
          weekNumber: 2,
          startsAt: ANCHOR_WEEK_END,
          endsAt: new Date(ANCHOR_WEEK_END.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      ],
    });
    const emptyWeekId = weekIds.get(`${WEEK_TYPE.REGULAR}:2`)!;

    const noGamesRes = await postJson(
      app,
      "/api/sim/clock",
      { kind: "week", weekId: emptyWeekId, anchor: "before_first_kickoff" },
      cookie,
    );
    expect(noGamesRes.status).toBe(404);
    expect(await noGamesRes.json()).toMatchObject({ error: "week_has_no_games" });

    const startRes = await postJson(
      app,
      "/api/sim/clock",
      { kind: "week", weekId: emptyWeekId, anchor: "week_start" },
      cookie,
    );
    expect(startRes.status).toBe(200);
    const stateRes = await get(app, "/api/sim/state", cookie);
    const body = (await stateRes.json()) as SimStateResponse;
    expectCloseTo(body.clock.now, ANCHOR_WEEK_END);
  });

  it("before_first_kickoff reads the effective (override) kickoff, not the provider kickoff (arch D15)", async () => {
    const { app, cookie } = await adminCaller();
    // Game 2's provider kickoff (20:00) is naturally later than game 1's
    // (17:00); overriding it 4 hours earlier than game 1 flips which game is
    // effectively first — a naive read of the provider `kickoff_at` column
    // would still anchor near game 1's 17:00.
    const overriddenEarlier = new Date(ANCHOR_GAME1_KICKOFF.getTime() - 4 * 60 * 60 * 1000);
    const { week } = await seedAnchorWeek({ game2OverrideKickoffAt: overriddenEarlier });

    const res = await postJson(
      app,
      "/api/sim/clock",
      { kind: "week", weekId: week, anchor: "before_first_kickoff" },
      cookie,
    );
    expect(res.status).toBe(200);

    const stateRes = await get(app, "/api/sim/state", cookie);
    const body = (await stateRes.json()) as SimStateResponse;
    const nowMs = new Date(body.clock.now).getTime();

    expect(overriddenEarlier.getTime() - nowMs).toBeLessThan(10 * 60 * 1000);
    expect(ANCHOR_GAME1_KICKOFF.getTime() - nowMs).toBeGreaterThan(60 * 60 * 1000);
  });
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
    const pastYear = nflSeasonYearFor(new Date()) - 1;
    seedPastSeason(fakeEspn, pastYear);
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
  });

  it("re-importing the same season is idempotent and reproducible: fixture count unchanged, spreads byte-identical", async () => {
    const fakeEspn = new FakeProvider();
    const pastYear = nflSeasonYearFor(new Date()) - 1;
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

  // Asking for an unfinished season is a client mistake, so it refuses as a
  // typed 400 rather than a thrown job failure — the latter would log at error
  // level and read like an ESPN outage (engineering rules §Route plumbing).
  it("a season that is not in the past is a typed 400 refusal, not a job failure", async () => {
    const { app, cookie } = await adminCaller();
    const currentYear = nflSeasonYearFor(new Date());

    const res = await postJson(
      app,
      "/api/sim/scenarios/replay",
      { seasonYear: currentYear },
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
    const pastYear = nflSeasonYearFor(new Date()) - 1;
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
