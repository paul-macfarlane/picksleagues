import { z } from "@hono/zod-openapi";
import { MAX_PICKS_PER_WEEK } from "./league-settings";
import { PICK_TYPE, type PickType } from "./pick-type";
import { NullablePickOutcomeSchema } from "./pick-outcome";
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
     * The member's settled record over the period — how many picks resolved
     * correct, incorrect, and push. Display only: points are the sole ordering
     * input (ADR-0018), so a better record never changes an ordering.
     */
    wins: z.number().int(),
    losses: z.number().int(),
    pushes: z.number().int(),
    /** Members level on points share a rank; the next rank skips. */
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
 * The viewer's own line of the season-cumulative board, carried on every
 * league read (spec §Screens — Dashboard; ADR-0043 §2: the band names the
 * subject and the viewer's place in it). The league header and the hub card
 * render rank and record from the DTO they already hold, so neither pays a
 * standings fetch per league to show two numerals.
 *
 * `rankShared` travels with the rank because the board's "T-3" needs the whole
 * board to compute (`sharedRankCounts`) and a card holds only its own line.
 */
export const PickemViewerStandingSchema = z
  .object({
    rank: z.number().int(),
    /** Whether at least one other member holds the same rank (spec §Standings — Ties). */
    rankShared: z.boolean(),
    points: z.number(),
    wins: z.number().int(),
    losses: z.number().int(),
    pushes: z.number().int(),
  })
  .openapi("PickemViewerStanding");

export type PickemViewerStanding = z.infer<typeof PickemViewerStandingSchema>;

/**
 * Own component name, never an inline `.nullable()` on the registered schema
 * above — the wrapper would inherit the registration and fold `null` into the
 * shared component.
 */
export const NullablePickemViewerStandingSchema = PickemViewerStandingSchema.nullable().openapi(
  "NullablePickemViewerStanding",
);

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
 * How many picks a week's submission must contain: a full set of what can
 * **still** be picked (ADR-0018 decision 2). Shared by the API's write path,
 * which sizes the submission it accepts, and the web sheet, which enables
 * Submit on the same number — one rule, so the two surfaces can never disagree
 * about what "complete" means (the `pickemSettingsInvalidatePicks` precedent).
 *
 * **The required set is exactly what the write path would accept.** Anything it
 * refuses on sight is not part of the set, because a set containing a refusable
 * pick is a set no member can ever submit. Two things make a game refusable
 * before it is even chosen, and they are the same rule wearing two faces:
 *
 * - **It has kicked off.** `picksAllowed` is `min(picksPerWeek, pickable games)`
 *   and `pickable` does not exclude a game that has already started, so
 *   requiring `picksAllowed` would ask a member arriving after the week's first
 *   kickoff for more picks than the slate can still supply. Games that locked
 *   before they submitted are forgone; they were never picks, so nothing scores.
 * - **It has no line, in an ATS league.** `checkSpreadAccepted` refuses a pick
 *   on an unpriced game with `spread_unavailable`, so counting it would demand a
 *   pick the same request then rejects: submit the full set and it is refused
 *   for the unpriced game, submit the rest and it is `pick_set_incomplete`.
 *   Straight-up leagues have no spread dependency, so `spread` is ignored there
 *   and an unpriced game counts normally.
 *
 * Both exclusions serve one purpose: **a member must never be unable to submit
 * a week at all.** That is the outcome ADR-0018 decision 2 was ruled to prevent,
 * and it does not care whether the games it cannot supply are missing because
 * they started or because they carry no number yet.
 *
 * **Why the two call sites pass different caps and still agree.** The API
 * passes `settings.picksPerWeek`; the web passes the wire's `picksAllowed`,
 * which is itself `min(picksPerWeek, pickable)`. The count filtered here is
 * never larger than the pickable count — it is that count with rows removed —
 * so `min(min(p, pickable), submittable) === min(p, submittable)`, and the extra
 * `pickable` clamp the web's cap carries can never bind first. Neither call site
 * is wrong. Adding the spread filter does not disturb this: it only removes more
 * rows.
 */
export function requiredPickemPickCount(
  cap: number,
  games: readonly { locked: boolean; pickable: boolean; spread: number | null }[],
  pickType: PickType,
): number {
  const needsSpread = pickType === PICK_TYPE.AGAINST_THE_SPREAD;
  const submittable = games.filter(
    (game) => !game.locked && game.pickable && (!needsSpread || game.spread !== null),
  );
  return Math.min(cap, submittable.length);
}

/**
 * The member's one submission for the week (ADR-0018 decision 1). It must be
 * the full required set — `requiredPickemPickCount` above — and it can never be
 * edited, replaced, or added to: a second call is `already_submitted` (409),
 * a short set `pick_set_incomplete` (400), a long one `too_many_picks` (400).
 * A game that has already kicked off is `pick_locked` (409) rather than a
 * silent no-op, so a stale client learns its slate moved instead of believing
 * its sheet landed.
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
    /**
     * The book that spread came from (PKM-9), read from the game row's frozen
     * `spread_source` rather than a copy on the pick itself — freezing the
     * source alongside the last-priced number is what keeps the credit correct
     * on a submitted week whose game is long final. Null whenever `spread` above
     * is — there is no number to attribute, which is every pick in a straight-up
     * league.
     */
    spreadSource: z.string().nullable(),
    /**
     * How this pick graded, or null while it has none — a pick whose game
     * hasn't reached a terminal state has no result row at all (arch D10:
     * results are a pure derivation). Null is therefore "not settled yet", not
     * "settled as nothing", and the UI must not render it as an outcome.
     */
    outcome: NullablePickOutcomeSchema,
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
    // so the UI never re-derives it. It is the *cap*, not the size a submission
    // must be: that is `requiredPickemPickCount(picksAllowed, slate)`, which
    // also excludes games that have since kicked off.
    picksAllowed: z.number().int(),
    members: z.array(PickemMemberPicksSchema),
    /**
     * Whether the requested week is inside the *viewer's* pick window (spec
     * §Game Mode 1 — Pick window; ADR-0036). False only for weeks *ahead* of
     * the window — beyond the current week, and not yet unlocked by every game
     * in the viewer's current-week submission going terminal. A past week
     * reports true: its pickability is entirely the per-game kickoff locks'
     * story, and reporting it closed had the UI calling completed weeks "not
     * open yet". Server-computed so the UI never re-derives the window — a
     * client-side copy would drift from the write path's refusal, and under
     * the simulator would be derived at the wrong instant.
     */
    pickWindowOpen: z.boolean(),
  })
  .openapi("PickemWeekPicksResponse");

