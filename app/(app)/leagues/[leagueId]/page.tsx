import { notFound } from "next/navigation";

import {
  SeasonSwitcher,
  type SeasonOption,
} from "@/components/leagues/season-switcher";
import { StandingsTable } from "@/components/leagues/standings-table";
import { getLeagueById } from "@/data/leagues";
import { getPhasesBySeason } from "@/data/phases";
import { getPickResultsForLeagueSeason } from "@/data/picks";
import {
  getSeasonsWithStandingsForLeague,
  getStandingsForLeagueSeasonWithProfiles,
} from "@/data/standings";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSession } from "@/lib/auth";
import {
  phaseOrdinal,
  selectCurrentSeason,
  selectStandingsSeason,
} from "@/lib/nfl/leagues";
import {
  calculatePhaseOverPhaseDeltas,
  type StandingsDelta,
} from "@/lib/nfl/scoring";
import { getAppNow } from "@/lib/simulator";

export default async function LeagueStandingsPage(
  props: PageProps<"/leagues/[leagueId]">,
) {
  const { leagueId } = await props.params;
  const searchParams = await props.searchParams;
  const session = await getSession();

  const league = await getLeagueById(leagueId);
  if (!league) notFound();

  const now = await getAppNow();
  const [seasons, seasonsWithStandings] = await Promise.all([
    getSeasonsBySportsLeague(league.sportsLeagueId),
    getSeasonsWithStandingsForLeague(leagueId),
  ]);
  const currentSeason = selectCurrentSeason(seasons, now);

  const requestedSeasonId =
    typeof searchParams.season === "string" ? searchParams.season : null;
  const selectedSeason = selectStandingsSeason({
    seasonsWithStandings,
    currentSeason,
    requestedSeasonId,
  });

  if (!selectedSeason) {
    return (
      <section className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No season data available yet.
        </p>
      </section>
    );
  }

  const standings = await getStandingsForLeagueSeasonWithProfiles(
    leagueId,
    selectedSeason.id,
  );

  // Phase-over-phase deltas are rendered alongside rank. Skip the extra
  // fetches when there are no standings yet — the table short-circuits its
  // own empty state and there's nothing to compare against.
  let deltas: ReadonlyMap<string, StandingsDelta> = new Map();
  if (standings.length > 0) {
    const [pickResults, phases] = await Promise.all([
      getPickResultsForLeagueSeason(leagueId, selectedSeason.id),
      getPhasesBySeason(selectedSeason.id),
    ]);
    const phaseOrdinalById = new Map(
      phases.map((p) => [p.id, phaseOrdinal(p.seasonType, p.weekNumber)]),
    );
    deltas = calculatePhaseOverPhaseDeltas(
      standings.map((s) => ({ userId: s.userId, rank: s.rank })),
      pickResults,
      phaseOrdinalById,
    );
  }

  // Dropdown draws from historical seasons; include the current season
  // when it's not yet in the historical list so brand-new leagues still
  // show the current year as an option rather than hiding the switcher.
  const seasonOptions: SeasonOption[] = seasonsWithStandings.map((s) => ({
    id: s.id,
    year: s.year,
  }));
  if (
    currentSeason &&
    !seasonOptions.some((option) => option.id === currentSeason.id)
  ) {
    seasonOptions.push({ id: currentSeason.id, year: currentSeason.year });
  }
  // Newest first — matches every other "season list" in the app.
  seasonOptions.sort((a, b) => b.year - a.year);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Standings</h2>
        {seasonOptions.length > 1 ? (
          <SeasonSwitcher
            options={seasonOptions}
            selectedSeasonId={selectedSeason.id}
          />
        ) : null}
      </header>
      <StandingsTable
        standings={standings}
        deltas={deltas}
        viewerUserId={session.user.id}
      />
    </div>
  );
}
