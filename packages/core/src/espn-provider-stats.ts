import { z } from "zod";
import {
  NflLastGameResultSchema,
  type NflLastFiveGame,
  type NflTeamGameContext,
} from "@picksleagues/schemas";
import type { ProviderNflGameStatContext, ProviderNflTeamSeasonRecord } from "./game-data-provider";

/**
 * ESPN's matchup-stats response shapes (ADR-0040): the bulk standings that
 * back `fetchNflTeamSeasonRecords` and the event summary behind
 * `fetchNflGameStatContext`. Split from `espn-provider.ts` purely by size —
 * this is the same adapter boundary (engineering rules: "provider shapes
 * never leak"), and nothing here is imported outside it and its tests.
 */

// --- Bulk standings (team season records) ---

const StandingsStatSchema = z.looseObject({
  // `type` is the stable lowercase key ("wins", "pointsfor", "home"); `name`
  // is display casing that has no reason to be trusted.
  type: z.string(),
  value: z.number().nullable().optional(),
  summary: z.string().nullable().optional(),
});

const StandingsEntrySchema = z.looseObject({
  team: z.looseObject({ id: z.string() }),
  stats: z.array(StandingsStatSchema),
});

const StandingsSchema = z.looseObject({
  season: z.looseObject({ year: z.number() }),
  // One child per conference at the default grouping level; the split is
  // irrelevant here, so entries are simply flattened.
  children: z.array(
    z.looseObject({
      standings: z.looseObject({ entries: z.array(StandingsEntrySchema) }),
    }),
  ),
});

type StandingsStats = z.infer<typeof StandingsEntrySchema>["stats"];

/**
 * Strict by design: a season with no games yet still carries every one of
 * these stats as a real zero (verified against the live endpoint for the
 * unplayed 2026 season, 2026-08-12), so a missing stat is a provider-contract
 * break that must fail the sync loudly (ADR-0007), never read as 0.
 */
function statValueStrict(stats: StandingsStats, type: string, context: string): number {
  const stat = stats.find((entry) => entry.type === type);
  if (!stat || typeof stat.value !== "number" || !Number.isFinite(stat.value)) {
    throw new Error(`EspnProvider: standings stat "${type}" missing or non-numeric for ${context}`);
  }
  return Math.round(stat.value);
}

/** Parses a "W-L" / "W-L-T" record summary ("6-3", "8-8-1"); throws on any other shape. */
function parseRecordSummary(
  stats: StandingsStats,
  type: string,
  context: string,
): { wins: number; losses: number; ties: number } {
  const summary = stats.find((entry) => entry.type === type)?.summary;
  const match = summary?.match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  if (!summary || !match) {
    throw new Error(
      `EspnProvider: standings record "${type}" missing or unparseable ("${summary ?? ""}") for ${context}`,
    );
  }
  return {
    wins: parseInt(match[1]!, 10),
    losses: parseInt(match[2]!, 10),
    ties: match[3] !== undefined ? parseInt(match[3], 10) : 0,
  };
}

function mapStandingsEntry(
  entry: z.infer<typeof StandingsEntrySchema>,
  seasonYear: number,
): ProviderNflTeamSeasonRecord {
  const context = `team ${entry.team.id} season ${seasonYear}`;
  const home = parseRecordSummary(entry.stats, "home", context);
  const road = parseRecordSummary(entry.stats, "road", context);
  return {
    providerTeamId: entry.team.id,
    seasonYear,
    wins: statValueStrict(entry.stats, "wins", context),
    losses: statValueStrict(entry.stats, "losses", context),
    ties: statValueStrict(entry.stats, "ties", context),
    homeWins: home.wins,
    homeLosses: home.losses,
    homeTies: home.ties,
    roadWins: road.wins,
    roadLosses: road.losses,
    roadTies: road.ties,
    streak: statValueStrict(entry.stats, "streak", context),
    pointsFor: statValueStrict(entry.stats, "pointsfor", context),
    pointsAgainst: statValueStrict(entry.stats, "pointsagainst", context),
  };
}

// --- Game summary (matchup context, ADR-0040) ---

const SummaryTeamRefSchema = z.looseObject({ id: z.string() });

const SummaryInjuryEntrySchema = z.looseObject({
  status: z.string(),
  athlete: z.looseObject({
    displayName: z.string(),
    position: z.looseObject({ abbreviation: z.string() }).optional(),
  }),
  details: z.looseObject({ type: z.string() }).optional(),
});

const SummaryLastFiveEventSchema = z.looseObject({
  atVs: z.string().optional(),
  gameResult: z.string().optional(),
  score: z.string().optional(),
  gameDate: z.string().optional(),
  opponent: z.looseObject({ abbreviation: z.string().optional() }).optional(),
});

const SummarySchema = z.looseObject({
  header: z.looseObject({
    competitions: z
      .array(
        z.looseObject({
          competitors: z.array(z.looseObject({ homeAway: z.string(), team: SummaryTeamRefSchema })),
        }),
      )
      .min(1),
  }),
  injuries: z
    .array(
      z.looseObject({ team: SummaryTeamRefSchema, injuries: z.array(SummaryInjuryEntrySchema) }),
    )
    .optional(),
  predictor: z
    .looseObject({
      homeTeam: z.looseObject({ gameProjection: z.string().optional() }).optional(),
      awayTeam: z.looseObject({ gameProjection: z.string().optional() }).optional(),
    })
    .optional(),
  againstTheSpread: z
    .array(
      z.looseObject({
        team: SummaryTeamRefSchema,
        records: z.array(z.looseObject({ summary: z.string().optional() })).optional(),
      }),
    )
    .optional(),
  lastFiveGames: z
    .array(
      z.looseObject({
        team: SummaryTeamRefSchema,
        events: z.array(SummaryLastFiveEventSchema).optional(),
      }),
    )
    .optional(),
});

