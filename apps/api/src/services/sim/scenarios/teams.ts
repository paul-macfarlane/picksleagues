import type { SimTeamDef } from "../definition";

/**
 * ESPN's own logo asset paths — the same shape the ESPN adapter stores for real
 * ingested teams (`espn-provider.ts` reads `logos[]` by `rel`), so a scenario
 * team renders identically to a synced one. Derived from the abbreviation
 * rather than listed per team: the pattern is ESPN's, uniform, and the only
 * thing that varies is the slug.
 *
 * The one place the simulator names a real external host, and deliberately so:
 * these are `<img>` sources in local dev, never a request path the app depends
 * on (arch §External Data — request paths never call ESPN). A URL that fails to
 * load degrades to the same initials fallback a team with no asset already gets.
 */
function logoUrls(abbreviation: string): Pick<SimTeamDef, "logoLightUrl" | "logoDarkUrl"> {
  const slug = abbreviation.toLowerCase();
  return {
    logoLightUrl: `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`,
    logoDarkUrl: `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${slug}.png`,
  };
}

function team(
  providerTeamId: string,
  abbreviation: string,
  name: string,
  location: string,
): SimTeamDef {
  return { providerTeamId, abbreviation, name, location, ...logoUrls(abbreviation) };
}

/**
 * The shared cast for every NFL library scenario (SIM-4). Real teams and
 * plausible ESPN-style provider IDs so a loaded scenario looks like genuine
 * ingested data; one roster shared across scenarios means a team abbreviation
 * always resolves to the same identity regardless of which scenario is active.
 */
export const SIM_LIBRARY_TEAMS: SimTeamDef[] = [
  team("2", "BUF", "Bills", "Buffalo"),
  team("15", "MIA", "Dolphins", "Miami"),
  team("12", "KC", "Chiefs", "Kansas City"),
  team("7", "DEN", "Broncos", "Denver"),
  team("6", "DAL", "Cowboys", "Dallas"),
  team("21", "PHI", "Eagles", "Philadelphia"),
  team("25", "SF", "49ers", "San Francisco"),
  team("26", "SEA", "Seahawks", "Seattle"),
];
