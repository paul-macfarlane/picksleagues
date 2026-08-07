import { eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { simFixtureGames, simFixtureTeams, simFixtureWeeks, simScenarios } from "@picksleagues/db";
import type { Clock, ProviderWeek, SimFixtureGameRow } from "@picksleagues/core";
import {
  type SimFinalStatus,
  type SimScenarioSource,
  type Sport,
  type WeekType,
} from "@picksleagues/schemas";

/**
 * The shape a scenario is authored in, and the one path that writes it to the
 * fixture tables. Both scenario sources build this: the canned library (SIM-4)
 * as code definitions, and the past-season importer (SIM-6) from real ESPN data.
 * Keeping one write path means a hand-written scenario and an imported season
 * are indistinguishable to the provider.
 *
 * Library definitions declare times as **offsets from the scenario anchor**
 * rather than absolute dates, so loading one places its games relative to the
 * simulated now instead of stranding them in a hard-coded year.
 */

export type SimTeamDef = {
  providerTeamId: string;
  abbreviation: string;
  name: string;
  location: string;
  // Carried so a loaded scenario renders like ingested data — the pick and
  // standings surfaces show team logos, and a scenario without them exercises a
  // fallback the real app almost never takes (SIM-4: "looks like genuine
  // ingested data"). Nullable to match `ProviderTeam`: the provider legitimately
  // has no asset for some teams, and a scenario may say so too.
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
};

export type SimWeekDef = {
  weekType: WeekType;
  weekNumber: number;
  label: string;
  startsAtOffsetMs: number;
  endsAtOffsetMs: number;
};

export type SimGameDef = {
  providerGameId: string;
  weekType: WeekType;
  weekNumber: number;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  kickoffAtOffsetMs: number;
  // Home-relative (negative = home favored), matching `games.spread`.
  spread: number | null;
  finalStatus: SimFinalStatus;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
};

export type SimScenarioDefinition = {
  slug: string;
  name: string;
  description: string;
  /** Which spec rule or edge case this scenario exists to reproduce. */
  covers: string;
  sport: Sport;
  teams: SimTeamDef[];
  weeks: SimWeekDef[];
  games: SimGameDef[];
};

/** Fixture rows with absolute instants — what actually gets written. */
export type MaterializedScenario = {
  slug: string;
  name: string;
  description: string;
  sport: Sport;
  seasonYear: number;
  source: SimScenarioSource;
  startsAt: Date;
  teams: SimTeamDef[];
  weeks: ProviderWeek[];
  games: SimFixtureGameRow[];
};

/**
 * Resolves a definition's offsets against an anchor instant. The anchor becomes
 * the scenario's `startsAt`, so loading it positions the simulated clock there
 * and every declared offset is measured from where the operator lands.
 */
export function materializeDefinition(
  definition: SimScenarioDefinition,
  anchor: Date,
  seasonYear: number,
  source: SimScenarioSource,
): MaterializedScenario {
  const teamsByAbbr = new Map(definition.teams.map((team) => [team.abbreviation, team]));
  const at = (offsetMs: number) => new Date(anchor.getTime() + offsetMs);

  return {
    slug: definition.slug,
    name: definition.name,
    description: definition.description,
    sport: definition.sport,
    seasonYear,
    source,
    startsAt: anchor,
    teams: definition.teams,
    weeks: definition.weeks.map((week) => ({
      weekType: week.weekType,
      weekNumber: week.weekNumber,
      label: week.label,
      startsAt: at(week.startsAtOffsetMs),
      endsAt: at(week.endsAtOffsetMs),
    })),
    games: definition.games.map((game) => {
      const home = teamsByAbbr.get(game.homeTeamAbbr);
      const away = teamsByAbbr.get(game.awayTeamAbbr);
      if (!home || !away) {
        // A definition is code, so this is a typo caught at load time rather
        // than an operator error — fail loudly instead of writing a fixture
        // whose teams can't be ingested.
        throw new Error(
          `Scenario ${definition.slug}: game ${game.providerGameId} references an undeclared team`,
        );
      }
      return {
        providerGameId: game.providerGameId,
        weekType: game.weekType,
        weekNumber: game.weekNumber,
        homeTeamAbbr: home.abbreviation,
        homeTeamName: home.name,
        homeTeamProviderId: home.providerTeamId,
        awayTeamAbbr: away.abbreviation,
        awayTeamName: away.name,
        awayTeamProviderId: away.providerTeamId,
        kickoffAt: at(game.kickoffAtOffsetMs),
        spread: game.spread,
        finalStatus: game.finalStatus,
        finalHomeScore: game.finalHomeScore,
        finalAwayScore: game.finalAwayScore,
      };
    }),
  };
}

/**
 * Writes a materialized scenario, replacing any fixtures already stored under
 * its slug. Replace rather than merge: re-importing a season or reloading a
 * library scenario must land on exactly the declared fixtures, never on those
 * plus leftovers from a previous shape. The scenario row itself is upserted so
 * its id — which `app_state` may reference as the active scenario — survives.
 *
 * One transaction, so a failed rewrite can't leave a scenario half-replaced.
 */
export async function writeScenario(
  db: Db,
  clock: Clock,
  materialized: MaterializedScenario,
): Promise<string> {
  const now = clock.now();

  return db.transaction(async (tx) => {
    const [scenario] = await tx
      .insert(simScenarios)
      .values({
        slug: materialized.slug,
        name: materialized.name,
        description: materialized.description,
        sport: materialized.sport,
        seasonYear: materialized.seasonYear,
        source: materialized.source,
        startsAt: materialized.startsAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: simScenarios.slug,
        set: {
          name: materialized.name,
          description: materialized.description,
          sport: materialized.sport,
          seasonYear: materialized.seasonYear,
          source: materialized.source,
          startsAt: materialized.startsAt,
          updatedAt: now,
        },
      })
      .returning({ id: simScenarios.id });

    if (!scenario) {
      throw new Error(`Scenario ${materialized.slug}: upsert returned no row`);
    }
    const scenarioId = scenario.id;

    await tx.delete(simFixtureGames).where(eq(simFixtureGames.scenarioId, scenarioId));
    await tx.delete(simFixtureWeeks).where(eq(simFixtureWeeks.scenarioId, scenarioId));
    await tx.delete(simFixtureTeams).where(eq(simFixtureTeams.scenarioId, scenarioId));

    if (materialized.teams.length > 0) {
      await tx.insert(simFixtureTeams).values(
        materialized.teams.map((team) => ({
          scenarioId,
          providerTeamId: team.providerTeamId,
          abbreviation: team.abbreviation,
          name: team.name,
          location: team.location,
          logoLightUrl: team.logoLightUrl,
          logoDarkUrl: team.logoDarkUrl,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    if (materialized.weeks.length > 0) {
      await tx.insert(simFixtureWeeks).values(
        materialized.weeks.map((week) => ({
          scenarioId,
          weekType: week.weekType,
          weekNumber: week.weekNumber,
          label: week.label,
          startsAt: week.startsAt,
          endsAt: week.endsAt,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    if (materialized.games.length > 0) {
      await tx.insert(simFixtureGames).values(
        materialized.games.map((game) => ({
          scenarioId,
          ...game,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    return scenarioId;
  });
}
