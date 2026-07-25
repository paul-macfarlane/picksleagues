import type { GameDataProvider, ProviderGame, ProviderWeek } from "@picksleagues/core";

/**
 * Fetches several weeks' games concurrently and collapses them to one game per
 * `providerGameId`, last-wins.
 *
 * The dedupe is not cosmetic: ESPN transiently lists a rescheduled game under
 * both its old and its new week, and a multi-row `INSERT ... ON CONFLICT DO
 * UPDATE` that hits the same row twice throws Postgres "cannot affect row a
 * second time" and aborts the entire run. Last-wins keeps the later week's copy,
 * which is the reschedule.
 *
 * Shared by the schedule sync (both its main and offseason paths) and the
 * simulator's replay importer — all three fetch a whole season week by week and
 * must dedupe identically, or the same feed would ingest differently depending
 * on which one ran.
 */
export async function fetchSeasonGames(
  provider: GameDataProvider,
  seasonYear: number,
  weeks: Pick<ProviderWeek, "weekType" | "weekNumber">[],
): Promise<{ games: ProviderGame[]; duplicates: number }> {
  const perWeek = await Promise.all(
    weeks.map((week) => provider.fetchNflWeekGames(seasonYear, week.weekType, week.weekNumber)),
  );

  const byProviderGameId = new Map<string, ProviderGame>();
  let duplicates = 0;
  for (const game of perWeek.flat()) {
    if (byProviderGameId.has(game.providerGameId)) {
      duplicates += 1;
    }
    byProviderGameId.set(game.providerGameId, game);
  }

  return { games: [...byProviderGameId.values()], duplicates };
}
