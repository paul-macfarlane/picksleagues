import { z } from "@hono/zod-openapi";

/**
 * Matchup stats for the viewer of a game (STAT epic, ADR-0040): per-team season
 * records ingested into discrete columns, and a per-game context payload
 * (injuries, FPI, ATS, recent form) stored as JSONB validated by the schemas
 * here. The payload evolves additively like league settings (engineering rules
 * §Data): a new field ships with a `.default()` so previously stored payloads
 * still parse, and read paths parse through `NflGameStatContextPayloadSchema` so
 * defaults materialize instead of being trusted to exist.
 */

export const NFL_LAST_GAME_RESULT = {
  WIN: "W",
  LOSS: "L",
  TIE: "T",
} as const;

export type NflLastGameResult = (typeof NFL_LAST_GAME_RESULT)[keyof typeof NFL_LAST_GAME_RESULT];

export const NflLastGameResultSchema = z.enum(NFL_LAST_GAME_RESULT);

export const NflLastFiveGameSchema = z
  .object({
    result: NflLastGameResultSchema,
    opponentAbbr: z.string(),
    // This team's points first, regardless of venue — normalized from the
    // provider's display string at the adapter, never re-parsed downstream.
    teamScore: z.number().int(),
    opponentScore: z.number().int(),
    atHome: z.boolean(),
  })
  .openapi("NflLastFiveGame");

export type NflLastFiveGame = z.infer<typeof NflLastFiveGameSchema>;

export const NflInjuryReportEntrySchema = z
  .object({
    athleteName: z.string(),
    // Position abbreviation ("WR", "S") — provider display text, not a const
    // set: rosters carry positions we have no reason to enumerate. Null when the
    // provider omits it rather than failing a whole sync over one athlete row.
    position: z.string().nullable(),
    /**
     * Provider status text ("Out", "Questionable", "Doubtful", "Injured
     * Reserve", …) — free text like `spreadSource`, never a const set: ESPN's
     * vocabulary here is open-ended and a fixed set would silently drop the next
     * status it invents. The UI's basic/advanced tiering treats anything that
     * isn't "Questionable" as a key injury, so an unknown status over-warns
     * rather than hiding an Out.
     */
    status: z.string(),
    // Body part / type ("Ankle", "Undisclosed") — null when the provider omits it.
    injuryType: z.string().nullable(),
  })
  .openapi("NflInjuryReportEntry");

export type NflInjuryReportEntry = z.infer<typeof NflInjuryReportEntrySchema>;

export const NflTeamGameContextSchema = z.object({
  injuries: z.array(NflInjuryReportEntrySchema).default([]),
  /**
   * ESPN FPI pregame win probability, 0–100. An external *prediction*, not a
   * stat — the UI shows it only in the advanced tier, attributed to ESPN FPI
   * (owner, 2026-08-12), so the default surface stays neutral.
   */
  fpiWinPct: z.number().nullable().default(null),
  /**
   * The provider's own against-the-spread record summary ("8-9", "8-8-1"),
   * displayed verbatim — parsing W-L(-P) would add failure modes for an
   * advanced-tier garnish. Null until the season has ATS data (empty through
   * the first weeks; the prior-season fallback does not cover it).
   */
  atsSummary: z.string().nullable().default(null),
  lastFive: z.array(NflLastFiveGameSchema).default([]),
});

export type NflTeamGameContext = z.infer<typeof NflTeamGameContextSchema>;

export const NflGameStatContextPayloadSchema = z.object({
  home: NflTeamGameContextSchema,
  away: NflTeamGameContextSchema,
});

export type NflGameStatContextPayload = z.infer<typeof NflGameStatContextPayloadSchema>;

// Longest plausible ATS summary is "10-10-1"-shaped; the bound rejects a paste
// of something that isn't a record summary at all.
const MAX_ATS_SUMMARY_LENGTH = 20;
// The provider serves exactly five; an override may hold fewer (correcting a
// short early-season list) but never more than the surface renders.
const MAX_LAST_FIVE = 5;
// Far above any real report; rejects an accidental paste of a whole league's
// injuries into one team's list.
const MAX_INJURY_ENTRIES = 100;

/**
 * One team's *sparse* context override (ADR-0041): a present field wins over
 * the provider's at read, an absent one falls through — the JSONB analogue of
 * `override_*` column parallels. Sparseness is the point: correcting one wrong
 * injury list must not freeze FPI/ATS/last-five at override-time values while
 * the sync keeps refreshing them. Overriding a field *to empty* is expressible
 * (`injuries: []` masks a report the provider got wrong); overriding a
 * nullable scalar to null is deliberately not — hiding a provider value
 * outright is not a correction this surface offers.
 */
