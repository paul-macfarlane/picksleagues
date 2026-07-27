import { z } from "@hono/zod-openapi";

/**
 * Which side of a game a pick is on. Stored per pick rather than as a team FK
 * so a pick stays valid if the provider corrects a game's teams — the pick was
 * always "the home side of game X", and spreads are home-relative (arch
 * §Spread strategy), so the side is what scoring needs.
 */
export const PICK_SIDE = {
  HOME: "home",
  AWAY: "away",
} as const;

export type PickSide = (typeof PICK_SIDE)[keyof typeof PICK_SIDE];

export const PickSideSchema = z.enum(PICK_SIDE).openapi("PickSide");
