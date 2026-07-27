import { z } from "@hono/zod-openapi";

/**
 * Which side of a game a Pick'em pick is on. Stored per pick rather than as a
 * team FK so a pick stays valid if the provider corrects a game's teams — the
 * pick was always "the home side of game X", and spreads are home-relative
 * (arch §Spread strategy), so the side is what scoring needs.
 */
export const PICKEM_PICK_SIDE = {
  HOME: "home",
  AWAY: "away",
} as const;

export type PickemPickSide = (typeof PICKEM_PICK_SIDE)[keyof typeof PICKEM_PICK_SIDE];

export const PickemPickSideSchema = z.enum(PICKEM_PICK_SIDE).openapi("PickemPickSide");
