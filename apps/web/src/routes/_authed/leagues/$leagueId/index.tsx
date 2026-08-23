import { createFileRoute } from "@tanstack/react-router";
import { LEAGUE_ACTION, LEAGUE_MODE, type LeagueResponse } from "@picksleagues/schemas";
import { useLeague, useRenewLeague } from "@/api/leagues";
import { useAppNow } from "@/lib/app-clock";
import { canActOnLeague } from "@/lib/league";
import { PickemStandingsSection } from "@/components/league/pickem-standings-section";
import { SurvivorBoard } from "@/components/league/survivor-board";
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
  const now = useAppNow();

  if (!league.data) return null;

  return (
    <div className="flex flex-col gap-4">
      {league.data.renewable &&
        (canActOnLeague(league.data, LEAGUE_ACTION.RENEW_SEASON, now) ? (
          <RenewSeasonBanner league={league.data} />
        ) : (
          <NextSeasonWaitingBanner league={league.data} />
        ))}
      {league.data.mode === LEAGUE_MODE.PICKEM ? (
        <PickemStandingsSection leagueId={leagueId} />
      ) : league.data.mode === LEAGUE_MODE.SURVIVOR ? (
        // Survivor's board is the whole season at once, because there is
        // nothing weekly to total (ADR-0016).
        <SurvivorBoard leagueId={leagueId} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Standings</CardTitle>
          </CardHeader>
          <CardContent>
            {/* March Madness's bracket leaderboard ships with its own epic —
                nothing to compute yet for that mode. */}
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
// the capability get the sibling below instead — never this one, since the
// route guards on canActOnLeague above.
function RenewSeasonBanner({ league }: { league: LeagueResponse }) {
  const renew = useRenewLeague(league.id);
  return (
    <Card className="ring-foreground/30">
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

// The same fact without the action, so the dashboard pill that told a member a
// season was waiting isn't contradicted by a silent league page. Deliberately
// carries no link to the roster: the Members tab is already on screen here, and
// naming a commissioner in the copy would be wrong anyway — a league may have
// several with identical powers (spec §Commissioner Powers).
function NextSeasonWaitingBanner({ league }: { league: LeagueResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>The next season is available</CardTitle>
        <CardDescription>
          A commissioner can start the next season to carry {league.name} forward with its current
          settings.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
