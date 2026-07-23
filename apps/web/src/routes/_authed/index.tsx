import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRightIcon } from "lucide-react";
import { MEMBER_ROLE, type LeagueSummary } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { leagueModeLabel } from "@/lib/league";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
});

function Dashboard() {
  const myLeagues = useQuery({
    queryKey: ["my-leagues"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/leagues");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (myLeagues.isError) {
      toast.error("Couldn't load your leagues — please try again.");
    }
  }, [myLeagues.isError]);

  if (myLeagues.isPending) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Loading your leagues…</p>
      </main>
    );
  }

  if (myLeagues.isError || !myLeagues.data) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your leagues.</p>
        <Button variant="outline" onClick={() => myLeagues.refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  const { leagues } = myLeagues.data;

  if (leagues.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4 sm:p-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <CardTitle>No leagues yet</CardTitle>
            <CardDescription>
              Create a league to start picking, or find a public one to join.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Link
              to="/leagues/new"
              className={buttonVariants({ size: "lg", className: "w-full justify-center" })}
            >
              Create a league
            </Link>
            <Link
              to="/discovery"
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "w-full justify-center",
              })}
            >
              Browse public leagues
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Your leagues</h1>
        <Link to="/leagues/new" className={buttonVariants({ size: "lg" })}>
          Create league
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {leagues.map((league) => (
          <li key={league.id}>
            <LeagueCard league={league} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function LeagueCard({ league }: { league: LeagueSummary }) {
  return (
    <Card className="relative h-full transition-colors hover:ring-ring/50">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <Link
            to="/leagues/$leagueId"
            params={{ leagueId: league.id }}
            className="rounded-sm outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {league.name}
          </Link>
          <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </CardTitle>
        <CardDescription>{leagueModeLabel(league.mode)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {league.memberCount} member{league.memberCount === 1 ? "" : "s"}
          </span>
          {league.myRole === MEMBER_ROLE.COMMISSIONER && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Commissioner
            </span>
          )}
        </div>
        <p>
          {league.startsAt
            ? `Starts ${new Date(league.startsAt).toLocaleString()}`
            : "Start date TBD"}
        </p>
        {/* Pick tables land in later epics — nothing to summarize yet. */}
        <p className="text-xs text-muted-foreground/70">Pick status coming soon</p>
      </CardContent>
    </Card>
  );
}
