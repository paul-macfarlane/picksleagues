import {
  GAME_STATUS,
  SIM_FINAL_STATUS,
  type GameStatus,
  type SimFinalStatus,
  type WeekType,
} from "@picksleagues/schemas";
import type { Clock } from "./clock";
import type {
  GameDataProvider,
  ProviderGame,
  ProviderNflGameStatContext,
  ProviderSeasonStructure,
  ProviderTeam,
  ProviderNflTeamSeasonRecord,
  ProviderWeek,
} from "./game-data-provider";
import {
  deriveAtsSummary,
  deriveFpiWinPct,
  deriveLastFive,
  deriveTeamSeasonRecord,
  simInjuries,
  type SimCompletedGame,
} from "./sim-stats";

/**
 * The book the simulator reports behind its spreads. Deliberately the same name
 * ESPN currently attributes in production, so a sim-driven run exercises exactly
 * what a member sees rather than a shape only the simulator ever produces —
 * which is the whole point of the simulator being this repo's primary
 * verification harness.
 *
 * The trade-off, stated so nobody rediscovers it as a bug: these spreads are
 * synthesized (SIM-6), so this credits a real book for numbers it never priced.
 * That is contained because the simulator is dev-only — `SIM_ENABLED` gates it
 * and its routes are not registered in production (ADR-0011) — so no member ever
 * sees this string. A screenshot or demo of a simulated slate does misattribute,
 * and that is the accepted cost. Change this to an obviously-synthetic name if
 * simulated slates ever become externally visible.
 */
const SIMULATED_SPREAD_SOURCE = "DraftKings";

/**
 * How long a game is reported `in_progress` after kickoff before its terminal
 * status takes effect. Roughly a real NFL broadcast window; the exact value only
 * has to be long enough that "advance an hour into the slate" lands mid-game.
 */
export const SIM_GAME_DURATION_MS = 3 * 60 * 60 * 1000 + 15 * 60 * 1000;

/**
 * The regulation shape a simulated game's clock walks through: four periods,
 * each counting a 15:00 game clock down to 0:00 over an equal share of
 * `SIM_GAME_DURATION_MS`. Simulated games never go to overtime — a fixture
 * stores only its terminal score, so there is nothing to derive a fifth period
 * from.
 */
const SIM_PERIODS = 4;
const SIM_PERIOD_SECONDS = 15 * 60;

/** A fixture row as the provider sees it — the simulator's stand-in for an ESPN event. */
export type SimFixtureGameRow = {
  providerGameId: string;
  weekType: WeekType;
  weekNumber: number;
  homeTeamAbbr: string;
  homeTeamName: string;
  homeTeamProviderId: string;
  awayTeamAbbr: string;
  awayTeamName: string;
  awayTeamProviderId: string;
  kickoffAt: Date;
  spread: number | null;
  finalStatus: SimFinalStatus;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
};

/** Everything the provider needs to serve one loaded scenario. */
export type SimFixtureSnapshot = {
  seasonYear: number;
  weeks: ProviderWeek[];
  games: SimFixtureGameRow[];
  teams: ProviderTeam[];
};

/** Reads the active scenario's fixtures (injected from apps/api — packages/core has no DB). */
export type SimFixtureReader = () => Promise<SimFixtureSnapshot>;

export type ProjectedGameState = {
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  // Live in-game state, matching `ProviderGame`: null unless the game is in
  // progress at `now`.
  period: number | null;
  clockSeconds: number | null;
};

/**
 * Where the game clock stands `elapsedMs` into a simulated game (DATA-8).
 * Derived purely from elapsed time — the same instant always produces the same
 * reading, so a replay is reproducible (arch D14) and no wall clock is read.
 *
 * Real elapsed time maps linearly onto the regulation clock: each quarter of
 * the window is one period whose 15:00 counts down across it. `ceil` puts the
 * clock at a full 15:00 at the top of a period and lets it reach 0:00 only at
 * the instant the period ends — which is the next period's top, or full time.
 *
 * Unlike the deliberately frozen 0-0 score, this *is* meant to move with the
 * clock: an operator advancing the simulated clock through a slate is exactly
 * how the live-state ingestion path gets exercised end to end.
 */
