import type { Db } from "@picksleagues/db";
import {
  type Clock,
  type GameDataProvider,
  latestCompletedNflSeasonYear,
  synthesizeSpread,
} from "@picksleagues/core";
import { fetchSeasonGames } from "../nfl/fetch-season-games";
import {
  ERROR_CODE,
  GAME_STATUS,
  type GameStatus,
  SIM_FINAL_STATUS,
  SIM_SCENARIO_SOURCE,
  SPORT,
  type SimFinalStatus,
} from "@picksleagues/schemas";
import { type MaterializedScenario, type SimTeamDef, writeScenario } from "./definition";

/**
 * Positions the simulated clock before anything in the imported season has
 * happened (ADR-0012): landing exactly on the earliest kickoff would already
 * have the week's first game locked.
 */
const STARTS_AT_MARGIN_MS = 60 * 60 * 1000;

/**
 * Historical ESPN feeds should carry only terminal statuses — `final`,
 * `cancelled`, or `postponed`. `scheduled`/`in_progress` are defensive
 * fallbacks for a season the provider hasn't fully settled (treated as FINAL
 * when both scores are present, POSTPONED otherwise) — never a reason to fail
 * the whole import. Exhaustive switch over `GAME_STATUS` so a future status
 * value fails typechecking here rather than silently falling through.
 */
function mapFinalStatus(
  status: GameStatus,
  homeScore: number | null,
  awayScore: number | null,
): { finalStatus: SimFinalStatus; unexpectedStatus: boolean } {
  switch (status) {
    case GAME_STATUS.FINAL:
      return { finalStatus: SIM_FINAL_STATUS.FINAL, unexpectedStatus: false };
    case GAME_STATUS.CANCELLED:
      return { finalStatus: SIM_FINAL_STATUS.CANCELLED, unexpectedStatus: false };
    case GAME_STATUS.POSTPONED:
      return { finalStatus: SIM_FINAL_STATUS.POSTPONED, unexpectedStatus: false };
    case GAME_STATUS.SCHEDULED:
    case GAME_STATUS.IN_PROGRESS:
      return {
        finalStatus:
          homeScore !== null && awayScore !== null
            ? SIM_FINAL_STATUS.FINAL
            : SIM_FINAL_STATUS.POSTPONED,
        unexpectedStatus: true,
      };
  }
}

export type ImportReplayResult =
  | { ok: true; details: Record<string, string | number | boolean> }
  | { ok: false; reason: typeof ERROR_CODE.SEASON_NOT_AVAILABLE };

/**
 * Whether a season is far enough in the past to have results worth replaying:
 * its Super Bowl must have already been played, per `latestCompletedNflSeasonYear`.
 *
 * Judged against **real** time, never the simulated clock: loading a replay
 * deliberately parks the simulated clock inside the replayed season, so a
 * simulated-time check would declare that very season un-importable and make
 * refreshing a loaded replay impossible.
 */
export function isReplayableSeasonYear(realNow: Date, seasonYear: number): boolean {
  return seasonYear <= latestCompletedNflSeasonYear(realNow);
}

/**
 * Imports a real past NFL season from the provider as a replayable scenario
 * (SIM-6, ADR-0011 decision 4). The one write path is `writeScenario`, so an
 * imported season and a hand-authored library scenario are indistinguishable
 * to the `SimulatedProvider` once written.
 */
