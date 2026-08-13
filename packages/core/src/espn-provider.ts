import { z } from "zod";
import {
  GAME_STATUS,
  LastGameResultSchema,
  type GameStatus,
  type LastFiveGame,
  type TeamGameContext,
  WEEK_TYPE,
  type WeekType,
} from "@picksleagues/schemas";
import type {
  GameDataProvider,
  ProviderGame,
  ProviderGameStatContext,
  ProviderSeasonStructure,
  ProviderTeam,
  ProviderTeamSeasonRecord,
  ProviderWeek,
} from "./game-data-provider";

const DEFAULT_SITE_API_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports";
const DEFAULT_CORE_API_BASE_URL = "https://sports.core.api.espn.com/v2/sports";
// The bulk standings live under `/apis/v2`, not `/apis/site/v2` — a third path
// root on the same host, so it gets its own base rather than string surgery on
// the site one.
const DEFAULT_STANDINGS_API_BASE_URL = "https://site.api.espn.com/apis/v2/sports";

// ESPN season-type ids: 2 = regular season (weeks 1–18), 3 = postseason
// (weeks 1–5, of which week 4 "Pro Bowl" is excluded below).
const ESPN_SEASON_TYPE_BY_WEEK_TYPE: Record<WeekType, number> = {
  [WEEK_TYPE.REGULAR]: 2,
  [WEEK_TYPE.POSTSEASON]: 3,
};

/**
 * ESPN numbers the postseason 1, 2, 3, 5 — its week 4 is the "Pro Bowl", which
 * is not a competitive game and is excluded (by label) below, leaving a gap.
 * Our domain model numbers the four real rounds contiguously (Wild Card=1 …
 * Super Bowl=4), matching `NflWeekRef` and `estimatedNflWeeks`. This
 * adapter owns that translation so ESPN's gapped numbering never leaks
 * (engineering rules: "provider shapes never leak"). A *static* map (never
 * positional/dynamic renumbering) is deliberate: an ESPN postseason number not
 * in it throws — a provider-contract break we want surfaced as a 500, not
 * silently renumbered. Verified against 2025-26 ESPN data (2026-07-23).
 */
export const ESPN_POSTSEASON_NUMBER_BY_DOMAIN: Record<number, number> = {
  1: 1, // Wild Card
  2: 2, // Divisional Round
  3: 3, // Conference Championship
  4: 5, // Super Bowl (ESPN's 4 is the excluded Pro Bowl)
};

const DOMAIN_POSTSEASON_NUMBER_BY_ESPN: Record<number, number> = Object.fromEntries(
  Object.entries(ESPN_POSTSEASON_NUMBER_BY_DOMAIN).map(([domain, espn]) => [espn, Number(domain)]),
);

/** ESPN postseason week number → our contiguous domain number; throws on the unknown. */
function domainPostseasonNumberFromEspn(espnNumber: number): number {
  const domainNumber = DOMAIN_POSTSEASON_NUMBER_BY_ESPN[espnNumber];
  if (domainNumber === undefined) {
    throw new Error(
      `EspnProvider: unexpected ESPN postseason week number ${espnNumber} (known: ${Object.keys(DOMAIN_POSTSEASON_NUMBER_BY_ESPN).join(", ")}) — provider numbering changed`,
    );
  }
  return domainNumber;
}

/** Our domain postseason week number → ESPN's scoreboard number; throws on the unknown. */
function espnPostseasonNumberFromDomain(domainNumber: number): number {
  const espnNumber = ESPN_POSTSEASON_NUMBER_BY_DOMAIN[domainNumber];
  if (espnNumber === undefined) {
    throw new Error(
      `EspnProvider: unexpected domain postseason week number ${domainNumber} (known: ${Object.keys(ESPN_POSTSEASON_NUMBER_BY_DOMAIN).join(", ")})`,
    );
  }
  return espnNumber;
}

// --- ESPN response shapes: private to this adapter (engineering rules: "provider shapes never leak"). ---

const WeeksIndexSchema = z.object({
  items: z.array(z.object({ $ref: z.string() })),
});

const WeekDetailSchema = z.looseObject({
  number: z.number(),
  // Provider display label ("Week 1", "Wild Card"); also drives the Pro Bowl
  // exclusion below.
  text: z.string(),
  startDate: z.string(),
  endDate: z.string(),
});

