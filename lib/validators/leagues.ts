import { z } from "zod";

import { pickTypeEnum, seasonFormatEnum } from "@/lib/db/schema/leagues";

export const LEAGUE_NAME_MIN = 3;
export const LEAGUE_NAME_MAX = 50;
export const LEAGUE_SIZE_MIN = 2;
export const LEAGUE_SIZE_MAX = 20;
export const LEAGUE_SIZE_DEFAULT = 10;
export const PICKS_PER_PHASE_MIN = 1;
export const PICKS_PER_PHASE_MAX = 16;
export const PICKS_PER_PHASE_DEFAULT = 5;

const nameSchema = z
  .string()
  .trim()
  .min(LEAGUE_NAME_MIN, `Name must be at least ${LEAGUE_NAME_MIN} characters.`)
  .max(LEAGUE_NAME_MAX, `Name must be at most ${LEAGUE_NAME_MAX} characters.`);

const imageUrlSchema = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(
    z.union([
      z.null(),
      z.string().url("Image URL must be a valid URL.").max(2048),
    ]),
  );

const sizeSchema = z.coerce
  .number({ error: "Size is required." })
  .int("Size must be a whole number.")
  .min(LEAGUE_SIZE_MIN, `Size must be at least ${LEAGUE_SIZE_MIN}.`)
  .max(LEAGUE_SIZE_MAX, `Size must be at most ${LEAGUE_SIZE_MAX}.`);

const picksPerPhaseSchema = z.coerce
  .number({ error: "Picks per phase is required." })
  .int("Picks per phase must be a whole number.")
  .min(PICKS_PER_PHASE_MIN, `Must be at least ${PICKS_PER_PHASE_MIN}.`)
  .max(PICKS_PER_PHASE_MAX, `Must be at most ${PICKS_PER_PHASE_MAX}.`);

export const createLeagueSchema = z.object({
  name: nameSchema,
  imageUrl: imageUrlSchema.optional(),
  seasonFormat: z.enum(seasonFormatEnum.enumValues),
  size: sizeSchema,
  picksPerPhase: picksPerPhaseSchema,
  pickType: z.enum(pickTypeEnum.enumValues),
});

export type CreateLeagueInput = z.input<typeof createLeagueSchema>;
export type CreateLeagueOutput = z.output<typeof createLeagueSchema>;

export const updateLeagueSchema = z.object({
  leagueId: z.string().uuid({ error: "Invalid league id." }),
  name: nameSchema,
  imageUrl: imageUrlSchema.optional(),
  seasonFormat: z.enum(seasonFormatEnum.enumValues),
  size: sizeSchema,
  picksPerPhase: picksPerPhaseSchema,
  pickType: z.enum(pickTypeEnum.enumValues),
});

export type UpdateLeagueInput = z.input<typeof updateLeagueSchema>;
export type UpdateLeagueOutput = z.output<typeof updateLeagueSchema>;

export const deleteLeagueSchema = z.object({
  leagueId: z.string().uuid({ error: "Invalid league id." }),
});

export type DeleteLeagueInput = z.input<typeof deleteLeagueSchema>;

export const SEASON_FORMAT_LABELS: Record<
  (typeof seasonFormatEnum.enumValues)[number],
  string
> = {
  regular_season: "Regular Season",
  postseason: "Postseason",
  full_season: "Full Season",
};

export const PICK_TYPE_LABELS: Record<
  (typeof pickTypeEnum.enumValues)[number],
  string
> = {
  straight_up: "Straight Up",
  against_the_spread: "Against the Spread",
};
