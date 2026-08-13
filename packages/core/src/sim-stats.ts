import {
  LAST_GAME_RESULT,
  type InjuryReportEntry,
  type LastFiveGame,
  type LastGameResult,
} from "@picksleagues/schemas";
import { seededUnitInterval } from "./sim-spread";

/**
 * Matchup-stats derivation for the simulator (STAT-3, ADR-0040). Records, ATS,
 * and recent form are *derived from the fixtures' completed games* rather than
 * stored as fixture data, so a replayed season's stats always agree with the
 * scores the member can see on its slates — and advance with the simulated
 * clock the way ESPN's would with real time. Injuries are the exception:
 * era-correct injury history does not exist at the provider (a historical
 * summary answers with the *current* report), so they are synthesized —
 * deterministically, like spreads (arch D14): fictional names on a stable
 * hash of the team, never `Math.random`.
 *
 * Pure functions over plain data — `SimulatedProvider` projects fixtures
 * through the simulated clock first and hands the completed games here.
 */

/** One game that is final at the simulated now, as `sim-provider.ts` projects it. */
export type SimCompletedGame = {
  homeTeamProviderId: string;
  awayTeamProviderId: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  homeScore: number;
  awayScore: number;
  kickoffAt: Date;
  spread: number | null;
};

type TeamGameView = {
  result: LastGameResult;
  opponentAbbr: string;
  teamScore: number;
  opponentScore: number;
  atHome: boolean;
  spread: number | null;
  kickoffAt: Date;
};

/** A team's completed games from its own perspective, oldest first. */
function teamGames(teamProviderId: string, completed: SimCompletedGame[]): TeamGameView[] {
  return completed
    .filter(
      (game) =>
        game.homeTeamProviderId === teamProviderId || game.awayTeamProviderId === teamProviderId,
    )
    .sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime())
    .map((game) => {
      const atHome = game.homeTeamProviderId === teamProviderId;
      const teamScore = atHome ? game.homeScore : game.awayScore;
      const opponentScore = atHome ? game.awayScore : game.homeScore;
      return {
        result:
          teamScore > opponentScore
            ? LAST_GAME_RESULT.WIN
            : teamScore < opponentScore
              ? LAST_GAME_RESULT.LOSS
              : LAST_GAME_RESULT.TIE,
        opponentAbbr: atHome ? game.awayTeamAbbr : game.homeTeamAbbr,
        teamScore,
        opponentScore,
        atHome,
        spread: game.spread,
        kickoffAt: game.kickoffAt,
      };
    });
}

export type SimTeamRecord = {
  wins: number;
  losses: number;
  ties: number;
  homeWins: number;
  homeLosses: number;
  homeTies: number;
  roadWins: number;
  roadLosses: number;
  roadTies: number;
  streak: number;
  pointsFor: number;
  pointsAgainst: number;
};

