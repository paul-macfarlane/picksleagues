import { createFileRoute } from "@tanstack/react-router";
import { useLeague } from "@/api/leagues";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    <Card>
      <CardHeader>
        <CardTitle>Standings</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filled per mode once picks/scoring ship (later epics) — nothing
            to compute yet. */}
        <p className="text-sm text-muted-foreground">Standings will appear here once picks ship.</p>
      </CardContent>
    </Card>
  );
}
