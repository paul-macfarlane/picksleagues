import { createDb, getSimClockOffsetMs, getSimState } from "@picksleagues/db";
import {
  isSimEnabled,
  resolveClock,
  resolveGameDataProvider,
  type Env,
  type GameDataProvider,
  type ProviderGame,
  type ProviderSeasonStructure,
  type ProviderTeam,
} from "@picksleagues/core";
import { WEEK_TYPE, type SimStateResponse, type WeekType } from "@picksleagues/schemas";
import { expect } from "vitest";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { readSimFixtureSnapshot } from "../../src/services/sim/fixtures";
import { createAuthenticatedUser } from "./auth-helpers";
import { providerWeek } from "./provider-fixtures";
import { getTestDatabaseUrl } from "./test-database-url";
import { makeTestEnv } from "./test-env";

export const TEST_JOB_SECRET = makeTestEnv().JOB_SECRET;

// ---------------------------------------------------------------------------
// Fake ESPN stand-in, shared by the provider-swap, clock-projection, and
// replay-importer tests. Scoped by season year (rather than the single-year
// shape nfl-sync-schedule.test.ts uses) because the replay tests must seed a
// season distinct from whatever "current" resolves to at real test-run time.
// ---------------------------------------------------------------------------

export function yearWeekKey(seasonYear: number, weekType: WeekType, weekNumber: number): string {
  return `${seasonYear}:${weekType}:${weekNumber}`;
}

export class FakeProvider implements GameDataProvider {
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
export function seedFakeEspnWeek(
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

export const db = createDb(getTestDatabaseUrl());
export const auth = createAuth({ env: makeTestEnv(), db });

/** Ends the shared pg pool — each split sim test file calls this in its own
 * `afterAll`. Vitest isolates each test file's module graph (even serialized
 * via `fileParallelism: false`), so every file importing this module gets its
 * own evaluation of `db` above and therefore its own pool — there is no
 * cross-file double-`end()` to guard against, but this stays named/exported
 * (rather than inlined per file) so that invariant lives in one place. */
export async function closeSimDb(): Promise<void> {
  await db.$client.end();
}

/**
 * Mirrors apps/api/src/runtime.ts's real wiring: a real offset-reading clock
 * (never a `FixedClock`, which would ignore any offset the tests below
 * persist via `/api/sim/clock`) and the provider resolved from whatever
 * scenario is active, exactly like production. This is what makes the
 * provider-swap and clock-projection claims (SIM-1/SIM-2) observable
 * end-to-end through the real HTTP surface rather than asserted against the
 * service functions directly.
 */
export function buildApp(
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
      // Mirrors runtime.ts's own short-circuit: with the simulator off, no
      // sim state is read at all.
      const activeScenarioId = simEnabled ? (await getSimState(db)).activeScenarioId : null;
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
export async function adminCaller(fakeEspn?: GameDataProvider) {
  const { user, cookie } = await createAuthenticatedUser(auth);
  return { app: buildApp([user.id], { fakeEspn }), cookie, userId: user.id };
}

export function withCookie(cookie?: string): Record<string, string> {
  return cookie ? { cookie } : {};
}

export function get(app: ReturnType<typeof buildApp>, path: string, cookie?: string) {
  return app.request(path, { headers: { ...withCookie(cookie) } });
}

export function postJson(
  app: ReturnType<typeof buildApp>,
  path: string,
  body: unknown,
  cookie?: string,
) {
  return app.request(path, {
    method: "POST",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...withCookie(cookie),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function patchJson(
  app: ReturnType<typeof buildApp>,
  path: string,
  body: unknown,
  cookie?: string,
) {
  return app.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify(body),
  });
}

export function runScheduleSyncJob(app: ReturnType<typeof buildApp>, query = "") {
  return app.request(`/api/jobs/nfl/sync-schedule${query}`, {
    method: "POST",
    headers: { "x-job-secret": TEST_JOB_SECRET },
  });
}

export function runScoresSyncJob(app: ReturnType<typeof buildApp>, query = "") {
  return app.request(`/api/jobs/nfl/sync-scores${query}`, {
    method: "POST",
    headers: { "x-job-secret": TEST_JOB_SECRET },
  });
}

export function runOddsSyncJob(app: ReturnType<typeof buildApp>, query = "") {
  return app.request(`/api/jobs/nfl/sync-odds${query}`, {
    method: "POST",
    headers: { "x-job-secret": TEST_JOB_SECRET },
  });
}

/** Loads a library scenario and returns its serialized `activeScenario` — the
 * id/seasonYear/startsAt every regression test below anchors its sync/clock
 * calls to. */
export async function loadLibraryScenario(
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
export function expectCloseTo(actualIso: string, expected: Date, toleranceMs = 2_000): void {
  expect(Math.abs(new Date(actualIso).getTime() - expected.getTime())).toBeLessThan(toleranceMs);
}
