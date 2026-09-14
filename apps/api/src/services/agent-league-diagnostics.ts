import { asc, count, eq, sql } from "drizzle-orm";
import { leagueMembers, leagueSeasons, leagues, weeks, type Db } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  AGENT_ANOMALY,
  AgentLeagueDiagnosticsResponseSchema,
  AgentSettingsSchema,
  LEAGUE_MODE,
  PICK_TYPE,
  isWeekInSeasonRange,
  PickemSettingsSchema,
  SurvivorSettingsSchema,
} from "@picksleagues/schemas";
import { agentPickemCountsQuery, agentSurvivorCountsQuery } from "./agent-league-counts";
import { resolveCurrentWeekId } from "./league-weeks";

/**
 * SQL aggregates never materialize member identities or individual picks in the application.
 * Repeatable-read keeps concurrent settlement from creating false cross-query discrepancies.
 */
export async function agentLeagueDiagnostics(db: Db, clock: Clock, leagueSeasonId: string) {
  return db.transaction(
    async (tx) => {
      const [season] = await tx
        .select({
          leagueSeasonId: leagueSeasons.id,
          leagueId: leagueSeasons.leagueId,
          seasonId: leagueSeasons.seasonId,
          status: leagueSeasons.status,
          mode: leagues.mode,
          settings: sql<unknown>`jsonb_strip_nulls(jsonb_build_object(
        'startWeek', jsonb_build_object('type', ${leagueSeasons.settings}->'startWeek'->'type', 'number', ${leagueSeasons.settings}->'startWeek'->'number'),
        'endWeek', jsonb_build_object('type', ${leagueSeasons.settings}->'endWeek'->'type', 'number', ${leagueSeasons.settings}->'endWeek'->'number'),
        'pickType', ${leagueSeasons.settings}->'pickType', 'picksPerWeek', ${leagueSeasons.settings}->'picksPerWeek'))`,
        })
        .from(leagueSeasons)
        .innerJoin(leagues, eq(leagues.id, leagueSeasons.leagueId))
        .where(eq(leagueSeasons.id, leagueSeasonId));
      if (!season) return null;
      const [membership] = await tx
        .select({ count: count() })
        .from(leagueMembers)
        .where(eq(leagueMembers.leagueId, season.leagueId));
      const isPickem = season.mode === LEAGUE_MODE.PICKEM;
      const supported = isPickem || season.mode === LEAGUE_MODE.SURVIVOR;
      // Mode schemas interpret persisted defaults; the independent output schema prevents future field exposure.
      const settings = supported
        ? AgentSettingsSchema.parse(
            (isPickem ? PickemSettingsSchema : SurvivorSettingsSchema).parse(season.settings),
          )
        : null;
      const weekRows = settings
        ? await tx
            .select({
              id: weeks.id,
              weekType: weeks.weekType,
              weekNumber: weeks.weekNumber,
              startsAt: weeks.startsAt,
              endsAt: weeks.endsAt,
            })
            .from(weeks)
            .where(eq(weeks.seasonId, season.seasonId))
            .orderBy(asc(weeks.startsAt), asc(weeks.weekNumber))
        : [];
      const currentWeekId = settings
        ? resolveCurrentWeekId(
            weekRows.filter((w) =>
              isWeekInSeasonRange(w, {
                startWeek: { type: settings.startWeek.type, number: settings.startWeek.number },
                endWeek: { type: settings.endWeek.type, number: settings.endWeek.number },
              }),
            ),
            clock,
          )
        : null;
      const emptyCounts = {
        submittedPickCount: 0,
        gradedPickCount: 0,
        ungradedPickCount: 0,
        ungradedResolvedPickCount: 0,
        standingStateRowCount: 0,
        missingStandingCount: 0,
        inconsistentRowCount: 0,
        duplicateRowCount: 0,
        dataUpdatedAt: null,
      };
      if (!supported)
        return AgentLeagueDiagnosticsResponseSchema.parse({
          ...season,
          ...emptyCounts,
          settings,
          memberCount: membership?.count ?? 0,
          currentWeekId,
          anomalies: [AGENT_ANOMALY.UNSUPPORTED_MODE],
        });

      const [counts] = await (isPickem
        ? agentPickemCountsQuery(tx, season, settings?.pickType === PICK_TYPE.AGAINST_THE_SPREAD)
        : agentSurvivorCountsQuery(tx, season));
      const anomalies = [];
      if (Number(counts?.ungradedResolvedPickCount))
        anomalies.push(AGENT_ANOMALY.UNGRADED_RESOLVED_PICKS);
      if (Number(counts?.inconsistentRowCount) || Number(counts?.duplicateRowCount))
        anomalies.push(AGENT_ANOMALY.INCONSISTENT_ROWS);
      if (Number(counts?.missingStandingCount)) anomalies.push(AGENT_ANOMALY.MISSING_STANDINGS);
      return AgentLeagueDiagnosticsResponseSchema.parse({
        ...season,
        ...counts,
        settings,
        currentWeekId,
        memberCount: membership?.count ?? 0,
        anomalies,
        dataUpdatedAt: counts?.dataUpdatedAt ? new Date(counts.dataUpdatedAt).toISOString() : null,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