const CompetitorSchema = z.looseObject({
  homeAway: z.string(),
  score: z.string().optional(),
  team: z.looseObject({
    id: z.string(),
    abbreviation: z.string(),
    displayName: z.string(),
  }),
});

const CompetitionSchema = z.looseObject({
  id: z.string(),
  date: z.string(),
  status: z.looseObject({
    type: z.looseObject({
      name: z.string(),
      state: z.string(),
    }),
    // Live state, siblings of `type`: `period` is the quarter (5+ in overtime)
    // and `clock` the seconds remaining in it — a float in some of ESPN's
    // sports feeds. Optional because ESPN omits them on some payloads (and
    // sends period 0 pre-game). Its preformatted `displayClock` is deliberately
    // not declared: a provider display string must not leak past this adapter.
    period: z.number().optional(),
    clock: z.number().optional(),
  }),
  competitors: z.array(CompetitorSchema),
  // `provider.name` (PKM-9) is the book the spread came from — DraftKings as of
  // 2026-08-07, but ESPN has rotated books before, so this is captured as free
  // text rather than trusted to stay any one value.
  odds: z
    .array(
      z.looseObject({
        spread: z.number().optional(),
        provider: z.looseObject({ name: z.string() }).optional(),
      }),
    )
    .optional(),
});

const EventSchema = z.looseObject({
  id: z.string(),
  competitions: z.array(CompetitionSchema).min(1),
});

const ScoreboardSchema = z.looseObject({
  events: z.array(EventSchema),
});

// Verified against the real endpoint (2026-07-23): every one of the 32
// current teams' `logos[]` carries exactly one non-scoreboard entry whose
// `rel` includes "default" (light) and exactly one whose `rel` includes
// "dark" — the site also ships scoreboard-specific variants (`rel` also
// containing "scoreboard") which this schema deliberately doesn't try to
// disambiguate by shape; the mapper below filters those out by rel content.
const TeamLogoSchema = z.looseObject({
  href: z.string(),
  rel: z.array(z.string()),
});

const TeamListItemSchema = z.looseObject({
  team: z.looseObject({
    id: z.string(),
    abbreviation: z.string(),
    displayName: z.string(),
    location: z.string(),
    logos: z.array(TeamLogoSchema).optional(),
  }),
});

const TeamsListingSchema = z.looseObject({
  sports: z
    .array(
      z.looseObject({
        leagues: z.array(z.looseObject({ teams: z.array(TeamListItemSchema) })).min(1),
      }),
    )
    .min(1),
});

/** First logo whose `rel` names `wantRel` but isn't the scoreboard-specific variant; null if absent. */
function findLogoUrl(logos: z.infer<typeof TeamLogoSchema>[], wantRel: string): string | null {
  const logo = logos.find(
    (entry) => entry.rel.includes(wantRel) && !entry.rel.includes("scoreboard"),
  );
  return logo?.href ?? null;
}

function mapTeamListItem(item: z.infer<typeof TeamListItemSchema>): ProviderTeam {
  const logos = item.team.logos ?? [];
  return {
    providerTeamId: item.team.id,
    abbreviation: item.team.abbreviation,
    name: item.team.displayName,
    location: item.team.location,
    logoLightUrl: findLogoUrl(logos, "default"),
    logoDarkUrl: findLogoUrl(logos, "dark"),
  };
}

/**
 * ESPN status names/states this adapter recognizes. Unknown states fall back
 * to `scheduled` — settlement only ever acts on `final`, so an unrecognized
 * status must never be mistaken for one (conservative default).
 */
function mapStatus(statusType: { name: string; state: string }): GameStatus {
  if (statusType.name === "STATUS_POSTPONED") {
    return GAME_STATUS.POSTPONED;
  }
  if (statusType.name === "STATUS_CANCELED" || statusType.name === "STATUS_CANCELLED") {
    return GAME_STATUS.CANCELLED;
  }
  switch (statusType.state) {
    case "pre":
      return GAME_STATUS.SCHEDULED;
    case "in":
      return GAME_STATUS.IN_PROGRESS;
    case "post":
      return GAME_STATUS.FINAL;
    default:
      return GAME_STATUS.SCHEDULED;
  }
}

