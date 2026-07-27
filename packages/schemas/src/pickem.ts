import { z } from "@hono/zod-openapi";
import { MAX_PICKS_PER_WEEK } from "./league-settings";
import { PickemPickSideSchema } from "./pickem-pick-side";

/**
 * Pick'em pick entry, its standings, and the shapes only this mode has (spec
 * §Game Mode 1). The slate these picks are made against and the league's week
 * list are mode-agnostic and live in `slate.ts` / `league-weeks.ts`.
 *
 * Two rules shape these types and are worth stating once here:
 * - **Lock state is derived, never stored** (arch D11). Games carry `locked`
 *   from the slate; there is no column behind it and clients must not cache it
 *   across a session.
 * - **Pick visibility is enforced in the query layer** (arch §Locking Model).
 *   Another member's `picks` array only ever contains games that have kicked
 *   off; `hiddenPickCount` reports how many more they have submitted so the UI
 *   can show "5 picks in" without leaking which games those are.
 */

export const PickemStandingsRowSchema = z
  .object({
    leagueMemberId: z.string(),
    userId: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    image: z.string().nullable(),
    isViewer: z.boolean(),
    points: z.number(),
    /**
     * Cumulative margin differential over the period — the spec's only
     * tiebreaker (§Tiebreakers). Serialized so the UI can show *why* two
     * members on equal points are ordered as they are.
     */
    differential: z.number(),
    /** Members level on points and differential share a rank. */
    rank: z.number().int(),
  })
  .openapi("PickemStandingsRow");

export type PickemStandingsRow = z.infer<typeof PickemStandingsRowSchema>;

export const PickemStandingsResponseSchema = z
  .object({
    /** Null on the season-cumulative board; set on a weekly one. */
    weekId: z.string().nullable(),
    rows: z.array(PickemStandingsRowSchema),
    /**
     * When settlement last wrote this board. The spec requires standings show a
     * "last updated" stamp and never claim real-time freshness — null means
     * nothing has settled yet.
     */
    lastUpdatedAt: z.iso.datetime().nullable(),
  })
  .openapi("PickemStandingsResponse");

export type PickemStandingsResponse = z.infer<typeof PickemStandingsResponseSchema>;

/**
 * Substitutes one pick for another after its game was cancelled or moved out of
 * the week (spec §Cancellations, Postponements & Re-picks).
 *
 * Deliberately not a flag on the batch upsert: that endpoint re-prices *every*
 * unstarted pick on any change, and this rule is its exact inverse — only the
 * replacement accepts a spread, and the member's other picks keep theirs
 * (ADR-0015). One replaces the other rather than adding to it: the push is what
 * the member holds if they do *not* re-pick, so a substitute that stacked on top
 * would hand them more scoring chances than Picks Per Week allows.
 */
export const PickemRepickRequestSchema = z
  .object({
    /** The pick being given up — its game must be cancelled or moved. */
    replacePickId: z.uuid(),
    gameId: z.uuid(),
    side: PickemPickSideSchema,
    /** Required in ATS leagues, and matched against the replacement's current spread only. */
    spread: z.number().nullable().default(null),
  })
  .openapi("PickemRepickRequest");

export type PickemRepickRequest = z.infer<typeof PickemRepickRequestSchema>;

export const PickemPickSubmissionSchema = z
  .object({
    gameId: z.uuid(),
    side: PickemPickSideSchema,
    /**
     * The spread the member is accepting for this pick. Required in ATS leagues
     * and rejected with `spread_stale` (409) when it no longer matches the
     * current number — the "accept the latest spreads on all unstarted picks"
     * rule (spec §ATS spread acceptance). Ignored in straight-up leagues.
     */
    spread: z.number().nullable().default(null),
  })
  .openapi("PickemPickSubmission");

export type PickemPickSubmission = z.infer<typeof PickemPickSubmissionSchema>;

/**
 * Replaces the member's *unstarted* picks for the week wholesale. Picks whose
 * game has already kicked off are immutable and must be omitted — submitting
 * one is a `pick_locked` (409), not a silent no-op, so a stale client learns
 * its slate moved rather than believing an edit landed.
 */
export const SubmitPickemPicksRequestSchema = z
  .object({
    // A structural ceiling only — the per-league cap is enforced server-side
    // against the league's own `picksPerWeek` and the week's actual slate size.
    picks: z.array(PickemPickSubmissionSchema).max(MAX_PICKS_PER_WEEK),
  })
  .openapi("SubmitPickemPicksRequest");

export type SubmitPickemPicksRequest = z.infer<typeof SubmitPickemPicksRequestSchema>;

export const PickemPickSchema = z
  .object({
    id: z.string(),
    gameId: z.string(),
    side: PickemPickSideSchema,
    // The spread of record this pick was locked in against (null in SU leagues).
    spread: z.number().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("PickemPick");

export type PickemPick = z.infer<typeof PickemPickSchema>;

export const PickemMemberPicksSchema = z
  .object({
    leagueMemberId: z.string(),
    userId: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    image: z.string().nullable(),
    isViewer: z.boolean(),
    /**
     * The viewer's own picks in full; another member's only once each game has
     * kicked off (spec §Pick Visibility). Filtered in the query layer.
     */
    picks: z.array(PickemPickSchema),
    // Submitted picks not yet visible to the viewer. Always 0 for the viewer.
    hiddenPickCount: z.number().int(),
  })
  .openapi("PickemMemberPicks");

export type PickemMemberPicks = z.infer<typeof PickemMemberPicksSchema>;

export const PickemWeekPicksResponseSchema = z
  .object({
    weekId: z.string(),
    // The effective cap for this week: min(picksPerWeek, games in the slate) —
    // the spec's "fewer games than Picks Per Week" rule, resolved server-side
    // so the UI never re-derives it.
    picksAllowed: z.number().int(),
    members: z.array(PickemMemberPicksSchema),
  })
  .openapi("PickemWeekPicksResponse");

export type PickemWeekPicksResponse = z.infer<typeof PickemWeekPicksResponseSchema>;