function projectGameClock(elapsedMs: number): { period: number; clockSeconds: number } {
  const periodMs = SIM_GAME_DURATION_MS / SIM_PERIODS;
  const periodIndex = Math.min(SIM_PERIODS - 1, Math.floor(elapsedMs / periodMs));
  const elapsedInPeriodMs = elapsedMs - periodIndex * periodMs;
  return {
    period: periodIndex + 1,
    clockSeconds: Math.ceil(SIM_PERIOD_SECONDS * (1 - elapsedInPeriodMs / periodMs)),
  };
}

/**
 * What the provider would report for a fixture at instant `now` (ADR-0012).
 * Fixtures store a season's terminal truth; this projects it back through the
 * simulated clock so that advancing time and re-running the sync jobs makes a
 * week unfold exactly as a real one does.
 *
 * Pure and total — the whole simulator's time behaviour is decided here, so it
 * is unit-tested at every boundary instant rather than only through the DB.
 *
 * Boundaries are half-open, matching the derived-lock rule (arch D11,
 * `locked = kickoff_at <= now`): a game is `scheduled` strictly before kickoff
 * and `in_progress` from the kickoff instant itself.
 */
export function projectFixtureGame(fixture: SimFixtureGameRow, now: Date): ProjectedGameState {
  // Cancellations and postponements are announced ahead of time, not discovered
  // at kickoff — a provider reports them for a game that never starts, so the
  // clock never moves these off their terminal status.
  if (fixture.finalStatus !== SIM_FINAL_STATUS.FINAL) {
    return {
      status: fixture.finalStatus,
      homeScore: null,
      awayScore: null,
      period: null,
      clockSeconds: null,
    };
  }

  const kickoffMs = fixture.kickoffAt.getTime();
  const nowMs = now.getTime();

  if (nowMs < kickoffMs) {
    return {
      status: GAME_STATUS.SCHEDULED,
      homeScore: null,
      awayScore: null,
      period: null,
      clockSeconds: null,
    };
  }

  if (nowMs < kickoffMs + SIM_GAME_DURATION_MS) {
    // Zeros rather than the eventual final score, held stable for the whole
    // window. Two reasons, both about what the simulator is for: a score that
    // varied with the clock would make replays non-deterministic (arch D14), and
    // revealing the final score early would let code that wrongly settles a
    // non-final game produce accidentally-correct output. Grading against 0-0 is
    // visibly wrong, which is the bug report we want.
    return {
      status: GAME_STATUS.IN_PROGRESS,
      homeScore: 0,
      awayScore: 0,
      ...projectGameClock(nowMs - kickoffMs),
    };
  }

  return {
    status: GAME_STATUS.FINAL,
    homeScore: fixture.finalHomeScore,
    awayScore: fixture.finalAwayScore,
    period: null,
    clockSeconds: null,
  };
}

function toProviderGame(fixture: SimFixtureGameRow, now: Date): ProviderGame {
  const projected = projectFixtureGame(fixture, now);
  return {
    providerGameId: fixture.providerGameId,
    weekType: fixture.weekType,
    weekNumber: fixture.weekNumber,
    homeTeamAbbr: fixture.homeTeamAbbr,
    homeTeamName: fixture.homeTeamName,
    awayTeamAbbr: fixture.awayTeamAbbr,
    awayTeamName: fixture.awayTeamName,
    homeTeamProviderId: fixture.homeTeamProviderId,
    awayTeamProviderId: fixture.awayTeamProviderId,
    kickoffAt: fixture.kickoffAt,
    status: projected.status,
    homeScore: projected.homeScore,
    awayScore: projected.awayScore,
    period: projected.period,
    clockSeconds: projected.clockSeconds,
    spread: fixture.spread,
    // Null when the fixture has no line — nothing priced is nothing to credit.
    spreadSource: fixture.spread === null ? null : SIMULATED_SPREAD_SOURCE,
  };
}

/**
 * Serves a loaded scenario's fixtures through the same `GameDataProvider`
 * contract as ESPN, so the existing sync jobs ingest simulated seasons with no
 * knowledge that they are simulated (arch §Simulator & Time point 2).
 *
 * Scoped to its scenario's season: any other year reports "no weeks / no games",
 * the same shape `EspnProvider` returns for a season ESPN hasn't published
 * (ADR-0009). A loaded scenario means the environment is under test, so mixing
 * simulated and live seasons in one run is deliberately not possible.
 */
