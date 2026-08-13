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

export const LastFiveGameSchema = z.object({
  result: LastGameResultSchema,
  opponentAbbr: z.string(),
  // This team's points first, regardless of venue — normalized from the
  // provider's display string at the adapter, never re-parsed downstream.
  teamScore: z.number().int(),
  opponentScore: z.number().int(),
  atHome: z.boolean(),
});

export type LastFiveGame = z.infer<typeof LastFiveGameSchema>;

export const InjuryReportEntrySchema = z.object({
  athleteName: z.string(),
  // Position abbreviation ("WR", "S") — provider display text, not a const
  // set: rosters carry positions we have no reason to enumerate.
  position: z.string(),
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
});

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
