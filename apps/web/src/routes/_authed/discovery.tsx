import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DiscoveryLeague } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { leagueModeLabel } from "@/lib/league";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MY_LEAGUES_QUERY_KEY } from "@/lib/my-leagues";

export const Route = createFileRoute("/_authed/discovery")({
  component: Discovery,
});

function Discovery() {
  // A live-filter query string, not a validated data-entry field — plain
  // state (not TanStack Form) is the right tool; submit-on-Enter avoids a
  // request per keystroke.
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const discovery = useQuery({
    queryKey: ["discovery", submittedQuery],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/discovery", {
        params: { query: { q: submittedQuery || undefined } },
      });
      if (error) throw error;
      return data;
    },
  });

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

      {discovery.isPending && <p className="text-sm text-muted-foreground">Loading leagues…</p>}

      {discovery.isError && (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load public leagues.</p>
          <Button variant="outline" onClick={() => discovery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {discovery.data && discovery.data.leagues.length === 0 && (
        <Card>
          <CardHeader className="items-center text-center">
            <CardTitle>No public leagues found</CardTitle>
            <CardDescription>
              {submittedQuery
                ? "Try a different search."
                : "There are no public leagues to join right now."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {discovery.data && discovery.data.leagues.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {discovery.data.leagues.map((league) => (
            <li key={league.id}>
              <DiscoveryLeagueCard league={league} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function DiscoveryLeagueCard({ league }: { league: DiscoveryLeague }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const join = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST("/api/leagues/{leagueId}/join", {
        params: { path: { leagueId: league.id } },
      });
      if (error) {
        // Join refusals (already a member, closed, full) are expected — the
        // server already phrases them — surface verbatim, don't throw.
        if (response.status === 409) {
          toast.error(error.message);
          return null;
        }
        throw error;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      toast.success(`Joined ${data.name}`);
      await queryClient.invalidateQueries({ queryKey: MY_LEAGUES_QUERY_KEY });
      navigate({ to: "/leagues/$leagueId", params: { leagueId: data.id } });
    },
    onError: () => {
      toast.error("Couldn't join that league — please try again.");
    },
  });

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
        <p>
          {league.startsAt
            ? `Starts ${new Date(league.startsAt).toLocaleString()}`
            : "Start date TBD"}
        </p>
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