/**
 * Lenient by design, the opposite of the standings parser and for the same
 * end: every field here is optional garnish on the matchup sheet, so a
 * malformed entry drops silently rather than failing the sync that also
 * carries the injuries. The strict/lenient split follows what breaks: a
 * standings break corrupts records the basic tier states as fact; a summary
 * quirk loses one advanced-tier line.
 */
// UTC months (0-based) in which only NFL *preseason* football is played: the
// Hall of Fame game and preseason run late July–August, the regular season
// has never started before September, and the postseason ends mid-February —
// so a July/August date identifies a preseason game. The date is the only
// discriminator the payload offers: last-five events carry no season-type
// field (verified live 2026-08-13, when a preseason win appeared in a
// regular-season game's form line).
const PRESEASON_ONLY_UTC_MONTHS = new Set([6, 7]);

function isPreseasonDate(gameDate: string | undefined): boolean {
  if (gameDate === undefined) return false;
  const parsed = new Date(gameDate);
  // Unparseable dates fall through to the field checks below rather than
  // deciding season type — this predicate only answers what a date proves.
  if (Number.isNaN(parsed.getTime())) return false;
  return PRESEASON_ONLY_UTC_MONTHS.has(parsed.getUTCMonth());
}

function mapLastFiveEvent(event: z.infer<typeof SummaryLastFiveEventSchema>): NflLastFiveGame[] {
  // Preseason games are not form (starters sit) and the app ingests no
  // preseason surface anywhere else — dropped before the shape checks so a
  // malformed preseason entry can't survive as anything (STAT-11).
  if (isPreseasonDate(event.gameDate)) {
    return [];
  }
  const result = NflLastGameResultSchema.safeParse(event.gameResult);
  const scoreMatch = event.score?.match(/^(\d+)-(\d+)$/);
  const opponentAbbr = event.opponent?.abbreviation;
  if (!result.success || !scoreMatch || !opponentAbbr) {
    return [];
  }
  return [
    {
      result: result.data,
      opponentAbbr,
      // ESPN's score string puts this team's points first regardless of venue
      // (verified against W/L flags on the live endpoint, 2026-08-12).
      teamScore: parseInt(scoreMatch[1]!, 10),
      opponentScore: parseInt(scoreMatch[2]!, 10),
      // ESPN writes "@" for away and "vs" for home; anything unrecognized
      // reads as home, which only mislabels a venue badge.
      atHome: event.atVs !== "@",
    },
  ];
}

function parseGameProjection(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function mapSummaryTeamContext(
  summary: z.infer<typeof SummarySchema>,
  teamId: string,
  fpiWinPct: number | null,
): NflTeamGameContext {
  const injuries = summary.injuries?.find((entry) => entry.team.id === teamId)?.injuries ?? [];
  const atsRecords = summary.againstTheSpread?.find((entry) => entry.team.id === teamId)?.records;
  const lastFiveEvents =
    summary.lastFiveGames?.find((entry) => entry.team.id === teamId)?.events ?? [];
  return {
    injuries: injuries.map((entry) => ({
      athleteName: entry.athlete.displayName,
      position: entry.athlete.position?.abbreviation ?? null,
      status: entry.status,
      injuryType: entry.details?.type ?? null,
    })),
    fpiWinPct,
    // First record is the overall ATS line; empty until the season has ATS
    // data, which serves as null rather than a fabricated "0-0".
    atsSummary: atsRecords?.[0]?.summary ?? null,
    lastFive: lastFiveEvents.flatMap(mapLastFiveEvent),
  };
}

/**
 * All 32 team records from a standings payload, or [] when ESPN answered
 * with a different season than requested — it serves its latest season for
 * an unknown year rather than 404ing, and a mismatched year means "not
 * published", not data (ADR-0009's shape); trusting it would stamp one
 * season's records onto another's rows.
 */
export function parseTeamSeasonRecords(
  json: unknown,
  requestedSeasonYear: number,
): ProviderNflTeamSeasonRecord[] {
  const standings = StandingsSchema.parse(json);
  if (standings.season.year !== requestedSeasonYear) {
    return [];
  }
  return standings.children.flatMap((child) =>
    child.standings.entries.map((entry) => mapStandingsEntry(entry, requestedSeasonYear)),
  );
}

/** One game's matchup context from its summary payload; throws when the header names no home/away. */
export function parseGameStatContext(
  json: unknown,
  providerGameId: string,
): ProviderNflGameStatContext {
  const summary = SummarySchema.parse(json);
  const [competition] = summary.header.competitions;
  if (!competition) {
    throw new Error(`EspnProvider: summary for event ${providerGameId} has no competitions`);
  }
  const homeId = competition.competitors.find((c) => c.homeAway === "home")?.team.id;
  const awayId = competition.competitors.find((c) => c.homeAway === "away")?.team.id;
  if (!homeId || !awayId) {
    throw new Error(
      `EspnProvider: summary for event ${providerGameId} is missing a home or away competitor`,
    );
  }
  return {
    providerGameId,
    home: mapSummaryTeamContext(
      summary,
      homeId,
      parseGameProjection(summary.predictor?.homeTeam?.gameProjection),
    ),
    away: mapSummaryTeamContext(
      summary,
      awayId,
      parseGameProjection(summary.predictor?.awayTeam?.gameProjection),
    ),
  };
}
