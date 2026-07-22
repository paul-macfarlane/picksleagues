import { z } from "@hono/zod-openapi";

/**
 * Which portion of a sport's season a week belongs to. NFL ingestion spans
 * both the regular season (ESPN `types/2`) and the postseason (`types/3`);
 * week numbers restart at 1 within each type, so this discriminates them
 * (weeks are unique per `(season, week_type, week_number)`).
 */
export const WEEK_TYPE = {
  REGULAR: "regular",
  POSTSEASON: "postseason",
} as const;

export type WeekType = (typeof WEEK_TYPE)[keyof typeof WEEK_TYPE];

export const WeekTypeSchema = z.enum(WEEK_TYPE).openapi("WeekType");
