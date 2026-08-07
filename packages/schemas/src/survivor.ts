import { z } from "@hono/zod-openapi";

/**
 * Survivor pick entry and the kickoff-gated read path (spec §Game Mode 2). The
 * slate these picks are made against and the league's week list are
 * mode-agnostic and live in `slate.ts` / `league-weeks.ts`.
 *
 * Two rules shape these types and are worth stating once here:
 * - **Pick visibility is enforced in the query layer** (arch §Locking Model).
 *   Another member's `pick` is null until their game kicks off, while
 *   `hasPicked` stays true — existence is public, the content is not.
 * - **`consumedTeamIds` is the viewer's own ledger**, never anyone else's:
 *   which teams another member has burned is exactly the information the
 *   visibility rule withholds.
 */

/**
 * The member's one pick for a week. Upserted, not appended: the spec allows a
 * pick to be changed until the picked game's kickoff, so a second submission
 * for the same week replaces the first (this is *not* Pick'em's one-immutable-
 * submission semantic, ADR-0018).
 */
export const SubmitSurvivorPickRequestSchema = z
  .object({
    gameId: z.uuid(),
    /** Must be one of the game's two teams, and must not already be consumed. */
    teamId: z.uuid(),
    /**
     * The spread the member is accepting for this pick — same name, same
     * nullability, and same rule as `PickemPickSubmission.spread` so the two
     * modes cannot disagree about what "the spread I accepted" means on the
     * wire. Required in ATS leagues and refused with `spread_stale` (409) when
     * it no longer matches the current number; ignored in straight-up leagues.
     */
    spread: z.number().nullable().default(null),
  })
  .openapi("SubmitSurvivorPickRequest");

export type SubmitSurvivorPickRequest = z.infer<typeof SubmitSurvivorPickRequestSchema>;

export const SurvivorPickSchema = z
  .object({
    id: z.string(),
    weekId: z.string(),
    gameId: z.string(),
    teamId: z.string(),
    /** The spread of record this pick was locked in against (null in SU leagues). */
    spreadAtPick: z.number().nullable(),
  })
  .openapi("SurvivorPick");

export type SurvivorPick = z.infer<typeof SurvivorPickSchema>;

// Registered under its own component name rather than wrapped inline: reusing
// the registered `SurvivorPick` node here would fold `null` into that shared
// component and widen every other reference to it.
const NullableSurvivorPickSchema = SurvivorPickSchema.nullable().openapi("NullableSurvivorPick");

export const SurvivorMemberPickSchema = z
  .object({
    leagueMemberId: z.string(),
    userId: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    image: z.string().nullable(),
    isViewer: z.boolean(),
    /**
     * Whether this member has a pick for the week at all. True alongside a null
     * `pick` is the deliberate state: the league can see that someone is in
     * without seeing who they took (spec §Pick Visibility).
     */
    hasPicked: z.boolean(),
    /** The viewer's own pick always; another member's only once its game has kicked off. */
    pick: NullableSurvivorPickSchema,
    /**
     * Whether settlement has eliminated this member. Eliminated members stay in
     * the league with full pick visibility (spec §Game Mode 2 — Core Rules).
     */
    eliminated: z.boolean(),
  })
  .openapi("SurvivorMemberPick");

export type SurvivorMemberPick = z.infer<typeof SurvivorMemberPickSchema>;

export const SurvivorWeekPicksResponseSchema = z
  .object({
    members: z.array(SurvivorMemberPickSchema),
    /**
     * The teams the *viewer* has already burned and may not pick again (spec
     * §Game Mode 2 — Team reuse), excluding the week being requested: this
     * week's own pick is the one they are still allowed to change, so listing
     * it would have the UI disable the team they currently hold.
     */
    consumedTeamIds: z.array(z.string()),
  })
  .openapi("SurvivorWeekPicksResponse");

export type SurvivorWeekPicksResponse = z.infer<typeof SurvivorWeekPicksResponseSchema>;
