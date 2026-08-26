import type { AnyPgColumn } from "drizzle-orm/pg-core";

// Structural: satisfied by the `teams` table and any `alias()` of it, which is
// what lets one projection serve both the home/away joins and the bare-table
// reads. Data types are named so the SELECT result keeps them; an alias's
// column would otherwise fail on its table name alone.
type RequiredText = AnyPgColumn<{ data: string; notNull: true }>;
type OptionalText = AnyPgColumn<{ data: string; notNull: false }>;
type TeamLabelColumnSource = { id: RequiredText; abbreviation: RequiredText; name: RequiredText };
type TeamDisplayColumnSource = TeamLabelColumnSource & {
  location: OptionalText;
  logoLightUrl: OptionalText;
  logoDarkUrl: OptionalText;
};

/**
 * The SELECT projection of the `AdminGameTeam` label — how the admin browsers
 * orient a row by its teams.
 */
export function teamLabelColumns(source: TeamLabelColumnSource) {
  return { id: source.id, abbreviation: source.abbreviation, name: source.name };
}

/**
 * The SELECT projection of a team's display identity — the `SlateTeam` shape
 * every member surface labels a team with. One projection rather than a
 * per-site column list so a display field added to `teams` reaches every
 * surface (slate, survivor standings) in one edit instead of surfacing on
 * whichever sites remembered it.
 */
export function teamDisplayColumns(source: TeamDisplayColumnSource) {
  return {
    ...teamLabelColumns(source),
    location: source.location,
    logoLightUrl: source.logoLightUrl,
    logoDarkUrl: source.logoDarkUrl,
  };
}
