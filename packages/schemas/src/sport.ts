import { z } from "@hono/zod-openapi";

/** Sports with seasons in `sport_seasons` (arch §Domain Model: NFL 2026, NCAAMB 2027, …). */
export const SPORT = {
  NFL: "nfl",
  NCAAMB: "ncaamb",
} as const;

export type Sport = (typeof SPORT)[keyof typeof SPORT];

export const SportSchema = z.enum(SPORT).openapi("Sport");
