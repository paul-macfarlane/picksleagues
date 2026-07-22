import { z } from "zod";
import { GAME_STATUS, type GameStatus } from "@picksleagues/schemas";
import type {
  GameDataProvider,
  ProviderGame,
  ProviderSeasonStructure,
  ProviderWeek,
} from "./game-data-provider";

const DEFAULT_SITE_API_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports";
const DEFAULT_CORE_API_BASE_URL = "https://sports.core.api.espn.com/v2/sports";

// Regular season only for MVP scope (arch D6).
const REGULAR_SEASON_TYPE = 2;

// --- ESPN response shapes: private to this adapter (engineering rules: "provider shapes never leak"). ---

const WeeksIndexSchema = z.object({
  items: z.array(z.object({ $ref: z.string() })),
});

const WeekDetailSchema = z.looseObject({
  number: z.number(),
  startDate: z.string(),
  endDate: z.string(),
});

const CompetitorSchema = z.looseObject({
  homeAway: z.string(),
  score: z.string().optional(),
  team: z.looseObject({
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
  }),
  competitors: z.array(CompetitorSchema),
  odds: z.array(z.looseObject({ spread: z.number().optional() })).optional(),
});

const EventSchema = z.looseObject({
  id: z.string(),
  competitions: z.array(CompetitionSchema).min(1),
});

const ScoreboardSchema = z.looseObject({
  events: z.array(EventSchema),
});

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

function mapCompetitionToGame(
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

  // ESPN's spread is home-relative (negative = home favored), matching our
  // convention — verified against live ESPN data (2026 season week 1
  // scoreboard, 16/16 games consistent, 2026-07-21).
  const rawSpread = competition.odds?.[0]?.spread;
  const spread = typeof rawSpread === "number" && Number.isFinite(rawSpread) ? rawSpread : null;

  return {
    providerGameId: competition.id,
    weekNumber,
    homeTeamAbbr: home.team.abbreviation,
    homeTeamName: home.team.displayName,
    awayTeamAbbr: away.team.abbreviation,
    awayTeamName: away.team.displayName,
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
    spread,
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

  constructor(options?: {
    fetchImpl?: typeof fetch;
    siteApiBaseUrl?: string;
    coreApiBaseUrl?: string;
  }) {
    this.#fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    this.#siteApiBaseUrl = options?.siteApiBaseUrl ?? DEFAULT_SITE_API_BASE_URL;
    this.#coreApiBaseUrl = options?.coreApiBaseUrl ?? DEFAULT_CORE_API_BASE_URL;
  }

  async #fetchJson(url: string): Promise<unknown> {
    const response = await this.#fetchImpl(url);
    if (!response.ok) {
      throw new Error(`EspnProvider: GET ${url} failed with status ${response.status}`);
    }
    return response.json();
  }

  async fetchSeasonStructure(seasonYear: number): Promise<ProviderSeasonStructure> {
    const indexUrl = `${this.#coreApiBaseUrl}/football/leagues/nfl/seasons/${seasonYear}/types/${REGULAR_SEASON_TYPE}/weeks?limit=32`;
    const index = WeeksIndexSchema.parse(await this.#fetchJson(indexUrl));

    const weeks: ProviderWeek[] = await Promise.all(
      index.items.map(async (item) => {
        const detail = WeekDetailSchema.parse(await this.#fetchJson(item.$ref));
        return {
          weekNumber: detail.number,
          startsAt: parseDateStrict(detail.startDate, `week ${detail.number} startDate`),
          endsAt: parseDateStrict(detail.endDate, `week ${detail.number} endDate`),
        };
      }),
    );

    return { seasonYear, weeks };
  }

  async fetchWeekGames(seasonYear: number, weekNumber: number): Promise<ProviderGame[]> {
    const url = `${this.#siteApiBaseUrl}/football/nfl/scoreboard?seasontype=${REGULAR_SEASON_TYPE}&week=${weekNumber}&dates=${seasonYear}`;
    const scoreboard = ScoreboardSchema.parse(await this.#fetchJson(url));

    return scoreboard.events.map((event) => {
      // `min(1)` on the schema guarantees this, but TS's noUncheckedIndexedAccess
      // can't see through that — guard explicitly rather than asserting.
      const [competition] = event.competitions;
      if (!competition) {
        throw new Error(`EspnProvider: event ${event.id} has no competitions`);
      }
      return mapCompetitionToGame(weekNumber, competition);
    });
  }
}
