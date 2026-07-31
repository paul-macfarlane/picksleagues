import { z } from "@hono/zod-openapi";
import { WeekTypeSchema } from "./week-type";

/**
 * The weeks a league plays — mode-agnostic: every NFL mode clips its season's
 * weeks to a configured Start/End Week and needs the same week navigator.
 */

export const LeagueWeekSchema = z
  .object({
    id: z.string(),
    weekType: WeekTypeSchema,
    weekNumber: z.number().int(),
    label: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    // Zero means the schedule sync hasn't populated the week yet — the UI
    // shows it but there is nothing to pick.
    gameCount: z.number().int(),
  })
  .openapi("LeagueWeek");

export type LeagueWeek = z.infer<typeof LeagueWeekSchema>;

export const LeagueWeeksResponseSchema = z
  .object({
    // The league's season weeks clipped to its configured Start/End Week.
    weeks: z.array(LeagueWeekSchema),
    /**
     * Where a member lands by default: the week in progress, else the next to
     * start, else the last played. Derived from the Clock per request, never
     * stored (arch D11). Null only when the league has no weeks yet.
     */
    currentWeekId: z.string().nullable(),
  })
  .openapi("LeagueWeeksResponse");

export type LeagueWeeksResponse = z.infer<typeof LeagueWeeksResponseSchema>;
