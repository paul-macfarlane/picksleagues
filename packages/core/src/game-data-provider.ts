import { type GameStatus } from "@picksleagues/schemas";

export type ProviderWeek = {
  weekNumber: number;
  startsAt: Date;
  endsAt: Date;
};

export type ProviderSeasonStructure = {
  seasonYear: number;
  weeks: ProviderWeek[];
};

export type ProviderGame = {
  providerGameId: string;
  weekNumber: number;
  homeTeamAbbr: string;
  homeTeamName: string;
  awayTeamAbbr: string;
  awayTeamName: string;
  kickoffAt: Date;
  // Only the statuses a provider can produce — `moved` is override-only
  // (arch §Overrides): a provider "week move" surfaces as the game's week
  // FK changing, never as a status value.
  status: GameStatus;
  // null until the game is in progress or final; ESPN sends "0" pre-game,
  // which we deliberately do not surface as a score.
  homeScore: number | null;
  awayScore: number | null;
  // Home-relative spread (negative = home favored); null when the provider
  // has no line yet.
  spread: number | null;
};

/**
 * Domain-facing sports data source. Regular-season scope for MVP (arch D6):
 * implementations must contain their provider's response shapes entirely —
 * everything outside the adapter sees only these domain types, so swapping
 * providers touches one module (engineering rules: "provider shapes never
 * leak"). Request paths never call a provider directly; jobs ingest into our
 * own tables and reads serve those tables (arch §External Data).
 */
export interface GameDataProvider {
  fetchSeasonStructure(seasonYear: number): Promise<ProviderSeasonStructure>;
  fetchWeekGames(seasonYear: number, weekNumber: number): Promise<ProviderGame[]>;
}