export const NflTeamGameContextOverrideSchema = z
  .object({
    injuries: z.array(NflInjuryReportEntrySchema).max(MAX_INJURY_ENTRIES).optional(),
    fpiWinPct: z.number().min(0).max(100).optional(),
    // Trimmed before the min-length rule so a whitespace-only override is a
    // 400, not a stored value the editor's own trim would silently drop.
    atsSummary: z.string().trim().min(1).max(MAX_ATS_SUMMARY_LENGTH).optional(),
    lastFive: z.array(NflLastFiveGameSchema).max(MAX_LAST_FIVE).optional(),
  })
  .openapi("NflTeamGameContextOverride");

export type NflTeamGameContextOverride = z.infer<typeof NflTeamGameContextOverrideSchema>;

/** The stored shape of `nfl_game_stat_context.override_payload` (ADR-0041). */
export const NflGameStatContextOverridePayloadSchema = z
  .object({
    home: NflTeamGameContextOverrideSchema.optional(),
    away: NflTeamGameContextOverrideSchema.optional(),
  })
  .openapi("NflGameStatContextOverridePayload");

export type NflGameStatContextOverridePayload = z.infer<
  typeof NflGameStatContextOverridePayloadSchema
>;

/**
 * Compile-time tie between the context payload and its override twin, the
 * `NFL_GAME_STATS_WIRE_COVERS_STORAGE` idiom at key granularity (values
 * legitimately differ — the override's are non-null and non-defaulted): the
 * next additive context field that lands without an override counterpart
 * flips this to `false` and fails the build — otherwise the field would be
 * silently un-overridable with every check green (ADR-0041).
 */
type KeysMutuallyAssignable<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

export const NFL_CONTEXT_OVERRIDE_COVERS_PAYLOAD: KeysMutuallyAssignable<
  NflTeamGameContext,
  NflTeamGameContextOverride
> = true;

// --- Wire DTOs for GET /games/{gameId}/stats (STAT-5) ---

// The wire twin of `NflTeamGameContextSchema`. Registered separately because the
// storage schema's `.default()`s exist for additive payload evolution, while
// the wire promises fields that are always present.
export const NflGameStatsTeamContextSchema = z
  .object({
    injuries: z.array(NflInjuryReportEntrySchema),
    fpiWinPct: z.number().nullable(),
    atsSummary: z.string().nullable(),
    lastFive: z.array(NflLastFiveGameSchema),
  })
  .openapi("NflGameStatsTeamContext");

export type NflGameStatsTeamContext = z.infer<typeof NflGameStatsTeamContextSchema>;

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Compile-time tie between the storage payload and its wire twin: the next
 * additive context field that lands on `NflTeamGameContextSchema` without its
 * wire counterpart flips this to `false` and fails the build — otherwise the
 * sync would persist data the API silently never serves, with every check
 * (types, contract:check) staying green.
 */
export const NFL_GAME_STATS_WIRE_COVERS_STORAGE: MutuallyAssignable<
  NflTeamGameContext,
  NflGameStatsTeamContext
> = true;

/**
 * One team's season record block. `seasonYear` names the season the numbers
 * describe — until the current season has games it is the *prior* year
 * (ADR-0040's read-time fallback), and the client labels the block with it
 * rather than guessing. Averages and ranks are derived at read from the
 * stored rows; ranks are null when no team has played (nothing to rank), and
 * per-game averages are null at zero games rather than a fabricated 0.
 */
export const NflGameStatsTeamRecordSchema = z
  .object({
    seasonYear: z.number().int(),
    wins: z.number().int(),
    losses: z.number().int(),
    ties: z.number().int(),
    homeWins: z.number().int(),
    homeLosses: z.number().int(),
    homeTies: z.number().int(),
    roadWins: z.number().int(),
    roadLosses: z.number().int(),
    roadTies: z.number().int(),
    // Signed: +3 = won last three, -1 = lost last one, 0 = none.
    streak: z.number().int(),
    pointsFor: z.number().int(),
    pointsAgainst: z.number().int(),
    gamesPlayed: z.number().int(),
    avgPointsFor: z.number().nullable(),
    avgPointsAgainst: z.number().nullable(),
    // Points-based ranks across the league ("scoring offense: 19th"), ties
    // sharing a rank — never yardage ranks, which we deliberately don't ingest.
    scoringOffenseRank: z.number().int().nullable(),
    scoringDefenseRank: z.number().int().nullable(),
    // The as-of instant for this block (spec §UI conventions: the sheet shows
    // it — stats move on the sync's schedule, not the game's).
    updatedAt: z.iso.datetime(),
  })
  .openapi("NflGameStatsTeamRecord");

