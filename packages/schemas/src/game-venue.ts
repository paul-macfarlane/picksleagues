import { z } from "@hono/zod-openapi";

/**
 * Where a game is played, as the provider reports it (FB-46) — display data
 * only. Nothing scores, locks, or settles on it: a neutral-site game still has
 * a designated home team, and the spread stays relative to that team.
 *
 * The address parts are separate rather than one preformatted string so the
 * client decides the phrasing ("Green Bay, WI" at home, "London, England"
 * abroad) and no provider display string leaks past its adapter. `region` is a
 * US state or Canadian province; the provider omits it abroad, which is why it
 * is nullable.
 */
export const GameVenueSchema = z
  .object({
    name: z.string(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    country: z.string().nullable(),
  })
  .openapi("GameVenue");

export type GameVenue = z.infer<typeof GameVenueSchema>;

/**
 * Field-wise rather than a JSON string compare: a JSONB column hands keys back
 * in its own order, so a stringified stored venue need not match an equal
 * fresh one — and the schedule sync would then rewrite every game every run.
 */
export function sameGameVenue(a: GameVenue | null, b: GameVenue | null): boolean {
  if (a === null || b === null) return a === b;
  return a.name === b.name && a.city === b.city && a.region === b.region && a.country === b.country;
}

/**
 * Registered under its own component name so `null` is never folded into the
 * shared `GameVenue` component (engineering rules §Contract & codegen).
 */
export const NullableGameVenueSchema = GameVenueSchema.nullable().openapi("NullableGameVenue");