export function deriveTeamSeasonRecord(
  teamProviderId: string,
  completed: SimCompletedGame[],
): SimTeamRecord {
  const games = teamGames(teamProviderId, completed);
  const record: SimTeamRecord = {
    wins: 0,
    losses: 0,
    ties: 0,
    homeWins: 0,
    homeLosses: 0,
    homeTies: 0,
    roadWins: 0,
    roadLosses: 0,
    roadTies: 0,
    streak: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
  for (const game of games) {
    record.pointsFor += game.teamScore;
    record.pointsAgainst += game.opponentScore;
    if (game.result === LAST_GAME_RESULT.WIN) {
      record.wins += 1;
      if (game.atHome) record.homeWins += 1;
      else record.roadWins += 1;
    } else if (game.result === LAST_GAME_RESULT.LOSS) {
      record.losses += 1;
      if (game.atHome) record.homeLosses += 1;
      else record.roadLosses += 1;
    } else {
      record.ties += 1;
      if (game.atHome) record.homeTies += 1;
      else record.roadTies += 1;
    }
  }
  // Signed consecutive-result count from the most recent game backwards,
  // matching the standings feed's convention; a tie carries no streak.
  const latest = games[games.length - 1];
  if (latest && latest.result !== LAST_GAME_RESULT.TIE) {
    let streak = 0;
    for (let i = games.length - 1; i >= 0 && games[i]!.result === latest.result; i -= 1) {
      streak += 1;
    }
    record.streak = latest.result === LAST_GAME_RESULT.WIN ? streak : -streak;
  }
  return record;
}

/**
 * ATS record over the games that carried a line, in the provider's "W-L" /
 * "W-L-P" summary form; null when none did — the same "no ATS data yet" shape
 * ESPN serves early in a season.
 */
export function deriveAtsSummary(
  teamProviderId: string,
  completed: SimCompletedGame[],
): string | null {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  for (const game of teamGames(teamProviderId, completed)) {
    if (game.spread === null) continue;
    // `spread` is home-relative, so flip it for the road perspective: a team
    // covers when its margin beats the line it was laying.
    const teamSpread = game.atHome ? game.spread : -game.spread;
    const marginVsLine = game.teamScore - game.opponentScore + teamSpread;
    if (marginVsLine > 0) wins += 1;
    else if (marginVsLine < 0) losses += 1;
    else pushes += 1;
  }
  if (wins + losses + pushes === 0) return null;
  return pushes > 0 ? `${wins}-${losses}-${pushes}` : `${wins}-${losses}`;
}

export function deriveLastFive(
  teamProviderId: string,
  completed: SimCompletedGame[],
): LastFiveGame[] {
  return teamGames(teamProviderId, completed)
    .slice(-5)
    .reverse()
    .map((game) => ({
      result: game.result,
      opponentAbbr: game.opponentAbbr,
      teamScore: game.teamScore,
      opponentScore: game.opponentScore,
      atHome: game.atHome,
    }));
}

// 2.5 points of spread ≈ 1 tenth of win probability keeps a synthesized FPI in
// the range real lines produce (a 7-point favorite ≈ 67%), clamped so even a
// max spread never reads as a certainty.
const FPI_POINTS_PER_PCT = 2.5;
const FPI_MIN = 5;
const FPI_MAX = 95;

/**
 * A plausible FPI pair derived from the fixture's spread — null when the game
 * has no line, exercising the UI's omission path exactly where ESPN would
 * (its predictor is also absent when it has nothing to say).
 */
export function deriveFpiWinPct(spread: number | null, side: "home" | "away"): number | null {
  if (spread === null) return null;
  // Negative spread = home favored, so the home probability rises as it drops.
  const homePct = Math.min(FPI_MAX, Math.max(FPI_MIN, 50 - spread * FPI_POINTS_PER_PCT));
  const pct = side === "home" ? homePct : 100 - homePct;
  return Math.round(pct * 10) / 10;
}

// Fictional-name pools for mocked injuries. Deliberately name-shaped (the UI
// under test should render what production renders) but belonging to no real
// roster, so a simulated screenshot never claims a real athlete is hurt — the
// concern SIMULATED_SPREAD_SOURCE accepts for the book name is *not* accepted
// for a person.
const INJURY_FIRST_NAMES = ["Alex", "Jordan", "Casey", "Riley", "Morgan", "Taylor", "Drew"];
const INJURY_LAST_NAMES = ["Simmons", "Fielder", "Granger", "Hollis", "Marsh", "Bennett", "Cole"];
const INJURY_POSITIONS = ["QB", "RB", "WR", "TE", "CB", "S", "LB"];
const INJURY_STATUSES = ["Out", "Doubtful", "Questionable"];
const INJURY_TYPES = ["Ankle", "Hamstring", "Knee", "Shoulder", "Concussion"];

function pick<T>(pool: T[], seed: string): T {
  return pool[Math.floor(seededUnitInterval(seed) * pool.length)]!;
}

/**
 * A team's mocked injury report: 1–3 deterministic entries keyed off the
 * abbreviation alone, so the same team reads the same on every surface and
 * every re-run (arch D14). Statuses span the tier boundary (Out/Doubtful are
 * basic-tier "key injuries", Questionable is advanced-only) so both tiers of
 * the sheet always have something to exercise.
 */
export function simInjuries(teamAbbr: string): InjuryReportEntry[] {
  const count = 1 + Math.floor(seededUnitInterval(`${teamAbbr}:count`) * 3);
  return Array.from({ length: count }, (_, index) => {
    const seed = `${teamAbbr}:${index}`;
    return {
      athleteName: `${pick(INJURY_FIRST_NAMES, `${seed}:first`)} ${pick(INJURY_LAST_NAMES, `${seed}:last`)}`,
      position: pick(INJURY_POSITIONS, `${seed}:position`),
      // Entry 0 is always a key injury so the basic tier is never empty.
      status: index === 0 ? INJURY_STATUSES[0]! : pick(INJURY_STATUSES, `${seed}:status`),
      injuryType: pick(INJURY_TYPES, `${seed}:type`),
    };
  });
}
