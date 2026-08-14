import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * The single home for team identity precedence (STAT-8, ADR-0042), the
 * `services/games.ts` pattern: every serializer that displays a team — slate,
 * survivor standings, the admin browsers, the matchup sheet's reads — resolves
 * `override_* ?? provider_*` through here, so a corrected name can never
 * render one way on one surface and another way elsewhere. Display fields
 * only: the keys ingestion matches rows on (`providerTeamId`, the bootstrap
 * abbreviation uniqueness) have no override parallel, so sync matching never
 * reads through here.
 */

/** The columns precedence reads — a `teams` row satisfies this structurally. */
export type TeamIdentityFields = {
  name: string;
  abbreviation: string;
  location: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  overrideName: string | null;
  overrideAbbreviation: string | null;
  overrideLocation: string | null;
  overrideLogoLightUrl: string | null;
  overrideLogoDarkUrl: string | null;
};

export type ResolvedTeamIdentity = {
  name: string;
  abbreviation: string;
  location: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
};

export function resolveTeamIdentity(team: TeamIdentityFields): ResolvedTeamIdentity {
  return {
    name: team.overrideName ?? team.name,
    abbreviation: team.overrideAbbreviation ?? team.abbreviation,
    location: team.overrideLocation ?? team.location,
    logoLightUrl: team.overrideLogoLightUrl ?? team.logoLightUrl,
    logoDarkUrl: team.overrideLogoDarkUrl ?? team.logoDarkUrl,
  };
}

// Structural: satisfied by the `teams` table and any `alias()` of it, which is
// what lets one helper serve both the home/away joins and the bare-table reads.
// `id` keeps its data type because it passes through to the SELECT unwrapped;
// the rest only ever feed `sql` templates, where any column shape will do.
type TeamIdentityColumnSource = Record<
  | "name"
  | "abbreviation"
  | "location"
  | "logoLightUrl"
  | "logoDarkUrl"
  | "overrideName"
  | "overrideAbbreviation"
  | "overrideLocation"
  | "overrideLogoLightUrl"
  | "overrideLogoDarkUrl",
  AnyPgColumn
> & { id: AnyPgColumn<{ data: string; notNull: true }> };

/**
 * SQL form of the identity coalesces, for SELECT lists (and their ORDER BYs)
 * that must agree with `resolveTeamIdentity` — kept beside it so the two
 * can't drift, the `effectiveKickoffAtSql` obligation.
 */
export function effectiveTeamColumns(source: TeamIdentityColumnSource) {
  return {
    id: source.id,
    abbreviation: sql<string>`coalesce(${source.overrideAbbreviation}, ${source.abbreviation})`,
    name: sql<string>`coalesce(${source.overrideName}, ${source.name})`,
    location: sql<string | null>`coalesce(${source.overrideLocation}, ${source.location})`,
    logoLightUrl: sql<
      string | null
    >`coalesce(${source.overrideLogoLightUrl}, ${source.logoLightUrl})`,
    logoDarkUrl: sql<string | null>`coalesce(${source.overrideLogoDarkUrl}, ${source.logoDarkUrl})`,
  };
}