/**
 * ESPN's live period/clock, normalized to `ProviderGame`'s two integer fields.
 * Only a game in progress has live state: ESPN reports period 0 with a full
 * clock pre-game and leaves the last period frozen at 0:00 once a game is over,
 * neither of which is a clock worth storing. A value ESPN omits, or one outside
 * its own domain (period below 1, negative clock), reports as null rather than
 * as a fabricated 0 — the same conservative default `mapStatus` takes.
 */
function mapLiveState(
  status: z.infer<typeof CompetitionSchema>["status"],
  isInProgress: boolean,
): { period: number | null; clockSeconds: number | null } {
  if (!isInProgress) {
    return { period: null, clockSeconds: null };
  }
  const { period, clock } = status;
  return {
    // Both rounded rather than trusted to be whole: ESPN's clock is a float in
    // some feeds, and these land in integer columns.
    period:
      typeof period === "number" && Number.isFinite(period) && period >= 1
        ? Math.round(period)
        : null,
    clockSeconds:
      typeof clock === "number" && Number.isFinite(clock) && clock >= 0 ? Math.round(clock) : null,
  };
}

function parseDateStrict(raw: string, context: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`EspnProvider: invalid date "${raw}" for ${context}`);
  }
  return parsed;
}

function parseScoreStrict(raw: string, context: string): number {
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`EspnProvider: invalid score "${raw}" for ${context}`);
  }
  return parsed;
}

/**
 * ESPN publishes an unseeded playoff round months ahead as real events whose
 * competitors are a shared placeholder: `team.id` `-1`/`-2`, abbreviation
 * `TBD`. Both signals are checked because either alone identifies today's
 * encoding while neither can match a real team — ESPN's team ids are positive
 * and no real abbreviation is `TBD` — so the redundancy costs nothing and
 * survives ESPN changing one of them. A non-numeric id is not a placeholder:
 * `Number` yields NaN, which is not finite.
 */
function isPlaceholderCompetitor(competitor: z.infer<typeof CompetitorSchema>): boolean {
  const providerId = Number(competitor.team.id);
  return (
    (Number.isFinite(providerId) && providerId < 0) ||
    competitor.team.abbreviation.toUpperCase() === "TBD"
  );
}

function mapCompetitionToGame(
  weekType: WeekType,
  weekNumber: number,
  competition: z.infer<typeof CompetitionSchema>,
): ProviderGame {
  const home = competition.competitors.find((competitor) => competitor.homeAway === "home");
  const away = competition.competitors.find((competitor) => competitor.homeAway === "away");
  if (!home || !away) {
    throw new Error(
      `EspnProvider: competition ${competition.id} is missing a home or away competitor`,
    );
  }

  const status = mapStatus(competition.status.type);
  const scoresAreMeaningful = status === GAME_STATUS.IN_PROGRESS || status === GAME_STATUS.FINAL;
  const liveState = mapLiveState(competition.status, status === GAME_STATUS.IN_PROGRESS);

  // ESPN's spread is home-relative (negative = home favored), matching our
  // convention — verified against live ESPN data (2026 season week 1
  // scoreboard, 16/16 games consistent, 2026-07-21).
  const rawSpread = competition.odds?.[0]?.spread;
  const spread = typeof rawSpread === "number" && Number.isFinite(rawSpread) ? rawSpread : null;
  // Same odds entry as the spread itself, so the two can never attribute a
  // number to the wrong book (PKM-9).
  const rawSource = competition.odds?.[0]?.provider?.name;
  const spreadSource = typeof rawSource === "string" && rawSource.length > 0 ? rawSource : null;

  return {
    providerGameId: competition.id,
    weekType,
    weekNumber,
    homeTeamAbbr: home.team.abbreviation,
    homeTeamName: home.team.displayName,
    homeTeamProviderId: home.team.id,
    awayTeamAbbr: away.team.abbreviation,
    awayTeamName: away.team.displayName,
    awayTeamProviderId: away.team.id,
    kickoffAt: parseDateStrict(competition.date, `competition ${competition.id}`),
    status,
    // ESPN sends "0" pre-game; only trust scores once the game has started. A
    // meaningful-but-unparseable score is an adapter-boundary error, not a 0.
    homeScore:
      scoresAreMeaningful && home.score !== undefined
        ? parseScoreStrict(home.score, `competition ${competition.id} home score`)
        : null,
    awayScore:
      scoresAreMeaningful && away.score !== undefined
        ? parseScoreStrict(away.score, `competition ${competition.id} away score`)
        : null,
    period: liveState.period,
    clockSeconds: liveState.clockSeconds,
    spread,
    spreadSource,
  };
}

