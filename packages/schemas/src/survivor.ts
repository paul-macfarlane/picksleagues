import { z } from "@hono/zod-openapi";
import { NullablePickOutcomeSchema } from "./pick-outcome";
import { SlateTeamSchema } from "./slate";

/**
 * Survivor pick entry, the kickoff-gated read path, and the survivor board
 * (spec §Game Mode 2). The slate these picks are made against and the league's
 * week list are mode-agnostic and live in `slate.ts` / `league-weeks.ts`.
 *
 * Two rules shape these types and are worth stating once here:
 * - **Pick visibility is enforced in the query layer** (arch §Locking Model).
 *   Another member's `pick` is null until their game kicks off, while
 *   `hasPicked` stays true — existence is public, the content is not.
 * - **A consumed-team list is only ever derived from picks its reader is
 *   already allowed to see.** The viewer gets their own full ledger; another
 *   member's is built from their revealed picks alone, because a list built
 *   from all of them would disclose the current-week team the rule above
 *   withheld.
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
  })
  .openapi("SubmitSurvivorPickRequest");

export type SubmitSurvivorPickRequest = z.infer<typeof SubmitSurvivorPickRequestSchema>;

export const SurvivorPickSchema = z
  .object({
    id: z.string(),
    weekId: z.string(),
    gameId: z.string(),
    teamId: z.string(),
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

/**
 * Where a member stands in the season. Survivor grades survive-or-eliminate and
 * has no points and no ranked board (ADR-0016), so this — not a position — is
 * what its board reports.
 */
export const SURVIVOR_MEMBER_STATUS = {
  ALIVE: "alive",
  ELIMINATED: "eliminated",
} as const;

export type SurvivorMemberStatus =
  (typeof SURVIVOR_MEMBER_STATUS)[keyof typeof SURVIVOR_MEMBER_STATUS];

export const SurvivorMemberStatusSchema = z
  .enum(SURVIVOR_MEMBER_STATUS)
  .openapi("SurvivorMemberStatus");

/**
 * A week of the board's frame. Deliberately not `LeagueWeek`: that shape
 * carries a `gameCount` the board would have to run a second aggregate to fill
 * and would never render, and the week navigator's needs are not the board's.
 */
export const SurvivorStandingsWeekSchema = z
  .object({
    weekId: z.string(),
    label: z.string(),
  })
  .openapi("SurvivorStandingsWeek");

export type SurvivorStandingsWeek = z.infer<typeof SurvivorStandingsWeekSchema>;

/**
 * One week of a member's history. The entry existing *is* "they picked that
 * week" — a week they missed has none at all, which in this mode is the fact
 * that eliminated them (spec §Game Mode 2 — Missed pick).
 */
export const SurvivorStandingsPickSchema = z
  .object({
    weekId: z.string(),
    /**
     * The viewer's own team always; another member's only once that pick's game
     * has kicked off (spec §Pick Visibility). Null on an entry that exists is
     * the deliberate state: the league sees that someone is in without seeing
     * who they took.
     */
    teamId: z.string().nullable(),
    /**
     * How the pick graded, or null while it has none — a pick whose week the
     * settlement prefix hasn't reached has no result row at all (arch D10), and
     * a pick still withheld by the rule above never carries one on the wire.
     */
    outcome: NullablePickOutcomeSchema,
  })
  .openapi("SurvivorStandingsPick");

export type SurvivorStandingsPick = z.infer<typeof SurvivorStandingsPickSchema>;

