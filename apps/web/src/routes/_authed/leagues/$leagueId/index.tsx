import { createFileRoute } from "@tanstack/react-router";
import { LEAGUE_ACTION, type LeagueResponse } from "@picksleagues/schemas";
import { useLeague, useRenewLeague } from "@/api/leagues";
import { canActOnLeague } from "@/lib/league";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authed/leagues/$leagueId/")({
  component: LeagueOverview,
});

function LeagueOverview() {
  const { leagueId } = Route.useParams();
  // Populated by the parent layout route — this reads the same cache entry
  // (leagueQueryKey) and renders instantly rather than refetching.
  const league = useLeague(leagueId);

  if (!league.data) return null;

  return (
    <div className="flex flex-col gap-4">
      {league.data.renewable && canActOnLeague(league.data, LEAGUE_ACTION.RENEW_SEASON) && (
        <RenewSeasonBanner league={league.data} />
      )}
      <Card>
        <CardHeader>
          <CardTitle>Standings</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filled per mode once picks/scoring ship (later epics) — nothing
              to compute yet. */}
          <p className="text-sm text-muted-foreground">
            Standings will appear here once picks ship.
          </p>
        </CardContent>
      </Card>
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