export class SimulatedProvider implements GameDataProvider {
  readonly #readFixtures: SimFixtureReader;
  readonly #clock: Clock;
  // Resolved once per provider instance (i.e. per request/job): a job fetches
  // week by week, and every one of those reads must see the same fixtures and
  // the same instant.
  #snapshot: Promise<SimFixtureSnapshot> | null = null;

  constructor(readFixtures: SimFixtureReader, clock: Clock) {
    this.#readFixtures = readFixtures;
    this.#clock = clock;
  }

  #fixtures(): Promise<SimFixtureSnapshot> {
    this.#snapshot ??= this.#readFixtures();
    return this.#snapshot;
  }

  async fetchNflSeasonStructure(seasonYear: number): Promise<ProviderSeasonStructure> {
    const snapshot = await this.#fixtures();
    if (snapshot.seasonYear !== seasonYear) {
      return { seasonYear, weeks: [] };
    }
    return { seasonYear, weeks: snapshot.weeks };
  }

  async fetchNflWeekGames(
    seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    const snapshot = await this.#fixtures();
    if (snapshot.seasonYear !== seasonYear) {
      return [];
    }
    const now = this.#clock.now();
    return snapshot.games
      .filter((game) => game.weekType === weekType && game.weekNumber === weekNumber)
      .map((game) => toProviderGame(game, now));
  }

  async fetchNflTeams(): Promise<ProviderTeam[]> {
    return (await this.#fixtures()).teams;
  }

  async fetchNflTeamSeasonRecords(seasonYear: number): Promise<ProviderNflTeamSeasonRecord[]> {
    const snapshot = await this.#fixtures();
    if (snapshot.seasonYear !== seasonYear) {
      return [];
    }
    // Derived from the games the simulated clock has completed (STAT-3,
    // ADR-0040), so records advance week by week exactly as ESPN's would —
    // and a scenario positioned before its first kickoff serves all-zero
    // records, which is what routes the read path to its prior-season
    // fallback in the sim too.
    const completed = completedGamesAt(snapshot.games, this.#clock.now());
    return snapshot.teams.map((team) => ({
      providerTeamId: team.providerTeamId,
      seasonYear,
      ...deriveTeamSeasonRecord(team.providerTeamId, completed),
    }));
  }

  async fetchNflGameStatContext(
    providerGameId: string,
  ): Promise<ProviderNflGameStatContext | null> {
    const snapshot = await this.#fixtures();
    const fixture = snapshot.games.find((game) => game.providerGameId === providerGameId);
    if (!fixture) {
      return null;
    }
    const completed = completedGamesAt(snapshot.games, this.#clock.now());
    const teamContext = (side: "home" | "away") => {
      const teamProviderId =
        side === "home" ? fixture.homeTeamProviderId : fixture.awayTeamProviderId;
      const teamAbbr = side === "home" ? fixture.homeTeamAbbr : fixture.awayTeamAbbr;
      return {
        // Mocked, never replayed — era-correct injury history does not exist
        // at the provider (ADR-0040).
        injuries: simInjuries(teamAbbr),
        fpiWinPct: deriveFpiWinPct(fixture.spread, side),
        atsSummary: deriveAtsSummary(teamProviderId, completed),
        lastFive: deriveLastFive(teamProviderId, completed),
      };
    };
    return { providerGameId, home: teamContext("home"), away: teamContext("away") };
  }
}

/**
 * The fixtures that are final at `now`, projected through the same
 * `projectFixtureGame` every other provider read uses — one clock rule,
 * not two (ADR-0012).
 */
function completedGamesAt(games: SimFixtureGameRow[], now: Date): SimCompletedGame[] {
  return games.flatMap((fixture) => {
    const projected = projectFixtureGame(fixture, now);
    if (
      projected.status !== GAME_STATUS.FINAL ||
      projected.homeScore === null ||
      projected.awayScore === null
    ) {
      return [];
    }
    return [
      {
        homeTeamProviderId: fixture.homeTeamProviderId,
        awayTeamProviderId: fixture.awayTeamProviderId,
        homeTeamAbbr: fixture.homeTeamAbbr,
        awayTeamAbbr: fixture.awayTeamAbbr,
        homeScore: projected.homeScore,
        awayScore: projected.awayScore,
        kickoffAt: fixture.kickoffAt,
        spread: fixture.spread,
      },
    ];
  });
}
