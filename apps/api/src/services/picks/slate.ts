import { asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@picksleagues/db";
import { games, teams, weeks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  isUnplayedStatus,
  type GameStatus,
  type SlateTeam,
  type WeekSlateResponse,
} from "@picksleagues/schemas";
import { effectiveKickoffAtSql, resolveGameOverrides } from "../games";
import { latestSpreadsForGames } from "../odds";

/**
 * The weekly slate every Pick'em surface reads from — the pick page, the pick
 * write path's validation, and (later) settlement's input loader. One loader so
 * "what the member saw" and "what the server validated against" can't diverge.
 *
 * Lock state is derived here from the injected Clock against the *effective*
 * kickoff (arch D11, D15): an admin kickoff correction moves the lock with it.
 */

export interface ResolvedSlateGame {
  id: string;
  weekId: string;
  homeTeam: SlateTeam;
  awayTeam: SlateTeam;
  kickoffAt: Date;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  spread: number | null;
  locked: boolean;
  /**
   * Whether a new pick may be placed on this game. A cancelled or moved game is
   * still shown (the member needs to see why a pick pushed, and PKM-7's re-pick
   * flow starts there) but must not be pickable — an unplayed game settles as a
   * push, so accepting a fresh pick on one would mint guaranteed points.
   */
  pickable: boolean;
}

type WeekRow = typeof weeks.$inferSelect;

function teamColumns(source: ReturnType<typeof alias>) {
  return {
    id: source.id,
    abbreviation: source.abbreviation,
    name: source.name,
    location: source.location,
    logoLightUrl: source.logoLightUrl,
    logoDarkUrl: source.logoDarkUrl,
  };
}

export async function getWeek(db: Db, weekId: string): Promise<WeekRow | null> {
  const [row] = await db.select().from(weeks).where(eq(weeks.id, weekId));
  return row ?? null;
}

/**
 * Every game in a week with overrides resolved and lock state derived, ordered
 * by the kickoff the app actually uses so the UI and the server agree on slate
 * order.
 */
export async function loadResolvedWeekGames(
  db: Db,
  clock: Clock,
  weekId: string,
): Promise<ResolvedSlateGame[]> {
  const homeTeams = alias(teams, "home_teams");
  const awayTeams = alias(teams, "away_teams");

  const rows = await db
    .select({
      game: games,
      homeTeam: teamColumns(homeTeams),
      awayTeam: teamColumns(awayTeams),
    })
    .from(games)
    .innerJoin(homeTeams, eq(homeTeams.id, games.homeTeamId))
    .innerJoin(awayTeams, eq(awayTeams.id, games.awayTeamId))
    .where(eq(games.weekId, weekId))
    .orderBy(asc(effectiveKickoffAtSql), asc(games.providerGameId));
  if (rows.length === 0) return [];

  const latestByGame = await latestSpreadsForGames(
    db,
    rows.map((row) => row.game.id),
  );
  const now = clock.now();

  return rows.map(({ game, homeTeam, awayTeam }) => {
    const effective = resolveGameOverrides(game, latestByGame.get(game.id)?.spread ?? null);
    return {
      id: game.id,
      weekId: game.weekId,
      homeTeam,
      awayTeam,
      kickoffAt: effective.kickoffAt,
      status: effective.status,
      homeScore: effective.homeScore,
      awayScore: effective.awayScore,
      spread: effective.spread,
      locked: isLocked(effective.kickoffAt, now),
      pickable: !isUnplayedStatus(effective.status),
    };
  });
}

/**
 * The derived-lock rule (arch D11), in one place: half-open, so a game is
 * locked from the kickoff instant itself. Takes the *effective* kickoff —
 * callers resolve override precedence through `resolveGameOverrides` first.
 */
function isLocked(effectiveKickoffAt: Date, now: Date): boolean {
  return effectiveKickoffAt.getTime() <= now.getTime();
}

/**
 * Lock state for an arbitrary set of games, by id. The read path needs this
 * rather than the slate map because a pick can outlive its game's membership in
 * the week it was made in — a game moved to another week still has to reveal
 * that pick at its own kickoff.
 */
export async function resolveLockStates(
  db: Db,
  clock: Clock,
  gameIds: readonly string[],
): Promise<Map<string, boolean>> {
  if (gameIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(games)
    .where(inArray(games.id, [...gameIds]));
  const now = clock.now();

  // Precedence resolved through the one home for it (arch D15) rather than
  // restated here — this and `loadResolvedWeekGames` must not drift.
  return new Map(
    rows.map((row) => [row.id, isLocked(resolveGameOverrides(row, null).kickoffAt, now)]),
  );
}

function serializeSlateGame(game: ResolvedSlateGame) {
  return {
    id: game.id,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    kickoffAt: game.kickoffAt.toISOString(),
    status: game.status,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    spread: game.spread,
    locked: game.locked,
    pickable: game.pickable,
  };
}

/** Null when the week doesn't exist. A week with no games yet is an empty slate. */
export async function getWeekSlate(
  db: Db,
  clock: Clock,
  weekId: string,
): Promise<WeekSlateResponse | null> {
  const week = await getWeek(db, weekId);
  if (!week) return null;

  const resolved = await loadResolvedWeekGames(db, clock, weekId);
  return {
    weekId: week.id,
    weekType: week.weekType,
    weekNumber: week.weekNumber,
    label: week.label,
    startsAt: week.startsAt.toISOString(),
    endsAt: week.endsAt.toISOString(),
    games: resolved.map(serializeSlateGame),
  };
}
