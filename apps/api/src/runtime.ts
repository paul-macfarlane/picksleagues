import {
  EspnProvider,
  isSimEnabled,
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
  // Resolved once here so the clock, the provider, and (via app.ts) the sim
  // routes cannot disagree about whether the simulator exists.
  const simEnabled = isSimEnabled(env);

  return {
    auth,
    db,
    env,
    espnProvider,
    clock: () => resolveClock(simEnabled, () => getSimClockOffsetMs(db)),
    provider: async (clock) => {
      // With the simulator off, simulator state isn't read at all — the
      // short-circuit lives here as well as inside the resolver so the claim
      // "production cannot reach the simulator" is true of the query, not just
      // the outcome.
      const activeScenarioId = simEnabled ? (await getSimState(db)).activeScenarioId : null;
      return resolveGameDataProvider({
        simEnabled,
        espn: espnProvider,
        clock,
        activeScenarioId,
        readFixtures: (scenarioId) => readSimFixtureSnapshot(db, scenarioId),
      });
    },
  };
}
