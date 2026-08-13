import { z } from "@hono/zod-openapi";

/**
 * Matchup stats for the viewer of a game (STAT epic, ADR-0040): per-team season
 * records ingested into discrete columns, and a per-game context payload
 * (injuries, FPI, ATS, recent form) stored as JSONB validated by the schemas
 * here. The payload evolves additively like league settings (engineering rules
 * §Data): a new field ships with a `.default()` so previously stored payloads
 * still parse, and read paths parse through `GameStatContextPayloadSchema` so
 * defaults materialize instead of being trusted to exist.
 */

export const LAST_GAME_RESULT = {
  WIN: "W",
  LOSS: "L",
  TIE: "T",
} as const;

export type LastGameResult = (typeof LAST_GAME_RESULT)[keyof typeof LAST_GAME_RESULT];

export const LastGameResultSchema = z.enum(LAST_GAME_RESULT);

export const LastFiveGameSchema = z
  .object({
    result: LastGameResultSchema,
    opponentAbbr: z.string(),
    // This team's points first, regardless of venue — normalized from the
    // provider's display string at the adapter, never re-parsed downstream.
    teamScore: z.number().int(),
    opponentScore: z.number().int(),
    atHome: z.boolean(),
  })
  .openapi("LastFiveGame");

export type LastFiveGame = z.infer<typeof LastFiveGameSchema>;

export const InjuryReportEntrySchema = z
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
  .openapi("InjuryReportEntry");

export type InjuryReportEntry = z.infer<typeof InjuryReportEntrySchema>;

export const TeamGameContextSchema = z.object({
  injuries: z.array(InjuryReportEntrySchema).default([]),
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
  lastFive: z.array(LastFiveGameSchema).default([]),
});

export type TeamGameContext = z.infer<typeof TeamGameContextSchema>;

export const GameStatContextPayloadSchema = z.object({
  home: TeamGameContextSchema,
  away: TeamGameContextSchema,
});

export type GameStatContextPayload = z.infer<typeof GameStatContextPayloadSchema>;

// --- Wire DTOs for GET /games/{gameId}/stats (STAT-5) ---

// The wire twin of `TeamGameContextSchema`. Registered separately because the
// storage schema's `.default()`s exist for additive payload evolution, while
// the wire promises fields that are always present.
export const GameStatsTeamContextSchema = z
  .object({
    injuries: z.array(InjuryReportEntrySchema),
    fpiWinPct: z.number().nullable(),
    atsSummary: z.string().nullable(),
    lastFive: z.array(LastFiveGameSchema),
  })
  .openapi("GameStatsTeamContext");

export type GameStatsTeamContext = z.infer<typeof GameStatsTeamContextSchema>;

/**
 * One team's season record block. `seasonYear` names the season the numbers
 * describe — until the current season has games it is the *prior* year
 * (ADR-0040's read-time fallback), and the client labels the block with it
 * rather than guessing. Averages and ranks are derived at read from the
 * stored rows; ranks are null when no team has played (nothing to rank), and
 * per-game averages are null at zero games rather than a fabricated 0.
 */
export const GameStatsTeamRecordSchema = z
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
  .openapi("GameStatsTeamRecord");

export type GameStatsTeamRecord = z.infer<typeof GameStatsTeamRecordSchema>;

// Registered under its own name — `.nullable()` on an already-registered node
// folds null into the shared component (see `NullableUsername`, me.ts).
const NullableGameStatsTeamRecordSchema = GameStatsTeamRecordSchema.nullable().openapi(
  "NullableGameStatsTeamRecord",
);

export const GameStatsContextSchema = z
  .object({
    home: GameStatsTeamContextSchema,
    away: GameStatsTeamContextSchema,
    updatedAt: z.iso.datetime(),
  })
  .openapi("GameStatsContext");

export type GameStatsContext = z.infer<typeof GameStatsContextSchema>;

const NullableGameStatsContextSchema = GameStatsContextSchema.nullable().openapi(
  "NullableGameStatsContext",
);

/**
 * Everything the matchup stats sheet renders for one game. Each block is null
 * when ingestion has nothing for it — the client omits, never fabricates
 * (ADR-0040): `home`/`away` null means no record row for the team at all
 * (neither current nor prior season), `context` null means the stats sync has
 * not reached this game.
 */
export const GameStatsResponseSchema = z
  .object({
    gameId: z.string(),
    home: NullableGameStatsTeamRecordSchema,
    away: NullableGameStatsTeamRecordSchema,
    context: NullableGameStatsContextSchema,
  })
  .openapi("GameStatsResponse");

export type GameStatsResponse = z.infer<typeof GameStatsResponseSchema>;
