import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LEAGUE_MODE, type PickemSettings } from "@picksleagues/schemas";
import { useLeague } from "@/api/leagues";
import { PickemPicks } from "@/components/league/pickem-picks";
import { LeagueWeekPicker } from "@/components/league/league-week-picker";

const searchSchema = z.object({
  // Selection lives in the URL so a chosen week survives a refresh and is
  // linkable (same rationale as admin/games.tsx) — the week *list* and its
  // default still come from the server (GET .../weeks), never derived here.
  //
  // Independent of the League Picks tab's own `weekId` and of Overview's
  // `week`: each surface owns the week it is scoped to, so switching tabs
  // always lands on the current week rather than carrying a week the member
  // was inspecting somewhere else.
  weekId: z.string().optional(),
});

export const Route = createFileRoute("/_authed/leagues/$leagueId/my-picks")({
  validateSearch: searchSchema,
  component: LeaguePicks,
});

function LeaguePicks() {
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
      selectId="pickem-week-select"
      weekId={weekId}
      onSelectWeek={(next) => navigate({ search: { weekId: next }, replace: true })}
    >
      {(effectiveWeekId) => (
        <PickemPicks leagueId={leagueId} weekId={effectiveWeekId} pickType={pickType} />
      )}
    </LeagueWeekPicker>
  );
}