export async function importReplaySeason(
  db: Db,
  clock: Clock,
  espn: GameDataProvider,
  seasonYear: number,
  realNow: Date,
): Promise<ImportReplayResult> {
  // A future/current season has no completed results to replay — checked
  // before any fetch so a still-in-progress season never partially imports.
  // The route rejects this case first; kept as the service's own guard.
  if (!isReplayableSeasonYear(realNow, seasonYear)) {
    return { ok: false, reason: ERROR_CODE.SEASON_NOT_AVAILABLE };
  }

  const structure = await espn.fetchNflSeasonStructure(seasonYear);
  // ESPN 404s an unpublished/unindexed season — the same "nothing to replay"
  // refusal as a season that's too recent.
  if (structure.weeks.length === 0) {
    return { ok: false, reason: ERROR_CODE.SEASON_NOT_AVAILABLE };
  }

  // Fetch phase before any DB write (never hold a transaction open across a
  // network call).
  const [{ games: providerGames }, providerTeams] = await Promise.all([
    fetchSeasonGames(espn, seasonYear, structure.weeks),
    espn.fetchNflTeams(),
  ]);
  const providerTeamsById = new Map(providerTeams.map((team) => [team.providerTeamId, team]));

  let spreadsSynthesized = 0;
  let gamesWithoutResult = 0;
  let unexpectedStatuses = 0;
  const referencedTeams = new Map<string, SimTeamDef>();
  const games: MaterializedScenario["games"] = [];

  // Only teams a game actually references — with a fallback derived from the
  // game row itself when the listing is missing one, so an incomplete
  // listing can never drop a team a game references. No per-game `location`
  // field exists on `ProviderGame`, so the fallback location is the team name.
  const rememberTeam = (providerTeamId: string, abbreviation: string, name: string) => {
    if (referencedTeams.has(providerTeamId)) return;
    const listed = providerTeamsById.get(providerTeamId);
    referencedTeams.set(providerTeamId, {
      providerTeamId,
      abbreviation: listed?.abbreviation ?? abbreviation,
      name: listed?.name ?? name,
      location: listed?.location ?? name,
      // Carried through from the listing so a replayed season renders with the
      // same logos a live sync would. Null when the listing is missing the team
      // entirely — the game row a fallback is built from has no logo to offer.
      logoLightUrl: listed?.logoLightUrl ?? null,
      logoDarkUrl: listed?.logoDarkUrl ?? null,
    });
  };

  for (const game of providerGames) {
    rememberTeam(game.homeTeamProviderId, game.homeTeamAbbr, game.homeTeamName);
    rememberTeam(game.awayTeamProviderId, game.awayTeamAbbr, game.awayTeamName);

    const { finalStatus, unexpectedStatus } = mapFinalStatus(
      game.status,
      game.homeScore,
      game.awayScore,
    );
    if (unexpectedStatus) unexpectedStatuses += 1;
    if (finalStatus !== SIM_FINAL_STATUS.FINAL) gamesWithoutResult += 1;

    // Always synthesized, never the provider's own `spread`: historical ESPN
    // feeds strip odds, and preferring a stray provider value would make
    // re-imports of the same season non-reproducible (ADR-0011 decision 4).
    const spread = synthesizeSpread(game.providerGameId, game.homeScore, game.awayScore);
    if (spread !== null) spreadsSynthesized += 1;

    games.push({
      providerGameId: game.providerGameId,
      weekType: game.weekType,
      weekNumber: game.weekNumber,
      homeTeamAbbr: game.homeTeamAbbr,
      homeTeamName: game.homeTeamName,
      homeTeamProviderId: game.homeTeamProviderId,
      awayTeamAbbr: game.awayTeamAbbr,
      awayTeamName: game.awayTeamName,
      awayTeamProviderId: game.awayTeamProviderId,
      kickoffAt: game.kickoffAt,
      spread,
      finalStatus,
      finalHomeScore: game.homeScore,
      finalAwayScore: game.awayScore,
    });
  }

  // No games at all falls back to the earliest week's own start — `weeks` is
  // non-empty here (the empty-structure case already returned above).
  const earliestMs =
    games.length > 0
      ? Math.min(...games.map((game) => game.kickoffAt.getTime()))
      : Math.min(...structure.weeks.map((week) => week.startsAt.getTime()));
  const startsAt = new Date(earliestMs - STARTS_AT_MARGIN_MS);

  const slug = `replay-nfl-${seasonYear}`;
  const materialized: MaterializedScenario = {
    slug,
    name: `NFL ${seasonYear} replay`,
    description: `Replay of the real NFL ${seasonYear} season; spreads are synthesized because ESPN's historical feeds carry no odds.`,
    // NFL is the only simulated sport until the March Madness epic (SIM-8).
    sport: SPORT.NFL,
    seasonYear,
    source: SIM_SCENARIO_SOURCE.REPLAY,
    startsAt,
    teams: [...referencedTeams.values()],
    weeks: structure.weeks,
    games,
  };

  await writeScenario(db, clock, materialized);

  return {
    ok: true,
    details: {
      slug,
      seasonYear,
      weeks: materialized.weeks.length,
      games: materialized.games.length,
      teams: materialized.teams.length,
      spreadsSynthesized,
      gamesWithoutResult,
      unexpectedStatuses,
    },
  };
}
