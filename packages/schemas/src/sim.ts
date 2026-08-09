import { z } from "@hono/zod-openapi";
import { GAME_STATUS, GameStatusSchema } from "./game-status";
import { LEAGUE_MODE } from "./league-mode";
import { SportSchema } from "./sport";
import { SurvivorMemberStatusSchema } from "./survivor";
import { WeekTypeSchema } from "./week-type";

/**
 * The season simulator's wire contract (spec §Testing & Internal Tooling; arch
 * §Simulator & Time; ADR-0011/ADR-0012/ADR-0014). Gated by `isSimEnabled`
 * (`APP_ENV !== production && SIM_ENABLED`, with production a hard override
 * regardless of the flag) — these routes are not registered where that's
 * false, so nothing here reaches a prod client.
 */

/**
 * Where a scenario's fixtures came from. `library` scenarios are the canned
 * edge cases defined in code; `replay` scenarios are imported from a real past
 * ESPN season. The distinction is operator-facing (a replay can be re-imported
 * from the provider, a library scenario is reloaded from its definition) and
 * decides which reload path the control panel offers.
 */
export const SIM_SCENARIO_SOURCE = {
  LIBRARY: "library",
  REPLAY: "replay",
} as const;

export type SimScenarioSource = (typeof SIM_SCENARIO_SOURCE)[keyof typeof SIM_SCENARIO_SOURCE];

export const SimScenarioSourceSchema = z.enum(SIM_SCENARIO_SOURCE).openapi("SimScenarioSource");

/**
 * The statuses a fixture can *end* in — a strict subset of `GAME_STATUS`,
 * derived from it so the two can't drift. `scheduled`/`in_progress` are excluded
 * because they are transient states the provider derives from the simulated
 * clock, never a terminal outcome. A game changing weeks is expressed by the
 * fixture's `weekNumber`, not by a status (ADR-0019).
 */
export const SIM_FINAL_STATUS = {
  FINAL: GAME_STATUS.FINAL,
  CANCELLED: GAME_STATUS.CANCELLED,
  POSTPONED: GAME_STATUS.POSTPONED,
} as const;

export type SimFinalStatus = (typeof SIM_FINAL_STATUS)[keyof typeof SIM_FINAL_STATUS];

export const SimFinalStatusSchema = z.enum(SIM_FINAL_STATUS).openapi("SimFinalStatus");

export const SimScenarioSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    sport: SportSchema,
    seasonYear: z.number().int(),
    source: SimScenarioSourceSchema,
    // The instant the simulated clock is positioned to when this scenario loads
    // (ADR-0012): a replay of a past season is meaningless if `now` is already
    // past every kickoff.
    startsAt: z.iso.datetime(),
    gameCount: z.number().int(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("SimScenario");

export type SimScenario = z.infer<typeof SimScenarioSchema>;

/** A library scenario that exists as a code definition but has no fixtures written yet. */
export const SimLibraryEntrySchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    sport: SportSchema,
    // What the scenario is for — which spec rule or edge case it reproduces.
    covers: z.string(),
  })
  .openapi("SimLibraryEntry");

export type SimLibraryEntry = z.infer<typeof SimLibraryEntrySchema>;

export const SimClockStateSchema = z
  .object({
    // What `clock.now()` returns everywhere in the app right now.
    now: z.iso.datetime(),
    // Real wall-clock time, so the panel can show how far the simulation is shifted.
    realNow: z.iso.datetime(),
    offsetMs: z.number().int(),
  })
  .openapi("SimClockState");

export type SimClockState = z.infer<typeof SimClockStateSchema>;

// Registered under its own component name for the same reason as
// `NullableUsername` (me.ts): `.nullable()` on an already-registered node folds
// `null` into that shared component, and the first registration wins — which
// silently widened `scenarios[]` below to `(SimScenario | null)[]` in the
// generated client.
const NullableSimScenarioSchema = SimScenarioSchema.nullable().openapi("NullableSimScenario");

