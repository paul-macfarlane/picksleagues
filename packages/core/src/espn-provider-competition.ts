import { z } from "zod";
import type { GameVenue } from "@picksleagues/schemas";

/**
 * Parts of ESPN's scoreboard competition that decide which teams play and
 * where. Split from `espn-provider.ts` purely by size — the same adapter
 * boundary (engineering rules: "provider shapes never leak"), and nothing here
 * is imported outside it and its tests.
 */

// FB-46. Absent, null, or malformed all read as "no venue" (`.catch`): the
// scoreboard parse is strict and shared with the score and odds syncs, so a
// display-only field ESPN reshapes must never fail a week's ingestion.
const EspnVenueSchema = z
  .looseObject({
    fullName: z.string(),
    address: z
      .looseObject({
        city: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
      })
      .optional(),
  })
  .optional()
  .catch(undefined);

/** ESPN sends `""` for an unknown address part as readily as it omits it. */
function presentOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapVenue(venue: z.infer<typeof EspnVenueSchema>): GameVenue | null {
  const name = presentOrNull(venue?.fullName);
  if (!venue || name === null) return null;
  return {
    name,
    city: presentOrNull(venue.address?.city),
    region: presentOrNull(venue.address?.state),
    country: presentOrNull(venue.address?.country),
  };
}

/** Spread into ESPN's competition schema: where the game is played. */
export const EspnSiteFields = {
  neutralSite: z.boolean().optional().catch(undefined),
  venue: EspnVenueSchema,
};

export function mapEspnSite(competition: {
  neutralSite?: boolean;
  venue?: z.infer<typeof EspnVenueSchema>;
}): { neutralSite: boolean; venue: GameVenue | null } {
  return { neutralSite: competition.neutralSite ?? false, venue: mapVenue(competition.venue) };
}

/**
 * ESPN publishes an unseeded playoff round months ahead as real events whose
 * competitors are a shared placeholder: `team.id` `-1`/`-2`, abbreviation
 * `TBD`. Both signals are checked because either alone identifies today's
 * encoding while neither can match a real team — ESPN's team ids are positive
 * and no real abbreviation is `TBD` — so the redundancy costs nothing and
 * survives ESPN changing one of them. A non-numeric id is not a placeholder:
 * `Number` yields NaN, which is not finite.
 */
export function isPlaceholderCompetitor(competitor: {
  team: { id: string; abbreviation: string };
}): boolean {
  const providerId = Number(competitor.team.id);
  return (
    (Number.isFinite(providerId) && providerId < 0) ||
    competitor.team.abbreviation.toUpperCase() === "TBD"
  );
}
