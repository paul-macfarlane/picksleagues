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

// Registered under its own component name for the same reason as
// `NullableUsername` (me.ts): `.nullable()` on an already-registered node folds
// `null` into that shared component instead of producing a nullable $ref, and
// the generated client then types the field as an unusable intersection. Used
// wherever "no override recorded" is a value — the override block on AdminGame
// and the clear half of GameOverrideRequest.
export const NullableGameStatusSchema = GameStatusSchema.nullable().openapi("NullableGameStatus");

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

/**
 * Statuses meaning the game has already been played, in whole or in part —
 * a different question from `isUnplayedStatus` (which is "will never be played
 * in this week"), and not its inverse: `scheduled` and `postponed` are neither,
 * because such a game is still ahead of us and picks on it are legitimate.
 *
 * The admin override guard is the caller: a game in one of these must never be
 * left unlocked (arch D11, D15), or every member could pick against an outcome
 * the same page is already showing them. That guard pairs this with a resolved-
 * score check rather than folding "has a score" in here — `postponed` carrying
 * a score is knowable without ever having started, and this constant means what
 * it says.
 */
const STARTED_GAME_STATUSES: readonly GameStatus[] = [GAME_STATUS.IN_PROGRESS, GAME_STATUS.FINAL];

export function isStartedStatus(status: GameStatus): boolean {
  return STARTED_GAME_STATUSES.includes(status);
}