export const SimStateResponseSchema = z
  .object({
    clock: SimClockStateSchema,
    // Null when no scenario is loaded — the provider then serves real ESPN data,
    // which is the default in every environment (arch §Environments).
    activeScenario: NullableSimScenarioSchema,
    // Scenarios with fixtures written, loadable immediately.
    scenarios: z.array(SimScenarioSchema),
    // Canned definitions available to load, whether or not fixtures exist yet.
    library: z.array(SimLibraryEntrySchema),
    // The newest season `isReplayableSeasonYear` will accept (replay.ts). Served
    // rather than derived client-side: whether a season has *finished* is a
    // calendar rule owned by `latestCompletedNflSeasonYear` in packages/core,
    // which the browser bundle can't import — a restated copy would drift and
    // offer the control panel a year the import then rejects. (Deriving it from
    // `nflSeasonYearFor` instead is the exact bug this field was corrected for:
    // that answers "which season are we in", not "which have ended".)
    latestReplayableSeasonYear: z.number().int(),
  })
  .openapi("SimStateResponse");

export type SimStateResponse = z.infer<typeof SimStateResponseSchema>;

/**
 * Where a week-anchored clock jump lands. `before_first_kickoff` is the
 * pick-testing anchor (everything in the week still open); `after_last_game` is
 * the settlement anchor (nothing left to be played — cancelled and postponed
 * games keep their own status rather than reading final). Both resolve against
 * our own ingested `games` rows, never the provider (engineering rules: request
 * paths never call ESPN), so re-run the schedule sync after editing fixtures and
 * before jumping.
 */
export const SIM_CLOCK_ANCHOR = {
  WEEK_START: "week_start",
  BEFORE_FIRST_KICKOFF: "before_first_kickoff",
  AFTER_LAST_GAME: "after_last_game",
} as const;

export type SimClockAnchor = (typeof SIM_CLOCK_ANCHOR)[keyof typeof SIM_CLOCK_ANCHOR];

export const SimClockAnchorSchema = z.enum(SIM_CLOCK_ANCHOR).openapi("SimClockAnchor");

/** How a clock adjustment is expressed — the discriminant of the union below. */
export const SIM_CLOCK_ADJUSTMENT_KIND = {
  INSTANT: "instant",
  ADVANCE: "advance",
  WEEK: "week",
  RESET: "reset",
} as const;

export type SimClockAdjustmentKind =
  (typeof SIM_CLOCK_ADJUSTMENT_KIND)[keyof typeof SIM_CLOCK_ADJUSTMENT_KIND];

// Ten years each way: enough to reach any season the app will ever replay, tight
// enough that a units mix-up (seconds passed as ms) is rejected rather than
// silently launching the clock past every timestamp in the database.
const MAX_ADVANCE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * A discriminated union rather than a bag of optional fields: each adjustment
 * kind needs different inputs, and an exhaustive `switch` in the service is what
 * makes TypeScript prove every kind is handled.
 */
export const SimClockAdjustmentSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal(SIM_CLOCK_ADJUSTMENT_KIND.INSTANT),
      instant: z.iso.datetime(),
    }),
    z.object({
      kind: z.literal(SIM_CLOCK_ADJUSTMENT_KIND.ADVANCE),
      ms: z.number().int().min(-MAX_ADVANCE_MS).max(MAX_ADVANCE_MS),
    }),
    z.object({
      kind: z.literal(SIM_CLOCK_ADJUSTMENT_KIND.WEEK),
      weekId: z.uuid(),
      anchor: SimClockAnchorSchema,
    }),
    // Back to real time — the simulator's "off" switch for the clock alone,
    // leaving any loaded scenario in place.
    z.object({ kind: z.literal(SIM_CLOCK_ADJUSTMENT_KIND.RESET) }),
  ])
  .openapi("SimClockAdjustment");

export type SimClockAdjustment = z.infer<typeof SimClockAdjustmentSchema>;

