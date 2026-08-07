import { sql } from "drizzle-orm";
import { games } from "@picksleagues/db";
import type { GameStatus } from "@picksleagues/schemas";

/**
 * The single home for game override precedence (arch D15, engineering rules
 * §Data: "override precedence is `override_* ?? provider_*`, resolved in
 * exactly the places the architecture names — serializers + settlement input
 * loader"). Every one of those places calls through here rather than restating
 * the coalesce, so a correction can never be resolved one way on a read path
 * and another way at settlement.
 */

/** The columns precedence reads — a `games` row satisfies this structurally. */
export type GameOverrideFields = {
  kickoffAt: Date;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  spread: number | null;
  period: number | null;
  clockSeconds: number | null;
  overrideKickoffAt: Date | null;
  overrideStatus: GameStatus | null;
  overrideHomeScore: number | null;
  overrideAwayScore: number | null;
  overrideSpread: number | null;
  overridePeriod: number | null;
  overrideClockSeconds: number | null;
};

export type ResolvedGame = {
  kickoffAt: Date;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  spread: number | null;
  // Live in-game state (DATA-8). Display-only: a period and a clock say where a
  // game is, never what its outcome was, so nothing that grades a pick reads
  // them.
  period: number | null;
  clockSeconds: number | null;
};

export function resolveGameOverrides(game: GameOverrideFields): ResolvedGame {
  return {
    kickoffAt: game.overrideKickoffAt ?? game.kickoffAt,
    status: game.overrideStatus ?? game.status,
    homeScore: game.overrideHomeScore ?? game.homeScore,
    awayScore: game.overrideAwayScore ?? game.awayScore,
    spread: game.overrideSpread ?? game.spread,
    period: game.overridePeriod ?? game.period,
    clockSeconds: game.overrideClockSeconds ?? game.clockSeconds,
  };
}

/**
 * SQL form of the kickoff coalesce, for the ORDER BY / WHERE clauses that must
 * agree with `resolveGameOverrides` — kept beside it so the two can't drift.
 */
export const effectiveKickoffAtSql = sql<Date>`coalesce(${games.overrideKickoffAt}, ${games.kickoffAt})`;
