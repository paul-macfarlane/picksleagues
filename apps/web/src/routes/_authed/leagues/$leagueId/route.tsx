import { useEffect } from "react";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { toast } from "sonner";
import { LEAGUE_MODE, MEMBER_ROLE } from "@picksleagues/schemas";
import { LeagueHeader } from "@/components/league/league-header";
import { useLeague } from "@/api/leagues";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabNav, tabLinkProps } from "@/components/tab-nav";

export const Route = createFileRoute("/_authed/leagues/$leagueId")({
  component: LeagueLayout,
});

function LeagueLayout() {
  const { leagueId } = Route.useParams();
  const league = useLeague(leagueId);

  useEffect(() => {
    if (league.isError) {
      toast.error("Couldn't load this league — please try again.");
    }
  }, [league.isError]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      {league.isPending && (
        <div className="flex flex-col items-center gap-2 py-8">
          <p className="text-sm text-muted-foreground">Loading league…</p>
        </div>
      )}

      {league.isError && (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this league.</p>
          <Button variant="outline" onClick={() => league.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!league.isPending && !league.isError && !league.data && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Card className="w-full max-w-sm">
            <CardHeader className="items-center text-center">
              <CardTitle>League not found</CardTitle>
              <CardDescription>
                This league doesn&apos;t exist, or you&apos;re not a member.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to="/"
                className={buttonVariants({ size: "lg", className: "w-full justify-center" })}
              >
                Back to dashboard
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {league.data && (
        <>
          <LeagueHeader
            league={league.data}
            isCommissioner={league.data.myRole === MEMBER_ROLE.COMMISSIONER}
          />

          <TabNav label="League sections">
            <Link
              to="/leagues/$leagueId"
              params={{ leagueId }}
              // `includeSearch: false` because the Overview tab owns a `?week=`
              // search param (the standings period). Router compares search
              // alongside the path by default, and `exact` makes that
              // comparison a full equality — so selecting any non-default
              // period left the tab reading as inactive on the very route it
              // was on. The tab marks the section, and the section is the path.
              activeOptions={{ exact: true, includeSearch: false }}
              {...tabLinkProps}
            >
              Overview
            </Link>
            {league.data.mode === LEAGUE_MODE.PICKEM && (
              <Link to="/leagues/$leagueId/picks" params={{ leagueId }} {...tabLinkProps}>
                Picks
              </Link>
            )}
            <Link to="/leagues/$leagueId/members" params={{ leagueId }} {...tabLinkProps}>
              Members
            </Link>
            <Link to="/leagues/$leagueId/settings" params={{ leagueId }} {...tabLinkProps}>
              Settings
            </Link>
          </TabNav>

          <Outlet />
        </>
      )}
    </main>
  );
}
