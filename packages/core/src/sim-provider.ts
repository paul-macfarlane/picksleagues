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
  ProviderSeasonStructure,
  ProviderTeam,
  ProviderWeek,
} from "./game-data-provider";

/**
 * How long a game is reported `in_progress` after kickoff before its terminal
 * status takes effect. Roughly a real NFL broadcast window; the exact value only
 * has to be long enough that "advance an hour into the slate" lands mid-game.
 */
export const SIM_GAME_DURATION_MS = 3 * 60 * 60 * 1000 + 15 * 60 * 1000;

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
};

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
    return { status: fixture.finalStatus, homeScore: null, awayScore: null };
  }

  const kickoffMs = fixture.kickoffAt.getTime();
  const nowMs = now.getTime();

  if (nowMs < kickoffMs) {
    return { status: GAME_STATUS.SCHEDULED, homeScore: null, awayScore: null };
  }

  if (nowMs < kickoffMs + SIM_GAME_DURATION_MS) {
    // Zeros rather than the eventual final score, held stable for the whole
    // window. Two reasons, both about what the simulator is for: a score that
    // varied with the clock would make replays non-deterministic (arch D14), and
    // revealing the final score early would let code that wrongly settles a
    // non-final game produce accidentally-correct output. Grading against 0-0 is
    // visibly wrong, which is the bug report we want.
    return { status: GAME_STATUS.IN_PROGRESS, homeScore: 0, awayScore: 0 };
  }

  return {
    status: GAME_STATUS.FINAL,
    homeScore: fixture.finalHomeScore,
    awayScore: fixture.finalAwayScore,
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
    spread: fixture.spread,
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
}