export const SimFixtureGameSchema = z
  .object({
    id: z.string(),
    scenarioId: z.string(),
    providerGameId: z.string(),
    weekType: WeekTypeSchema,
    weekNumber: z.number().int(),
    homeTeamAbbr: z.string(),
    homeTeamName: z.string(),
    awayTeamAbbr: z.string(),
    awayTeamName: z.string(),
    kickoffAt: z.iso.datetime(),
    // Home-team-relative, matching `games.spread` (negative = home favored).
    spread: z.number().nullable(),
    // The fixture's terminal truth. The provider reports `scheduled`/`in_progress`
    // instead until the simulated clock passes this game (ADR-0012), so these are
    // what the game *will* end as, not what a caller sees today.
    finalStatus: SimFinalStatusSchema,
    finalHomeScore: z.number().int().nullable(),
    finalAwayScore: z.number().int().nullable(),
    // What the provider reports at the current simulated now — the projection the
    // sync jobs would ingest if run this instant. Serialized so an operator can see
    // the clock's effect without re-deriving the rule client-side.
    projectedStatus: GameStatusSchema,
    projectedHomeScore: z.number().int().nullable(),
    projectedAwayScore: z.number().int().nullable(),
  })
  .openapi("SimFixtureGame");

export type SimFixtureGame = z.infer<typeof SimFixtureGameSchema>;

export const SimFixtureGamesResponseSchema = z
  .object({ games: z.array(SimFixtureGameSchema) })
  .openapi("SimFixtureGamesResponse");

export type SimFixtureGamesResponse = z.infer<typeof SimFixtureGamesResponseSchema>;

/**
 * Hand-editing one fixture game (spec §Testing: "load or hand-edit game
 * outcomes"). Every field optional and at least one required — the same
 * partial-update shape as `UpdateMeRequest`. Scores are nullable so an operator
 * can walk a game back to "no result yet".
 */
export const UpdateSimFixtureGameRequestSchema = z
  .object({
    kickoffAt: z.iso.datetime().optional(),
    weekType: WeekTypeSchema.optional(),
    weekNumber: z.number().int().min(1).max(18).optional(),
    spread: z.number().nullable().optional(),
    finalStatus: SimFinalStatusSchema.optional(),
    finalHomeScore: z.number().int().min(0).max(200).nullable().optional(),
    finalAwayScore: z.number().int().min(0).max(200).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one field is required",
  })
  .openapi("UpdateSimFixtureGameRequest");

export type UpdateSimFixtureGameRequest = z.infer<typeof UpdateSimFixtureGameRequestSchema>;

/**
 * How much a reset wipes (spec §Testing: "wipe a test league or the whole
 * environment"). `league` clears one league's own rows and nothing else.
 * `environment` clears all league data plus all ingested sports data — seasons,
 * weeks, and games (which carry the current spread since SIMP-7) — keeping only
 * `teams`, which ingestion re-links rather than recreates. Neither scope touches users, sessions, or
 * accounts: a reset that signed the operator out would be unusable.
 *
 * An environment reset also rewinds the simulated clock to the active scenario's
 * start, so the wiped season re-ingests as an unplayed one. Without that, every
 * game would come back already final and its spreads would be unrecoverable —
 * the odds sync only prices games that haven't kicked off.
 */
export const SIM_RESET_SCOPE = {
  LEAGUE: "league",
  ENVIRONMENT: "environment",
} as const;

export const SimResetRequestSchema = z
  .discriminatedUnion("scope", [
    z.object({ scope: z.literal(SIM_RESET_SCOPE.LEAGUE), leagueId: z.uuid() }),
    z.object({
      scope: z.literal(SIM_RESET_SCOPE.ENVIRONMENT),
      // Whether to also delete the *active* scenario's fixtures and return the
      // clock to real time. Off by default: the common reset is "same scenario,
      // clean slate", not "start over from nothing". Other stored scenarios are
      // never touched — an imported season costs a full provider crawl.
      dropScenario: z.boolean().default(false),
    }),
  ])
  .openapi("SimResetRequest");

export type SimResetRequest = z.infer<typeof SimResetRequestSchema>;