// --- Bulk standings (team season records, ADR-0040) ---

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
): ProviderTeamSeasonRecord {
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
function mapLastFiveEvent(event: z.infer<typeof SummaryLastFiveEventSchema>): LastFiveGame[] {
  const result = LastGameResultSchema.safeParse(event.gameResult);
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
): TeamGameContext {
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
 * ESPN unofficial API adapter (arch D6). Contains ESPN's response shapes
 * entirely — every method returns domain types from `game-data-provider.ts`.
 */
export class EspnProvider implements GameDataProvider {
  readonly #fetchImpl: typeof fetch;
  readonly #siteApiBaseUrl: string;
  readonly #coreApiBaseUrl: string;
  readonly #standingsApiBaseUrl: string;

  constructor(options?: {
    fetchImpl?: typeof fetch;
    siteApiBaseUrl?: string;
    coreApiBaseUrl?: string;
    standingsApiBaseUrl?: string;
  }) {
    this.#fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    this.#siteApiBaseUrl = options?.siteApiBaseUrl ?? DEFAULT_SITE_API_BASE_URL;
    this.#coreApiBaseUrl = options?.coreApiBaseUrl ?? DEFAULT_CORE_API_BASE_URL;
    this.#standingsApiBaseUrl = options?.standingsApiBaseUrl ?? DEFAULT_STANDINGS_API_BASE_URL;
  }

  async #fetchJson(url: string): Promise<unknown> {
    const response = await this.#fetchImpl(url);
    if (!response.ok) {
      throw new Error(`EspnProvider: GET ${url} failed with status ${response.status}`);
    }
    return response.json();
  }

  /**
   * Same as `#fetchJson`, except a 404 is a typed "not found" rather than a
   * thrown error — used only for the weeks index, which ESPN legitimately
   * 404s for a season it hasn't published a schedule for yet (ADR-0009
   * "upcoming seasons exist before their data"). Any other non-OK status
   * still throws: a genuine outage must still fail the job (arch D7/ADR-0007).
   */
  async #fetchJsonOrNotFound(url: string): Promise<unknown | null> {
    const response = await this.#fetchImpl(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`EspnProvider: GET ${url} failed with status ${response.status}`);
    }
    return response.json();
  }

  async fetchNflSeasonStructure(seasonYear: number): Promise<ProviderSeasonStructure> {
    // Fetch both season types; each week's `text` becomes its label, and the
    // week type is tagged from which index it came from.
    const weeksByType = await Promise.all(
      (Object.keys(ESPN_SEASON_TYPE_BY_WEEK_TYPE) as WeekType[]).map((weekType) =>
        this.#fetchNflWeeks(seasonYear, weekType),
      ),
    );

    return { seasonYear, weeks: weeksByType.flat() };
  }

  async #fetchNflWeeks(seasonYear: number, weekType: WeekType): Promise<ProviderWeek[]> {
    const seasonType = ESPN_SEASON_TYPE_BY_WEEK_TYPE[weekType];
    const indexUrl = `${this.#coreApiBaseUrl}/football/leagues/nfl/seasons/${seasonYear}/types/${seasonType}/weeks?limit=32`;
    // A future season ESPN hasn't published a schedule for yet 404s here —
    // that's "not published", not an error (ADR-0009); map straight to no
    // weeks for this season type rather than throwing.
    const indexJson = await this.#fetchJsonOrNotFound(indexUrl);
    if (indexJson === null) {
      return [];
    }
    const index = WeeksIndexSchema.parse(indexJson);

    const weeks = await Promise.all(
      index.items.map(async (item) => {
        const detail = WeekDetailSchema.parse(await this.#fetchJson(item.$ref));
        return {
          weekType,
          espnNumber: detail.number,
          label: detail.text,
          startsAt: parseDateStrict(detail.startDate, `week ${detail.number} startDate`),
          endsAt: parseDateStrict(detail.endDate, `week ${detail.number} endDate`),
        };
      }),
    );

    // Exclude the Pro Bowl (ESPN postseason week 4) *before* translating
    // numbers — it's not a competitive game and is the reason ESPN's postseason
    // numbering has a gap. Match on the label rather than the number so an ESPN
    // renumbering can't sneak it back in (the number translation below would
    // then throw on the unexpected value, which is the intended contract break).
    return weeks
      .filter((week) => !week.label.toLowerCase().includes("pro bowl"))
      .map(
        (week) =>
          ({
            weekType,
            // Regular numbers pass through; postseason translates ESPN's gapped
            // numbering (1,2,3,5) to our contiguous domain numbering (Super
            // Bowl = 4) so the rest of the app never sees ESPN's scheme.
            weekNumber:
              weekType === WEEK_TYPE.POSTSEASON
                ? domainPostseasonNumberFromEspn(week.espnNumber)
                : week.espnNumber,
            label: week.label,
            startsAt: week.startsAt,
            endsAt: week.endsAt,
          }) satisfies ProviderWeek,
      );
  }

  async fetchNflWeekGames(
    seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    const seasonType = ESPN_SEASON_TYPE_BY_WEEK_TYPE[weekType];
    // Callers address weeks in domain numbering (ProviderWeek); the scoreboard
    // query needs ESPN's, so translate the postseason number back (Super Bowl
    // domain 4 → ESPN 5). Games are tagged with the domain number below.
    const espnWeekNumber =
      weekType === WEEK_TYPE.POSTSEASON ? espnPostseasonNumberFromDomain(weekNumber) : weekNumber;
    const url = `${this.#siteApiBaseUrl}/football/nfl/scoreboard?seasontype=${seasonType}&week=${espnWeekNumber}&dates=${seasonYear}`;
    const scoreboard = ScoreboardSchema.parse(await this.#fetchJson(url));

    return scoreboard.events.flatMap((event) => {
      // `min(1)` on the schema guarantees this, but TS's noUncheckedIndexedAccess
      // can't see through that — guard explicitly rather than asserting.
      const [competition] = event.competitions;
      if (!competition) {
        throw new Error(`EspnProvider: event ${event.id} has no competitions`);
      }
      // ADR-0021: an event whose competitors are undetermined is not yet a game
      // in our domain. Excluded here rather than marked downstream because a
      // Pick'em pick stores a side, not a team — seeding would silently convert
      // a submitted pick into a pick on a team the member never chose, and
      // ADR-0018's submit-once rule leaves them no remedy.
      if (competition.competitors.some(isPlaceholderCompetitor)) {
        return [];
      }
      return [mapCompetitionToGame(weekType, weekNumber, competition)];
    });
  }

  async fetchNflTeams(): Promise<ProviderTeam[]> {
    // Season-independent listing (ESPN scopes it by sport/league, not by
    // year) — `limit` set well above the current 32-team league size as
    // headroom against expansion.
    const url = `${this.#siteApiBaseUrl}/football/nfl/teams?limit=40`;
    const listing = TeamsListingSchema.parse(await this.#fetchJson(url));
    return listing.sports.flatMap((sport) =>
      sport.leagues.flatMap((league) => league.teams.map(mapTeamListItem)),
    );
  }

  async fetchNflTeamSeasonRecords(seasonYear: number): Promise<ProviderTeamSeasonRecord[]> {
    // One bulk request for all 32 teams — season-parameterized, and last
    // season keeps serving its final numbers, which is what makes the week-1
    // prior-season fallback (ADR-0040) a plain re-read rather than an archive.
    const url = `${this.#standingsApiBaseUrl}/football/nfl/standings?season=${seasonYear}`;
    const json = await this.#fetchJsonOrNotFound(url);
    if (json === null) {
      return [];
    }
    const standings = StandingsSchema.parse(json);
    // ESPN answers an unknown season with its latest one rather than a 404 —
    // a mismatched year means "not published", not data (ADR-0009's shape);
    // trusting it would stamp one season's records onto another's rows.
    if (standings.season.year !== seasonYear) {
      return [];
    }
    return standings.children.flatMap((child) =>
      child.standings.entries.map((entry) => mapStandingsEntry(entry, seasonYear)),
    );
  }

  async fetchNflGameStatContext(providerGameId: string): Promise<ProviderGameStatContext | null> {
    const url = `${this.#siteApiBaseUrl}/football/nfl/summary?event=${providerGameId}`;
    // An event ESPN can't answer for is "nothing to show", never a sync
    // failure — context is garnish on games we already have from the
    // scoreboard.
    const json = await this.#fetchJsonOrNotFound(url);
    if (json === null) {
      return null;
    }
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
}
