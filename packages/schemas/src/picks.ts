import { z } from "@hono/zod-openapi";
import { GameStatusSchema } from "./game-status";
import { MAX_PICKS_PER_WEEK } from "./league-settings";
import { PickSideSchema } from "./pick-side";
import { WeekTypeSchema } from "./week-type";

/**
 * Pick'em pick entry and the weekly slate it is made against (spec §Game Mode 1).
 *
 * Two rules shape these types and are worth stating once here:
 * - **Lock state is derived, never stored** (arch D11). `locked` is serialized
 *   per game from `effective kickoff <= clock.now()`; there is no column behind
 *   it and clients must not cache it across a session.
 * - **Pick visibility is enforced in the query layer** (arch §Locking Model).
 *   Another member's `picks` array only ever contains games that have kicked
 *   off; `hiddenPickCount` reports how many more they have submitted so the UI
 *   can show "5 picks in" without leaking which games those are.
 */

export const SlateTeamSchema = z
  .object({
    id: z.string(),
    abbreviation: z.string(),
    name: z.string(),
    location: z.string().nullable(),
    logoLightUrl: z.string().nullable(),
    logoDarkUrl: z.string().nullable(),
  })
  .openapi("SlateTeam");

export type SlateTeam = z.infer<typeof SlateTeamSchema>;

export const SlateGameSchema = z
  .object({
    id: z.string(),
    homeTeam: SlateTeamSchema,
    awayTeam: SlateTeamSchema,
    // Every field below is override-resolved (`override_* ?? provider_*`,
    // arch D15) — the client never sees the provider/override split.
    kickoffAt: z.iso.datetime(),
    status: GameStatusSchema,
    homeScore: z.number().int().nullable(),
    awayScore: z.number().int().nullable(),
    // Home-relative; negative = home favored. Null until the odds sync captures
    // a snapshot, and in straight-up leagues it is simply unused.
    spread: z.number().nullable(),
    // Derived per request from the injected Clock — not stored (arch D11).
    locked: z.boolean(),
    /**
     * Whether a new pick may be placed here. False for cancelled and moved
     * games: they still appear on the slate (so a member can see why a pick
     * pushed) but settle as a push, so accepting a fresh pick would mint free
     * points. Such games are also excluded from `picksAllowed`.
     */
    pickable: z.boolean(),
  })
  .openapi("SlateGame");

export type SlateGame = z.infer<typeof SlateGameSchema>;

export const WeekSlateResponseSchema = z
  .object({
    weekId: z.string(),
    weekType: WeekTypeSchema,
    weekNumber: z.number().int(),
    label: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    games: z.array(SlateGameSchema),
  })
  .openapi("WeekSlateResponse");

export type WeekSlateResponse = z.infer<typeof WeekSlateResponseSchema>;

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

export const PickemPickSubmissionSchema = z
  .object({
    gameId: z.uuid(),
    side: PickSideSchema,
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
    side: PickSideSchema,
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
