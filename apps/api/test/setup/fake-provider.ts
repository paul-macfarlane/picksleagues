import type {
  GameDataProvider,
  ProviderGame,
  ProviderGameStatContext,
  ProviderSeasonStructure,
  ProviderTeam,
  ProviderTeamSeasonRecord,
} from "@picksleagues/core";

/**
 * Empty-world default for every `GameDataProvider` method, so a test fake
 * overrides only the surface it exercises — before this, every new interface
 * method broke seven per-file fakes at once (the STAT epic's two additions
 * were the third time). Methods declare no parameters (an override adds the
 * ones it reads): fewer params is assignable, and an unused arg here is a
 * lint error.
 */
export class BaseFakeProvider implements GameDataProvider {
  async fetchNflSeasonStructure(seasonYear: number): Promise<ProviderSeasonStructure> {
    return { seasonYear, weeks: [] };
  }

  async fetchNflWeekGames(): Promise<ProviderGame[]> {
    return [];
  }

  async fetchNflTeams(): Promise<ProviderTeam[]> {
    return [];
  }

  async fetchNflTeamSeasonRecords(): Promise<ProviderTeamSeasonRecord[]> {
    return [];
  }

  async fetchNflGameStatContext(): Promise<ProviderGameStatContext | null> {
    return null;
  }
}
