import type { SimLibraryEntry } from "@picksleagues/schemas";
import type { SimScenarioDefinition } from "../definition";
import { allEliminatedScenario } from "./all-eliminated";
import { cancelledGameScenario } from "./cancelled-game";
import { mixedWeekScenario } from "./mixed-week";
import { postponedGameScenario } from "./postponed-game";
import { pushAtsScenario } from "./push-ats";
import { survivorSeasonScenario } from "./survivor-season";
import { tieGameScenario } from "./tie-game";

/**
 * The canned edge-case scenario library (SIM-4). Keyed by slug so a route can
 * look one up directly; `materializeDefinition`/`writeScenario` (definition.ts)
 * turn an entry into fixture rows when an operator loads it.
 */
export const SIM_SCENARIO_LIBRARY: Record<string, SimScenarioDefinition> = {
  [pushAtsScenario.slug]: pushAtsScenario,
  [tieGameScenario.slug]: tieGameScenario,
  [cancelledGameScenario.slug]: cancelledGameScenario,
  [postponedGameScenario.slug]: postponedGameScenario,
  [allEliminatedScenario.slug]: allEliminatedScenario,
  [mixedWeekScenario.slug]: mixedWeekScenario,
  [survivorSeasonScenario.slug]: survivorSeasonScenario,
};

/** The library's wire shape (`SimStateResponse.library`) — no fixtures required to list it. */
export function listLibraryEntries(): SimLibraryEntry[] {
  return Object.values(SIM_SCENARIO_LIBRARY).map((definition) => ({
    slug: definition.slug,
    name: definition.name,
    description: definition.description,
    sport: definition.sport,
    covers: definition.covers,
  }));
}
