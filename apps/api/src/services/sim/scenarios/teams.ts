import type { SimTeamDef } from "../definition";

/**
 * The shared cast for every NFL library scenario (SIM-4). Real teams and
 * plausible ESPN-style provider IDs so a loaded scenario looks like genuine
 * ingested data; one roster shared across scenarios means a team abbreviation
 * always resolves to the same identity regardless of which scenario is active.
 */
export const SIM_LIBRARY_TEAMS: SimTeamDef[] = [
  { providerTeamId: "2", abbreviation: "BUF", name: "Bills", location: "Buffalo" },
  { providerTeamId: "15", abbreviation: "MIA", name: "Dolphins", location: "Miami" },
  { providerTeamId: "12", abbreviation: "KC", name: "Chiefs", location: "Kansas City" },
  { providerTeamId: "7", abbreviation: "DEN", name: "Broncos", location: "Denver" },
  { providerTeamId: "6", abbreviation: "DAL", name: "Cowboys", location: "Dallas" },
  { providerTeamId: "21", abbreviation: "PHI", name: "Eagles", location: "Philadelphia" },
  { providerTeamId: "25", abbreviation: "SF", name: "49ers", location: "San Francisco" },
  { providerTeamId: "26", abbreviation: "SEA", name: "Seahawks", location: "Seattle" },
];
