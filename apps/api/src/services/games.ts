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
  overrideKickoffAt: Date | null;
  overrideStatus: GameStatus | null;
  overrideHomeScore: number | null;
  overrideAwayScore: number | null;
  overrideSpread: number | null;
};

export type ResolvedGame = {
  kickoffAt: Date;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  spread: number | null;
};

/**
 * `providerSpread` is passed in rather than read off the game because the
 * provider's spread lives in `odds_snapshots`, not on `games` — which snapshot
 * counts (latest vs. the one current at lock time) is the caller's decision,
 * while the override's precedence over it is not.
 */
export function resolveGameOverrides(
  game: GameOverrideFields,
  providerSpread: number | null,
): ResolvedGame {
  return {
    kickoffAt: game.overrideKickoffAt ?? game.kickoffAt,
    status: game.overrideStatus ?? game.status,
    homeScore: game.overrideHomeScore ?? game.homeScore,
    awayScore: game.overrideAwayScore ?? game.awayScore,
    spread: game.overrideSpread ?? providerSpread,
  };
}

/**
 * SQL form of the kickoff coalesce, for the ORDER BY / WHERE clauses that must
 * agree with `resolveGameOverrides` — kept beside it so the two can't drift.
 */
export const effectiveKickoffAtSql = sql<Date>`coalesce(${games.overrideKickoffAt}, ${games.kickoffAt})`;
