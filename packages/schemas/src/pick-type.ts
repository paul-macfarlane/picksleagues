import { z } from "@hono/zod-openapi";

/**
 * Straight Up vs Against the Spread — a league-level setting for both NFL
 * modes that applies to every pick all season (spec §League Settings for
 * Pick'em and Elimination). Consumed by the scoring functions.
 */
export const PICK_TYPE = {
  STRAIGHT_UP: "straight_up",
  AGAINST_THE_SPREAD: "against_the_spread",
} as const;

export type PickType = (typeof PICK_TYPE)[keyof typeof PICK_TYPE];

export const PickTypeSchema = z.enum(PICK_TYPE).openapi("PickType");
