import type {
  GameDataProvider,
  ProviderGame,
  ProviderGameStatContext,
  ProviderSeasonStructure,
  ProviderTeam,
  ProviderTeamSeasonRecord,
} from "@picksleagues/core";
import type { WeekType } from "@picksleagues/schemas";

/**
 * Empty-world default for every `GameDataProvider` method, so a test fake
 * overrides only the surface it exercises — before this, every new interface
 * method broke seven per-file fakes at once (the STAT epic's two additions
 * were the third time).
 */
export class BaseFakeProvider implements GameDataProvider {
  async fetchNflSeasonStructure(seasonYear: number): Promise<ProviderSeasonStructure> {
    return { seasonYear, weeks: [] };
  }

  async fetchNflWeekGames(
    _seasonYear: number,
    _weekType: WeekType,
    _weekNumber: number,
  ): Promise<ProviderGame[]> {
    return [];
  }

  async fetchNflTeams(): Promise<ProviderTeam[]> {
    return [];
  }

  async fetchNflTeamSeasonRecords(_seasonYear: number): Promise<ProviderTeamSeasonRecord[]> {
    return [];
  }

  async fetchNflGameStatContext(_providerGameId: string): Promise<ProviderGameStatContext | null> {
    return null;
  }
}