export type NflGameStatsTeamRecord = z.infer<typeof NflGameStatsTeamRecordSchema>;

// Registered under its own name — `.nullable()` on an already-registered node
// folds null into the shared component (see `NullableUsername`, me.ts).
const NullableNflGameStatsTeamRecordSchema = NflGameStatsTeamRecordSchema.nullable().openapi(
  "NullableNflGameStatsTeamRecord",
);

export const NflGameStatsContextSchema = z
  .object({
    home: NflGameStatsTeamContextSchema,
    away: NflGameStatsTeamContextSchema,
    updatedAt: z.iso.datetime(),
  })
  .openapi("NflGameStatsContext");

export type NflGameStatsContext = z.infer<typeof NflGameStatsContextSchema>;

const NullableNflGameStatsContextSchema = NflGameStatsContextSchema.nullable().openapi(
  "NullableNflGameStatsContext",
);

// --- Wire DTOs for GET /games/{gameId}/nfl-results (STAT-9) ---

/**
 * One game in a team's season log, from that team's perspective. `final`
 * false means the game is in progress — its score is live and `result` is
 * null because the outcome isn't knowable yet. Scores stay nullable rather
 * than defaulting to 0: a started game whose score the sync hasn't observed
 * yet renders as a dash, never as a fabricated 0–0 (ADR-0040).
 */
export const NflGameLogEntrySchema = z
  .object({
    // Provider display label ("Week 5", "Wild Card") — the weeks table stores
    // it precisely so postseason rounds never render off a bare number.
    weekLabel: z.string(),
    opponentAbbr: z.string(),
    atHome: z.boolean(),
    final: z.boolean(),
    teamScore: z.number().int().nullable(),
    opponentScore: z.number().int().nullable(),
    result: NflLastGameResultSchema.nullable(),
  })
  .openapi("NflGameLogEntry");

export type NflGameLogEntry = z.infer<typeof NflGameLogEntrySchema>;

/**
 * One team's season game log, newest game first. `seasonYear` names the season
 * served — until the current season has started games it is the *prior* year
 * (the ADR-0040 read-time fallback, mirrored from the record block), and the
 * client labels the column with it rather than guessing. Never empty: a team
 * with no started games in either season is a null block on the response.
 */
export const NflTeamGameLogSchema = z
  .object({
    seasonYear: z.number().int(),
    entries: z.array(NflGameLogEntrySchema),
  })
  .openapi("NflTeamGameLog");

export type NflTeamGameLog = z.infer<typeof NflTeamGameLogSchema>;

const NullableNflTeamGameLogSchema =
  NflTeamGameLogSchema.nullable().openapi("NullableNflTeamGameLog");

/**
 * Both teams' season game logs for the matchup sheet's Results segment
 * (STAT-9) — served entirely from our `games` rows, zero new ingestion.
 * `updatedAt` is the newest write among the served rows: final scores are
 * immutable so the stamp's real job is dating any live score on display
 * (spec §UI conventions: never claim real-time freshness). Null when no rows
 * were served at all.
 */
export const NflGameResultsResponseSchema = z
  .object({
    gameId: z.string(),
    home: NullableNflTeamGameLogSchema,
    away: NullableNflTeamGameLogSchema,
    updatedAt: z.iso.datetime().nullable(),
  })
  .openapi("NflGameResultsResponse");

export type NflGameResultsResponse = z.infer<typeof NflGameResultsResponseSchema>;

/**
 * Everything the matchup stats sheet renders for one game. Each block is null
 * when ingestion has nothing for it — the client omits, never fabricates
 * (ADR-0040): `home`/`away` null means no record row for the team at all
 * (neither current nor prior season), `context` null means the stats sync has
 * not reached this game.
 */
export const NflGameStatsResponseSchema = z
  .object({
    gameId: z.string(),
    home: NullableNflGameStatsTeamRecordSchema,
    away: NullableNflGameStatsTeamRecordSchema,
    context: NullableNflGameStatsContextSchema,
  })
  .openapi("NflGameStatsResponse");

export type NflGameStatsResponse = z.infer<typeof NflGameStatsResponseSchema>;
