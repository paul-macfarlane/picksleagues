import { z } from "zod";

import { PICKS_PER_PHASE_MAX } from "@/lib/validators/leagues";

const pickSelectionSchema = z.object({
  eventId: z.string().uuid({ error: "Invalid game id." }),
  teamId: z.string().uuid({ error: "Invalid team id." }),
  // The spread the client saw for the picked team at submit time. Optional
  // at the schema level because Straight Up leagues don't use spreads; the
  // action requires it on ATS leagues and rejects with code STALE_ODDS if
  // it's missing or diverges from the current DB spread.
  expectedSpread: z.number().nullable().optional(),
});

export const submitPicksSchema = z.object({
  leagueId: z.string().uuid({ error: "Invalid league id." }),
  phaseId: z.string().uuid({ error: "Invalid phase id." }),
  picks: z
    .array(pickSelectionSchema)
    .min(1, { message: "Pick at least one game." })
    .max(PICKS_PER_PHASE_MAX, {
      message: `No more than ${PICKS_PER_PHASE_MAX} picks per submission.`,
    }),
});

export type SubmitPicksInput = z.input<typeof submitPicksSchema>;
export type SubmitPicksOutput = z.output<typeof submitPicksSchema>;