export type PickemWeekPicksResponse = z.infer<typeof PickemWeekPicksResponseSchema>;

/**
 * How much a Pick'em settings edit would destroy — the settings editor's
 * pre-save warning input (spec §Commissioner Powers). `memberCount` is the
 * number of distinct members holding at least one pick, not the league's roster
 * size, so "N members lose picks" reads accurately even when some members
 * haven't picked yet.
 *
 * Named for its mode because Pick'em is the only mode that asks the question.
 * It briefly carried a mode-agnostic name while Survivor had a settings change
 * that stranded picks; ADR-0026 removed Survivor's Pick Type, and with it the
 * only such change a Survivor commissioner could make in the form, so that
 * mode's summary endpoint went away with it.
 */
export const PickemPickSummarySchema = z
  .object({
    pickCount: z.number().int(),
    memberCount: z.number().int(),
  })
  .openapi("PickemPickSummary");

export type PickemPickSummary = z.infer<typeof PickemPickSummarySchema>;

/**
 * The viewer's own Pick'em week at a glance (spec §Screens — Dashboard). Its
 * own state set rather than a widened shared one, because a Pick'em week is a
 * different object from a Survivor week: N picks committed as **one atomic,
 * immutable submission** (ADR-0018), not one pick a member may change until
 * kickoff. Holding any pick for the week is therefore the whole of "submitted";
 * there is no partial state to name.
 *
 * The order the states are asked in, and why:
 * - `SEASON_COMPLETE` comes first, from the league season's stored ending
 *   (ADR-0030). The current-week resolution falls back to the last week played,
 *   so without this a finished league would report that week's state forever —
 *   "Picks in" about a season nobody can act on.
 * - `LOCKED` means no picks stand and no game in the week is still open to one.
 *   Not the first kickoff: a member arriving mid-week submits a smaller set of
 *   what is left (`requiredPickemPickCount`), so the week closes against them
 *   only when nothing pickable remains.
 */
export const PICKEM_PICK_STATUS = {
  SEASON_COMPLETE: "season_complete",
  PICKS_IN: "picks_in",
  PICKS_NEEDED: "picks_needed",
  LOCKED: "locked",
} as const;

export type PickemPickStatus = (typeof PICKEM_PICK_STATUS)[keyof typeof PICKEM_PICK_STATUS];

const PickemPickStatusSchema = z.enum(PICKEM_PICK_STATUS).openapi("PickemPickStatus");

/**
 * Registered under its own component name rather than wrapped inline, for the
 * reason `NullableSurvivorPickStatus` is: a `.nullable()` on the registered
 * node above would fold `null` into that shared component and widen every
 * future `$ref` to it.
 */
export const NullablePickemPickStatusSchema = PickemPickStatusSchema.nullable().openapi(
  "NullablePickemPickStatus",
);
