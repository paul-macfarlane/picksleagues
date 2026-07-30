import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LEAGUE_MODE, type PickemSettings } from "@picksleagues/schemas";
import { useLeague } from "@/api/leagues";
import { PickemWeekDetail } from "@/components/league/pickem-week-detail";
import { LeagueWeekPicker } from "@/components/league/league-week-picker";

/**
 * Every member's picks for one week (spec §Screens inventory — "Week/pick
 * detail"), as its own section rather than a panel under the standings board.
 *
 * It used to appear on Overview only once the standings *scope* selector was
 * moved off "Season", which made the whole league's picks a side effect of a
 * standings control and left the most common pairing — season standings while
 * checking this week's picks — unreachable. A tab of its own is also what makes
 * it discoverable at all: nothing on Overview advertised that changing a
 * dropdown would reveal a second card.
 */

const searchSchema = z.object({
  // Same contract as the picks tab's: linkable, survives a refresh, and
  // defaults to the server's current week rather than one derived here. Its own
  // param, deliberately — see the note in picks.tsx.
  weekId: z.string().optional(),
});

export const Route = createFileRoute("/_authed/leagues/$leagueId/league-picks")({
  validateSearch: searchSchema,
  component: LeaguePicksAllMembers,
});

function LeaguePicksAllMembers() {
  const { leagueId } = Route.useParams();
  const { weekId } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Populated by the parent layout route — reads the same cache entry
  // (leagueQueryKey) instead of refetching.
  const league = useLeague(leagueId);

  if (!league.data) return null;
  // Direct navigation guard — the tab itself only renders for Pick'em
  // leagues (route.tsx), but this route is still reachable by URL.
  if (league.data.mode !== LEAGUE_MODE.PICKEM) return null;

  const { pickType } = league.data.settings as PickemSettings;

  return (
    <LeagueWeekPicker
      leagueId={leagueId}
      selectId="league-picks-week-select"
      weekId={weekId}
      onSelectWeek={(next) => navigate({ search: { weekId: next }, replace: true })}
    >
      {(effectiveWeekId) => (
        <PickemWeekDetail leagueId={leagueId} weekId={effectiveWeekId} pickType={pickType} />
      )}
    </LeagueWeekPicker>
  );
}
