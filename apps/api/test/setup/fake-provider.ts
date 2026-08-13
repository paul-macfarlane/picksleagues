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
 * were the third time). Methods keep the interface's full parameter lists
 * (a zero-arg base would reject every override that declares them), so the
 * deliberately ignored ones carry inline lint waivers.
 */
export class BaseFakeProvider implements GameDataProvider {
  async fetchNflSeasonStructure(seasonYear: number): Promise<ProviderSeasonStructure> {
    return { seasonYear, weeks: [] };
  }

  async fetchNflWeekGames(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept for overrides; the empty-world default ignores it
    _seasonYear: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept for overrides; the empty-world default ignores it
    _weekType: WeekType,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept for overrides; the empty-world default ignores it
    _weekNumber: number,
  ): Promise<ProviderGame[]> {
    return [];
  }

  async fetchNflTeams(): Promise<ProviderTeam[]> {
    return [];
  }

  async fetchNflTeamSeasonRecords(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept for overrides; the empty-world default ignores it
    _seasonYear: number,
  ): Promise<ProviderTeamSeasonRecord[]> {
    return [];
  }

  async fetchNflGameStatContext(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept for overrides; the empty-world default ignores it
    _providerGameId: string,
  ): Promise<ProviderGameStatContext | null> {
    return null;
  }
}

/**
 * Map-backed fake for the suites that exercise the stats pipeline
 * (nfl-sync-stats, game-stats): one shared shape instead of a near-verbatim
 * subclass per file — the exact drift BaseFakeProvider exists to prevent.
 * `recordFetches` records the season years asked for, which is how the
 * prior-season fallback window's gating is asserted.
 */
export class StatsFakeProvider extends BaseFakeProvider {
  structure: ProviderSeasonStructure = { seasonYear: 0, weeks: [] };
  gamesByWeek = new Map<string, ProviderGame[]>();
  recordsByYear = new Map<number, ProviderTeamSeasonRecord[]>();
  contextByGameId = new Map<string, ProviderGameStatContext>();
  recordFetches: number[] = [];

  static weekKey(weekType: WeekType, weekNumber: number): string {
    return `${weekType}:${weekNumber}`;
  }

  override async fetchNflSeasonStructure(): Promise<ProviderSeasonStructure> {
    return this.structure;
  }

  override async fetchNflWeekGames(
    _seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    return this.gamesByWeek.get(StatsFakeProvider.weekKey(weekType, weekNumber)) ?? [];
  }

  override async fetchNflTeamSeasonRecords(
    seasonYear: number,
  ): Promise<ProviderTeamSeasonRecord[]> {
    this.recordFetches.push(seasonYear);
    return this.recordsByYear.get(seasonYear) ?? [];
  }

  override async fetchNflGameStatContext(
    providerGameId: string,
  ): Promise<ProviderGameStatContext | null> {
    return this.contextByGameId.get(providerGameId) ?? null;
  }
}