export const SurvivorStandingsMemberSchema = z
  .object({
    leagueMemberId: z.string(),
    userId: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    image: z.string().nullable(),
    isViewer: z.boolean(),
    /**
     * Mirrors `eliminatedWeekId` rather than being independent of it — the
     * mode's core rule is that a member is out exactly when settlement has
     * named the week they busted in, and stating it on the wire keeps every
     * client from re-deriving it slightly differently.
     */
    status: SurvivorMemberStatusSchema,
    eliminatedWeekId: z.string().nullable(),
    /**
     * How many times the everyone-out revival rule has brought this member back
     * (spec §Game Mode 2 — Everyone eliminated in the same week). Display only.
     */
    revivedCount: z.number().int(),
    /**
     * Set for every member still alive once the season has concluded. Several
     * at once is not an error: they are co-winners sharing first, and the spec
     * gives no further tiebreaker (spec §End of League).
     */
    isWinner: z.boolean(),
    /** In season order, and only for weeks this member actually picked. */
    picks: z.array(SurvivorStandingsPickSchema),
    /**
     * The teams this member may no longer pick (spec §Game Mode 2 — Team
     * reuse). The viewer's own is their full ledger; another member's is
     * derived from their *revealed* picks alone.
     */
    consumedTeamIds: z.array(z.string()),
  })
  .openapi("SurvivorStandingsMember");

export type SurvivorStandingsMember = z.infer<typeof SurvivorStandingsMemberSchema>;

export const SurvivorStandingsResponseSchema = z
  .object({
    /** The league's in-range weeks in season order — the frame `picks` is indexed by. */
    weeks: z.array(SurvivorStandingsWeekSchema),
    members: z.array(SurvivorStandingsMemberSchema),
    /**
     * Every team named anywhere above, once. A lookup rather than a team
     * inlined per pick: one team recurs across members and weeks, and inlining
     * would multiply its six display fields by both. Nothing appears here that
     * the visibility rules didn't already disclose.
     */
    teams: z.array(SlateTeamSchema),
    /**
     * Whether the last week of the league's resolved range has settled (spec
     * §End of League) — which is what makes the members still alive winners.
     */
    concluded: z.boolean(),
    /**
     * When settlement last wrote this season. The spec requires standings show
     * a "last updated" stamp and never claim real-time freshness — null means
     * nothing has settled yet.
     */
    updatedAt: z.iso.datetime().nullable(),
  })
  .openapi("SurvivorStandingsResponse");

export type SurvivorStandingsResponse = z.infer<typeof SurvivorStandingsResponseSchema>;

/**
 * What the dashboard tells a member about their Survivor week at a glance (spec
 * §Screens — Dashboard). The mode is one pick per week (spec §Game Mode 2 —
 * Core Rules), so a whole week collapses to a single state rather than the
 * picks-in-of-N count a multi-pick mode would need.
 *
 * Two of these carry a rule worth stating where the values live:
 * - `ELIMINATED` outranks every other state. A member settlement has put out
 *   owes no pick, so prompting them for one would be wrong whatever their week
 *   looks like — and they can still hold a pick for it, since elimination is
 *   settled a week behind the pick that caused it.
 * - `LOCKED` means *every* game in the week has kicked off with no pick
 *   standing. Not the first kickoff: a member may take any unstarted game in
 *   the week, so the week closes against them only when none is left (spec
 *   §Game Mode 2 — Core Rules).
 */
export const SURVIVOR_PICK_STATUS = {
  ELIMINATED: "eliminated",
  PICK_IN: "pick_in",
  PICK_NEEDED: "pick_needed",
  LOCKED: "locked",
} as const;

export type SurvivorPickStatus = (typeof SURVIVOR_PICK_STATUS)[keyof typeof SURVIVOR_PICK_STATUS];

const SurvivorPickStatusSchema = z.enum(SURVIVOR_PICK_STATUS).openapi("SurvivorPickStatus");

/**
 * Registered under its own component name rather than wrapped inline: a
 * `.nullable()` applied to the registered node above would fold `null` into
 * that shared component, so the first surface to serialize a non-null status
 * would inherit the widening. Only the nullable form has a caller today, which
 * is why the base stays module-private.
 */
export const NullableSurvivorPickStatusSchema = SurvivorPickStatusSchema.nullable().openapi(
  "NullableSurvivorPickStatus",
);
