import { FixedClock, type Clock } from "./clock";
import type { GameDataProvider } from "./game-data-provider";
import { SimulatedProvider, type SimFixtureSnapshot } from "./sim-provider";

/**
 * Picks the data source for one request or job (ADR-0012), mirroring
 * `resolveClock`: with the simulator off (always so in production, per
 * `isSimEnabled`) this is structurally ESPN-only, and even with it on we leave
 * ESPN only when a scenario is actually loaded — ESPN is the default in every
 * environment (arch §Environments).
 *
 * Takes the caller's already-resolved `Clock` and pins it to a single instant.
 * `OffsetClock` re-reads system time on every call, so a job that fetches 22
 * weeks would otherwise project each against a slightly later "now" and could
 * straddle a kickoff boundary partway through — the week where that happened
 * would ingest inconsistently with the rest.
 *
 * `readFixtures` is lazy and receives the active scenario id already narrowed to
 * non-null — nothing reads fixture rows unless a provider method is called.
 */
export function resolveGameDataProvider(opts: {
  simEnabled: boolean;
  espn: GameDataProvider;
  clock: Clock;
  activeScenarioId: string | null;
  readFixtures: (scenarioId: string) => Promise<SimFixtureSnapshot>;
}): GameDataProvider {
  const scenarioId = opts.activeScenarioId;
  if (!opts.simEnabled || scenarioId === null) {
    return opts.espn;
  }
  return new SimulatedProvider(
    () => opts.readFixtures(scenarioId),
    new FixedClock(opts.clock.now()),
  );
}
