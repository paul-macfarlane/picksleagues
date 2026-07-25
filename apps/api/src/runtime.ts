import {
  APP_ENV,
  EspnProvider,
  resolveClock,
  resolveGameDataProvider,
  type Env,
} from "@picksleagues/core";
import { createDb, getSimClockOffsetMs, getSimState } from "@picksleagues/db";
import { createAuth } from "./auth";
import type { AppDeps } from "./deps";
import { readSimFixtureSnapshot } from "./services/sim/fixtures";

/**
 * The one assembly of real dependencies, shared by both entrypoints (dev.ts's
 * Node server and vercel.ts's handler) so the two can't drift — notably in how
 * the clock and provider are resolved, which decides whether the simulator is
 * reachable at all.
 */
export function createRuntimeDeps(env: Env): AppDeps {
  const db = createDb(env.DATABASE_URL);
  const auth = createAuth({ env, db });
  // The real provider: the default source in every environment, and the only
  // one the replay importer may use (ADR-0012).
  const espnProvider = new EspnProvider();

  return {
    auth,
    db,
    env,
    espnProvider,
    clock: () => resolveClock(env.APP_ENV, () => getSimClockOffsetMs(db)),
    provider: async (clock) => {
      // Production never reads simulator state at all — the short-circuit lives
      // here as well as inside the resolver so the claim "production cannot
      // reach the simulator" is true of the query, not just the outcome.
      const activeScenarioId =
        env.APP_ENV === APP_ENV.PRODUCTION ? null : (await getSimState(db)).activeScenarioId;
      return resolveGameDataProvider({
        appEnv: env.APP_ENV,
        espn: espnProvider,
        clock,
        activeScenarioId,
        readFixtures: (scenarioId) => readSimFixtureSnapshot(db, scenarioId),
      });
    },
  };
}
