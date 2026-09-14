import { asc, eq, sql } from "drizzle-orm";
import { leagueSeasons, leagues, weeks, type Db } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  AGENT_ANOMALY,
  AgentLeagueDiagnosticsResponseSchema,
  AgentSettingsSchema,
  GAME_STATUS,
  LEAGUE_MODE,
  PICK_TYPE,
  isWeekInSeasonRange,
  PickemSettingsSchema,
  SurvivorSettingsSchema,
} from "@picksleagues/schemas";
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
      const {
        rows: [membership],
      } = await tx.execute<{ count: number }>(
        sql`select count(*)::int as count from league_members where league_id = ${season.leagueId}`,
      );
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

      // These identifiers are code-owned; no caller supplies SQL, table names or diagnostic filters.
      const picks = sql.identifier(isPickem ? "pickem_picks" : "survivor_picks");
      const results = sql.identifier(isPickem ? "pickem_pick_results" : "survivor_pick_results");
      const pickId = sql.identifier(isPickem ? "pickem_pick_id" : "survivor_pick_id");
      const states = sql.identifier(isPickem ? "pickem_standings" : "survivor_state");
      const stateScope = isPickem ? sql`s.week_id is null` : sql`true`;
      const stateMismatch = isPickem
        ? sql`s.points <> coalesce((select sum(r.points) from ${results} r
      where r.league_season_id = ${leagueSeasonId} and r.league_member_id = s.league_member_id), 0)`
        : sql`(s.eliminated_week_id is null and s.lives_remaining <> 1) or (s.eliminated_week_id is not null and s.lives_remaining <> 0)`;
      const atsMissing =
        isPickem && settings?.pickType === PICK_TYPE.AGAINST_THE_SPREAD
          ? sql`or p.spread_at_pick is null`
          : sql``;
      const {
        rows: [counts],
      } = await tx.execute<Record<string, number | string | null>>(sql`
      with p as (select * from ${picks} where league_season_id = ${leagueSeasonId}),
      r as (select * from ${results} where league_season_id = ${leagueSeasonId}),
      s as (select * from ${states} s where s.league_season_id = ${leagueSeasonId} and ${stateScope})
      select
        (select count(*)::int from p) as "submittedPickCount",
        (select count(*)::int from r) as "gradedPickCount",
        (select count(*)::int from p where not exists (select 1 from ${results} r where r.${pickId} = p.id)) as "ungradedPickCount",
        (select count(*)::int from p join games g on g.id = p.game_id
          where (g.status = ${GAME_STATUS.CANCELLED} or (g.status = ${GAME_STATUS.FINAL} and g.home_score is not null and g.away_score is not null))
          and not exists (select 1 from ${results} r where r.${pickId} = p.id)) as "ungradedResolvedPickCount",
        (select count(*)::int from s) as "standingStateRowCount",
        ${
          isPickem
            ? sql`(select count(*)::int from league_members m where m.league_id = ${season.leagueId}
          and exists (select 1 from r) and not exists (select 1 from s where s.league_member_id = m.id))`
            : sql`0`
        } as "missingStandingCount",
        ((select count(*) from p join games g on g.id = p.game_id join weeks w on w.id = p.week_id
          join league_members m on m.id = p.league_member_id
          where g.week_id <> p.week_id or w.season_id <> ${season.seasonId} or m.league_id <> ${season.leagueId} ${atsMissing}) +
        (select count(*) from ${results} r join ${picks} p on p.id = r.${pickId}
          where (r.league_season_id = ${leagueSeasonId} or p.league_season_id = ${leagueSeasonId})
          and (r.league_season_id <> p.league_season_id or r.league_member_id <> p.league_member_id or r.week_id <> p.week_id)) +
        (select count(*) from s join league_members m on m.id = s.league_member_id
          where m.league_id <> ${season.leagueId} or (${stateMismatch})))::int as "inconsistentRowCount",
        (select coalesce(sum(n - 1), 0)::int from (select count(*) n from p group by league_member_id, week_id ${isPickem ? sql`, game_id` : sql``} having count(*) > 1) d) as "duplicateRowCount",
        (select max(t) from (select updated_at t from p union all select settled_at t from r union all select updated_at t from s) changes) as "dataUpdatedAt"
    `);
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
