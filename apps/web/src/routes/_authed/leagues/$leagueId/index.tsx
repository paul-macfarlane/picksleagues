import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  LEAGUE_ACTION,
  LEAGUE_MODE,
  type LeagueResponse,
  type PickemSettings,
} from "@picksleagues/schemas";
import { useLeague, useRenewLeague } from "@/api/leagues";
import { canActOnLeague } from "@/lib/league";
import { StandingsSection } from "@/components/league/standings-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const searchSchema = z.object({
  // Absent selects the season-cumulative board — the spec's default view.
  // Present, it also drives the week/pick detail section below it. Lives in
  // the URL (same rationale as the picks tab's weekId) so a linked week
  // survives a refresh.
  week: z.string().optional(),
});

export const Route = createFileRoute("/_authed/leagues/$leagueId/")({
  validateSearch: searchSchema,
  component: LeagueOverview,
});

function LeagueOverview() {
  const { leagueId } = Route.useParams();
  const { week } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Populated by the parent layout route — this reads the same cache entry
  // (leagueQueryKey) and renders instantly rather than refetching.
  const league = useLeague(leagueId);

  if (!league.data) return null;

  return (
    <div className="flex flex-col gap-4">
      {league.data.renewable && canActOnLeague(league.data, LEAGUE_ACTION.RENEW_SEASON) && (
        <RenewSeasonBanner league={league.data} />
      )}
      {league.data.mode === LEAGUE_MODE.PICKEM ? (
        <StandingsSection
          leagueId={leagueId}
          weekId={week}
          onSelectWeek={(next) => navigate({ search: next ? { week: next } : {}, replace: true })}
          pickType={(league.data.settings as PickemSettings).pickType}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Standings</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Elimination's survivor board and MM's bracket leaderboard ship
                with their own epics — nothing to compute yet for those modes. */}
            <p className="text-sm text-muted-foreground">
              Standings for this game mode aren&apos;t available yet.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Commissioner-only nudge (ADR-0009 "renewal is explicit"): the next season's
// data exists, so offer to mint this league's next instance. Members without
// the capability never see it (the route guards on canActOnLeague above).
function RenewSeasonBanner({ league }: { league: LeagueResponse }) {
  const renew = useRenewLeague(league.id);
  return (
    <Card className="ring-primary/30">
      <CardHeader>
        <CardTitle>The next season is available</CardTitle>
        <CardDescription>
          Start the next season to carry {league.name} forward with its current settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button disabled={renew.isPending} onClick={() => renew.mutate()}>
          Start next season
        </Button>
      </CardContent>
    </Card>
  );
}
