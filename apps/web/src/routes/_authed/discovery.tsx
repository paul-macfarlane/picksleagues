import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { DiscoveryLeague } from "@picksleagues/schemas";
import { useDiscovery } from "@/api/discovery";
import { useJoinPublicLeague } from "@/api/members";
import { leagueModeLabel } from "@/lib/league";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CardGridSkeleton } from "@/components/loading";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/query-state";

export const Route = createFileRoute("/_authed/discovery")({
  component: Discovery,
});

function Discovery() {
  // A live-filter query string, not a validated data-entry field — plain
  // state (not TanStack Form) is the right tool; submit-on-Enter avoids a
  // request per keystroke.
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const discovery = useDiscovery(submittedQuery);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-foreground">Browse public leagues</h1>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedQuery(query.trim());
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="discovery-search">Search</Label>
          <Input
            id="discovery-search"
            placeholder="Search by league name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button type="submit" size="lg">
          Search
        </Button>
      </form>

      <QueryState
        isPending={discovery.isPending}
        pendingFallback={<CardGridSkeleton label="Loading public leagues" />}
        isError={discovery.isError}
        onRetry={() => void discovery.refetch()}
        errorMessage="Couldn't load public leagues."
        isEmpty={discovery.data?.leagues.length === 0}
        emptyMessage={
          submittedQuery
            ? "No public leagues found — try a different search."
            : "There are no public leagues to join right now."
        }
      >
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {discovery.data?.leagues.map((league) => (
            <li key={league.id}>
              <DiscoveryLeagueCard league={league} />
            </li>
          ))}
        </ul>
      </QueryState>
    </main>
  );
}

function DiscoveryLeagueCard({ league }: { league: DiscoveryLeague }) {
  const join = useJoinPublicLeague(league.id);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{league.name}</CardTitle>
        <CardDescription>{leagueModeLabel(league.mode)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {league.memberCount} member{league.memberCount === 1 ? "" : "s"}
          </span>
          <span>{league.seasonYear}</span>
        </div>
        <p>{league.startsAt ? `Starts ${formatDateTime(league.startsAt)}` : "Start date TBD"}</p>
        <Button
          size="lg"
          className="w-full justify-center"
          disabled={join.isPending}
          onClick={() => join.mutate()}
        >
          {join.isPending ? "Joining…" : "Join league"}
        </Button>
      </CardContent>
    </Card>
  );
}