export const SimResetResponseSchema = z
  .object({
    scope: z.enum(SIM_RESET_SCOPE),
    // Per-table row counts, so an operator can see the reset actually did something.
    deleted: z.record(z.string(), z.number().int()),
    state: SimStateResponseSchema,
  })
  .openapi("SimResetResponse");

export type SimResetResponse = z.infer<typeof SimResetResponseSchema>;

/**
 * Importing a real past season for replay (SIM-6). Bounded to seasons ESPN
 * actually has: the lower bound is well before ESPN's useful NFL coverage, and
 * the upper bound is checked against the simulated clock in the service (a
 * future season has no results to replay).
 */
export const SimReplayRequestSchema = z
  .object({ seasonYear: z.number().int().min(2000).max(2100) })
  .openapi("SimReplayRequest");

export type SimReplayRequest = z.infer<typeof SimReplayRequestSchema>;

/**
 * Step-through settlement (SIM-5; spec §Testing & Internal Tooling: "trigger
 * settlement per simulated week and inspect resulting pick outcomes and
 * standings at each step"). Omitted `leagueId` settles every active league
 * season (mirrors the nightly sweep, arch D10); a supplied one scopes to that
 * league's current season instance (ADR-0009).
 */
export const SimSettleRequestSchema = z
  .object({ leagueId: z.uuid().optional() })
  .openapi("SimSettleRequest");

export type SimSettleRequest = z.infer<typeof SimSettleRequestSchema>;

/**
 * Counters from `SettlementSummary` (apps/api settlement service) — mirrored
 * here rather than shared, since that type lives in the API's service layer
 * and this is the wire contract for it.
 */
export const SimSettlementSummarySchema = z
  .object({
    leagueSeasons: z.number().int(),
    weeks: z.number().int(),
    results: z.number().int(),
    unsettled: z.number().int(),
    /** League seasons whose settlement threw — see the `settle-sweep.season-failed` logs. */
    failed: z.number().int(),
  })
  .openapi("SimSettlementSummary");

export type SimSettlementSummary = z.infer<typeof SimSettlementSummarySchema>;

/** One standings row, as stored on `pickem_standings` joined to its member's identity. */
export const SimSettlePickemStandingsRowSchema = z
  .object({
    leagueMemberId: z.string(),
    // Null for deleted accounts and never-claimed edge states — same shape as
    // `LeagueMember.username`.
    username: z.string().nullable(),
    displayName: z.string(),
    points: z.number(),
    rank: z.number().int(),
  })
  .openapi("SimSettlePickemStandingsRow");

export type SimSettlePickemStandingsRow = z.infer<typeof SimSettlePickemStandingsRowSchema>;

/**
 * The week identity every mode's per-week entry carries, plus the count of that
 * mode's own result rows for it. Shared because it is genuinely mode-agnostic —
 * which week, and how much of it graded — while what settling the week *decided*
 * is each mode's own and lives in the arms below.
 */
const simSettleWeekIdentity = {
  weekId: z.string(),
  label: z.string(),
  weekType: WeekTypeSchema,
  weekNumber: z.number().int(),
  results: z.number().int(),
};

/** One league-week's Pick'em board, restricted to weeks that actually settled results. */
export const SimSettlePickemWeekResultSchema = z
  .object({
    ...simSettleWeekIdentity,
    standings: z.array(SimSettlePickemStandingsRowSchema),
  })
  .openapi("SimSettlePickemWeekResult");

export type SimSettlePickemWeekResult = z.infer<typeof SimSettlePickemWeekResultSchema>;

/**
 * One member's place in Survivor's ledger, as stored on `survivor_state` joined
 * to their identity. A member settlement has decided nothing about has no row at
 * all (ADR-0025) and is reported here as alive with a full life — absence is the
 * untouched state, never an error.
 */
export const SimSettleSurvivorMemberRowSchema = z
  .object({
    leagueMemberId: z.string(),
    // Null for deleted accounts and never-claimed edge states — same shape as
    // `LeagueMember.username`.
    username: z.string().nullable(),
    displayName: z.string(),
    status: SurvivorMemberStatusSchema,
    eliminatedWeekId: z.string().nullable(),
    livesRemaining: z.number().int(),
    revivedCount: z.number().int(),
  })
  .openapi("SimSettleSurvivorMemberRow");

