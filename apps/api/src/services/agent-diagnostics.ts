import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { games, sportSeasons, teams, weeks, type Db } from "@picksleagues/db";
import { nflSeasonYearFor, type Clock, type AppEnv } from "@picksleagues/core";
import {
  AGENT_ANOMALY,
  AgentGameResponseSchema,
  AgentSystemResponseSchema,
  AgentWeekResponseSchema,
  GAME_STATUS,
  SPORT,
} from "@picksleagues/schemas";
import { resolveCurrentWeekId } from "./league-weeks";

type Anomaly = (typeof AGENT_ANOMALY)[keyof typeof AGENT_ANOMALY];

/** Stored sports facts only; freshness means last change, never last successful ingestion. */
export async function agentSystem(db: Db, clock: Clock, environment: AppEnv) {
  const seasonYear = nflSeasonYearFor(clock.now());
  const [season] = await db
    .select({ id: sportSeasons.id, provisional: sportSeasons.provisional })
    .from(sportSeasons)
    .where(and(eq(sportSeasons.sport, SPORT.NFL), eq(sportSeasons.year, seasonYear)));
  const weekRows = season
    ? await db
        .select({ id: weeks.id, startsAt: weeks.startsAt, endsAt: weeks.endsAt })
        .from(weeks)
        .where(eq(weeks.seasonId, season.id))
        .orderBy(asc(weeks.startsAt), asc(weeks.weekNumber))
    : [];
  const currentWeekId = resolveCurrentWeekId(weekRows, clock);
  const week = currentWeekId ? await agentWeek(db, clock, currentWeekId) : null;
  return AgentSystemResponseSchema.parse({
    environment,
    serverTime: clock.now().toISOString(),
    supportedSports: [SPORT.NFL],
    seasonYear,
    seasonId: season?.id ?? null,
    provisional: season?.provisional ?? null,
    currentWeekId,
    dataUpdatedAt: week?.dataUpdatedAt ?? null,
    anomalies: season ? (week?.anomalies ?? [AGENT_ANOMALY.NO_GAMES]) : [AGENT_ANOMALY.NO_SEASON],
  });
}

/** A bounded aggregate covers all game statuses, including postponed and cancelled games. */
export async function agentWeek(db: Db, clock: Clock, weekId: string) {
  const now = clock.now();
  const counted = (predicate: ReturnType<typeof sql>) =>
    sql<number>`count(${games.id}) filter (where ${predicate})`.mapWith(Number);
  const [row] = await db
    .select({
      weekId: weeks.id,
      seasonId: weeks.seasonId,
      weekType: weeks.weekType,
      weekNumber: weeks.weekNumber,
      startsAt: weeks.startsAt,
      endsAt: weeks.endsAt,
      scheduled: counted(sql`${games.status} = ${GAME_STATUS.SCHEDULED}`),
      inProgress: counted(sql`${games.status} = ${GAME_STATUS.IN_PROGRESS}`),
      final: counted(sql`${games.status} = ${GAME_STATUS.FINAL}`),
      postponed: counted(sql`${games.status} = ${GAME_STATUS.POSTPONED}`),
      cancelled: counted(sql`${games.status} = ${GAME_STATUS.CANCELLED}`),
      missingSpreadCount: counted(sql`${games.spread} is null`),
      finalWithoutScoreCount: counted(
        sql`${games.status} = ${GAME_STATUS.FINAL} and (${games.homeScore} is null or ${games.awayScore} is null)`,
      ),
      scheduledAfterKickoffCount: counted(
        sql`${games.status} = ${GAME_STATUS.SCHEDULED} and ${games.kickoffAt} <= ${now}`,
      ),
      dataUpdatedAt: sql<string | null>`max(${games.updatedAt})`,
    })
    .from(weeks)
    .leftJoin(games, eq(games.weekId, weeks.id))
    .where(eq(weeks.id, weekId))
    .groupBy(weeks.id);
  if (!row) return null;
  const gameCounts = {
    scheduled: row.scheduled,
    in_progress: row.inProgress,
    final: row.final,
    postponed: row.postponed,
    cancelled: row.cancelled,
  };
  const anomalies: Anomaly[] = [];
  if (Object.values(gameCounts).every((n) => n === 0)) anomalies.push(AGENT_ANOMALY.NO_GAMES);
  if (row.missingSpreadCount) anomalies.push(AGENT_ANOMALY.MISSING_SPREAD);
  if (row.finalWithoutScoreCount) anomalies.push(AGENT_ANOMALY.FINAL_WITHOUT_SCORE);
  if (row.scheduledAfterKickoffCount) anomalies.push(AGENT_ANOMALY.SCHEDULED_AFTER_KICKOFF);
  return AgentWeekResponseSchema.parse({
    ...row,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    dataUpdatedAt: row.dataUpdatedAt ? new Date(row.dataUpdatedAt).toISOString() : null,
    gameCounts,
    anomalies,
  });
}

/** The team projection intentionally excludes names, images and provider free-text fields. */
export async function agentGame(db: Db, clock: Clock, gameId: string) {
  const home = alias(teams, "agent_home");
  const away = alias(teams, "agent_away");
  const [row] = await db
    .select({
      gameId: games.id,
      weekId: games.weekId,
      providerGameId: games.providerGameId,
      homeTeam: { id: home.id, abbreviation: home.abbreviation },
      awayTeam: { id: away.id, abbreviation: away.abbreviation },
      kickoffAt: games.kickoffAt,
      status: games.status,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      period: games.period,
      clockSeconds: games.clockSeconds,
      spread: games.spread,
      hasSpreadSource: sql<boolean>`${games.spreadSource} is not null`,
      gameStateUpdatedAt: games.updatedAt,
    })
    .from(games)
    .innerJoin(home, eq(home.id, games.homeTeamId))
    .innerJoin(away, eq(away.id, games.awayTeamId))
    .where(eq(games.id, gameId));
  if (!row) return null;
  const anomalies: Anomaly[] = [];
  if (row.spread === null) anomalies.push(AGENT_ANOMALY.MISSING_SPREAD);
  if (row.status === GAME_STATUS.FINAL && (row.homeScore === null || row.awayScore === null))
    anomalies.push(AGENT_ANOMALY.FINAL_WITHOUT_SCORE);
  if (row.status === GAME_STATUS.SCHEDULED && row.kickoffAt <= clock.now())
    anomalies.push(AGENT_ANOMALY.SCHEDULED_AFTER_KICKOFF);
  return AgentGameResponseSchema.parse({
    ...row,
    kickoffAt: row.kickoffAt.toISOString(),
    gameStateUpdatedAt: row.gameStateUpdatedAt.toISOString(),
    anomalies,
  });
}
