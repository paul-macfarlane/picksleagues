import { type GameStatus, type WeekType } from "@picksleagues/schemas";

export type ProviderWeek = {
  weekType: WeekType;
  // DOMAIN numbering, not the provider's: regular 1..18, postseason contiguous
  // 1..4 with Super Bowl = 4 (aligned with `NflWeekRef` and
  // `estimatedNflWeeks`). Adapters own any translation from their own scheme
  // — e.g. ESPN numbers the postseason 1,2,3,5 (its 4 is the excluded Pro
  // Bowl); its adapter maps that gap away so this field is always domain.
  weekNumber: number;
  // Provider display label ("Week 1", "Wild Card") — the only correct wording
  // for a postseason round, which a bare weekNumber can't produce.
  label: string;
  startsAt: Date;
  endsAt: Date;
};

export type ProviderSeasonStructure = {
  seasonYear: number;
  // Regular-season and postseason weeks in one structure (Pro Bowl already
  // excluded); each week carries its `weekType` to disambiguate the two
  // number spaces (both restart at 1).
  weeks: ProviderWeek[];
};

export type ProviderGame = {
  providerGameId: string;
  // Which scoreboard this game came from — regular and postseason week numbers
  // overlap, so the (weekType, weekNumber) pair is what identifies its week.
  weekType: WeekType;
  weekNumber: number;
  homeTeamAbbr: string;
  homeTeamName: string;
  awayTeamAbbr: string;
  awayTeamName: string;
  // Provider identity for each team (ESPN's team.id) — the real key teams are
  // matched on; the four text fields above stay for display-data upsert
  // (arch ADR-0010: provider id is the durable identity, abbreviation is the
  // pre-provider-id bootstrap key).
  homeTeamProviderId: string;
  awayTeamProviderId: string;
  kickoffAt: Date;
  // A provider "week move" surfaces as the game's week FK changing, never as a
  // status value (ADR-0019).
  status: GameStatus;
  // null until the game is in progress or final; ESPN sends "0" pre-game,
  // which we deliberately do not surface as a score.
  homeScore: number | null;
  awayScore: number | null;
  /**
   * Live in-game state, normalized (DATA-8): `period` is the 1-based period a
   * game in progress is in (>4 in overtime), `clockSeconds` the whole seconds
   * remaining in that period. Both null whenever the game is not in progress —
   * a scheduled game has no clock, and a finished one's frozen 0:00 is not live
   * state. Providers normalize their own display forms away (ESPN's
   * `displayClock` never leaves its adapter); formatting is the client's job.
   */
  period: number | null;
  clockSeconds: number | null;
  // Home-relative spread (negative = home favored); null when the provider
  // has no line yet.
  spread: number | null;
  // The book the spread came from (PKM-9) — free text from the provider, not a
  // const set: ESPN has rotated books before and a fixed set would go stale the
  // next time it does. Null whenever `spread` is null, and also when the
  // provider reports odds with no attributed book.
  spreadSource: string | null;
};

export type ProviderTeam = {
  providerTeamId: string;
  abbreviation: string;
  name: string;
  // City/market (ESPN's `location`, e.g. "Kansas City").
  location: string;
  // Light-background and dark-background logo variants; null when the
  // provider's listing has no corresponding asset for a team.
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
};

/**
 * Domain-facing sports data source. Implementations must contain their
 * provider's response shapes entirely — everything outside the adapter sees
 * only these domain types, so swapping providers touches one module
 * (engineering rules: "provider shapes never leak"). Request paths never call a
 * provider directly; jobs ingest into our own tables and reads serve those
 * tables (arch §External Data).
 *
 * Methods are named per sport rather than generically: the NCAAMB bracket
 * methods for the March Madness epic will be added here as their own explicitly
 * named methods, so each sport's shape stays legible on one interface rather
 * than hiding behind a generic surface.
 */
export interface GameDataProvider {
  // Regular season and postseason in one structure, Pro Bowl already excluded.
  fetchNflSeasonStructure(seasonYear: number): Promise<ProviderSeasonStructure>;
  /**
   * Every returned game names determined competitors. An event whose teams the
   * provider has not settled yet — an unseeded playoff round, which ESPN
   * publishes months ahead against placeholder competitors — is not yet a game
   * in our domain and must not be returned (ADR-0021). It arrives normally, on
   * the same `providerGameId`, once the provider seeds the matchup.
   */
  fetchNflWeekGames(
    seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]>;
  // The full current NFL teams listing (season-independent) — used to enrich
  // `teams` rows with display metadata the per-game scoreboard shape doesn't
  // carry (location, logos). A provider team not yet in this listing (e.g. a
  // TBD playoff placeholder) simply never gets enriched.
  fetchNflTeams(): Promise<ProviderTeam[]>;
}