export type SimSettleSurvivorMemberRow = z.infer<typeof SimSettleSurvivorMemberRowSchema>;

/**
 * One league-week of Survivor's replay. Listed when the week graded results **or**
 * when it put someone out, which are not the same set: ADR-0028 lets a week that
 * cannot be graded as a unit still eliminate every member whose own pick has
 * already lost, writing `survivor_state` and no result rows at all. Keying the
 * list on result rows alone would drop exactly the week an operator is looking at.
 */
export const SimSettleSurvivorWeekResultSchema = z
  .object({
    ...simSettleWeekIdentity,
    eliminatedMemberIds: z.array(z.string()),
  })
  .openapi("SimSettleSurvivorWeekResult");

export type SimSettleSurvivorWeekResult = z.infer<typeof SimSettleSurvivorWeekResultSchema>;

/**
 * What settling a league season left behind, in the shape of the mode that
 * settled it — a discriminated union rather than one flat Pick'em shape (SIM-10).
 *
 * The flat shape was read out of `pickem_standings` whatever the league's mode
 * was, so a settled Survivor season reported a real summary beside an empty
 * board. That reads to an operator as "settled and found nothing" rather than
 * "this mode grades survive-or-eliminate, and here is who is left" — the exact
 * confusion the step-through exists to prevent (spec §Testing & Internal
 * Tooling).
 *
 * Discriminated on `mode` for the reason `SimClockAdjustment` above is: each arm
 * needs different fields, and an exhaustive `switch` in the service is what makes
 * TypeScript prove a new mode was given a board rather than silently served
 * another mode's.
 */
export const SimSettleBoardSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal(LEAGUE_MODE.PICKEM),
      seasonStandings: z.array(SimSettlePickemStandingsRowSchema),
      weeks: z.array(SimSettlePickemWeekResultSchema),
    }),
    // No ranking and no points, and that is the mode (ADR-0016): Survivor's
    // board answers "who is left", so its season view is a ledger rather than a
    // table of positions.
    z.object({
      mode: z.literal(LEAGUE_MODE.SURVIVOR),
      members: z.array(SimSettleSurvivorMemberRowSchema),
      weeks: z.array(SimSettleSurvivorWeekResultSchema),
    }),
    // Bare on purpose until MM-6 gives the mode a settlement module. Naming the
    // mode with nothing under it is the honest answer — "not settleable yet" —
    // and is what the old shape could not say.
    z.object({ mode: z.literal(LEAGUE_MODE.MARCH_MADNESS) }),
  ])
  .openapi("SimSettleBoard");

export type SimSettleBoard = z.infer<typeof SimSettleBoardSchema>;

/** One targeted league season's post-rebuild state, the inspection surface. */
export const SimSettleLeagueResultSchema = z
  .object({
    leagueId: z.string(),
    leagueName: z.string(),
    leagueSeasonId: z.string(),
    seasonYear: z.number().int(),
    summary: SimSettlementSummarySchema,
    board: SimSettleBoardSchema,
  })
  .openapi("SimSettleLeagueResult");

export type SimSettleLeagueResult = z.infer<typeof SimSettleLeagueResultSchema>;

export const SimSettleResponseSchema = z
  .object({
    settledAt: z.iso.datetime(),
    // Every list here is ordered so two runs diff cleanly by eye: leagues by
    // name, Pick'em standings by rank then displayName and its weeks by week
    // start, Survivor members by status (alive first) then displayName and its
    // weeks by season ordinal — the order that mode's replay grades in
    // (ADR-0025), which week start cannot stand in for since two weeks may share
    // a start instant.
    leagues: z.array(SimSettleLeagueResultSchema),
  })
  .openapi("SimSettleResponse");

export type SimSettleResponse = z.infer<typeof SimSettleResponseSchema>;
