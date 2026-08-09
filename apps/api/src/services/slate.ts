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
import { effectiveKickoffAtSql, resolveGameOverrides } from "./games";

/**
 * The weekly slate every *request* surface reads from — the pick page and the
 * pick write path's validation. Mode-agnostic: every mode picking NFL games
 * picks against this same slate. One loader, so "what the member saw" and "what
 * the server validated against" can't diverge.
 *
 * Settlement deliberately does NOT read through here (see
 * `services/pickem/settlement.ts`): it grades against the spread stored on the
 * pick, not the current one, which this loader knows nothing about. Sharing it
 * would mean teaching the read path about settlement's concerns for no benefit.
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
  // The book `spread` came from (PKM-9); null under `override_spread` — see
  // `resolveGameOverrides`.
  spreadSource: string | null;
  // Live in-game state and the instant it was observed (DATA-8) — see
  // `SlateGameSchema` for what `stateAsOf` means.
  period: number | null;
  clockSeconds: number | null;
  stateAsOf: Date;
  locked: boolean;
  /**
   * Whether a new pick may be placed on this game. A cancelled game is still
   * shown — the member needs to see why a pick pushed — but must not be
   * pickable: an unplayed game settles as a push, so accepting a fresh pick on
   * one would mint guaranteed points (ADR-0015 rule 2).
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

  const now = clock.now();

  return rows.map(({ game, homeTeam, awayTeam }) => {
    const effective = resolveGameOverrides(game);
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
      spreadSource: effective.spreadSource,
      period: effective.period,
      clockSeconds: effective.clockSeconds,
      // The row's last observed change *is* the instant its live state was
      // true: score sync writes only when something it reads moved.
      stateAsOf: game.updatedAt,
      locked: isLocked(effective.kickoffAt, now),
      pickable: isPickable(effective.status),
    };
  });
}

/**
 * The derived-lock rule (arch D11), in one place: half-open, so a game is
 * locked from the kickoff instant itself. Takes the *effective* kickoff —
 * callers resolve override precedence through `resolveGameOverrides` first.
 */
export function isLocked(effectiveKickoffAt: Date, now: Date): boolean {
  return effectiveKickoffAt.getTime() <= now.getTime();
}

/**
 * Whether a fresh pick may be placed on a game, by its *effective* status. A
 * cancelled game settles as a push, so accepting a new pick on one would mint a
 * guaranteed result (ADR-0015 rule 2). Exported beside `isLocked` because the
 * pair is what "can this member still act on this week?" is made of, and a
 * caller answering it away from the slate loader must not restate either half.
 */
export function isPickable(effectiveStatus: GameStatus): boolean {
  return !isUnplayedStatus(effectiveStatus);
}

/**
 * Lock state for an arbitrary set of games, by id — the visibility gate on the
 * pick read path, which holds picks rather than a slate and must resolve each
 * one's kickoff without assuming the week's slate still contains it.
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
  return new Map(rows.map((row) => [row.id, isLocked(resolveGameOverrides(row).kickoffAt, now)]));
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
    spreadSource: game.spreadSource,
    period: game.period,
    clockSeconds: game.clockSeconds,
    stateAsOf: game.stateAsOf.toISOString(),
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
