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
