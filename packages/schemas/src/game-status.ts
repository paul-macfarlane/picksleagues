import { z } from "@hono/zod-openapi";

/**
 * Domain game status (arch §Overrides, §Domain Model). Provider ingestion only
 * ever writes the first five; `moved` exists solely for admin `override_status`
 * — a provider "week move" is expressed as the game's week FK changing, and the
 * spec's treat-as-cancelled pick handling derives from that at settlement time.
 */
export const GAME_STATUS = {
  SCHEDULED: "scheduled",
  IN_PROGRESS: "in_progress",
  FINAL: "final",
  POSTPONED: "postponed",
  CANCELLED: "cancelled",
  MOVED: "moved",
} as const;

export type GameStatus = (typeof GAME_STATUS)[keyof typeof GAME_STATUS];

export const GameStatusSchema = z.enum(GAME_STATUS).openapi("GameStatus");

/**
 * Statuses meaning the game will never be played in this week — the spec's
 * cancellation rule and its "moved to a different week is treated as a
 * cancellation" twin (spec §Cancellations, Postponements & Re-picks).
 *
 * One definition, because two rules key off it and they must agree: such a game
 * is not *pickable* (offering it would mint free push points), and an existing
 * pick on one *resolves as a push*. `postponed` is deliberately absent — a
 * postponement inside the week is played later and resolves normally.
 */
const UNPLAYED_GAME_STATUSES: readonly GameStatus[] = [GAME_STATUS.CANCELLED, GAME_STATUS.MOVED];

export function isUnplayedStatus(status: GameStatus): boolean {
  return UNPLAYED_GAME_STATUSES.includes(status);
}
