import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  LeagueModeSchema,
  OFFERED_LEAGUE_MODES,
  type DiscoveryLeague,
  type LeagueMode,
} from "@picksleagues/schemas";
import { useDiscovery } from "@/api/discovery";
import { useJoinPublicLeague } from "@/api/members";
import { useAppNow } from "@/lib/app-clock";
import { leagueModeLabel, leagueTimingLine, pickTypeLabel } from "@/lib/league";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CardGridSkeleton } from "@/components/loading";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LabeledSelect } from "@/components/labeled-select";
import { Pagination } from "@/components/ui/pagination";
import { QueryState } from "@/components/query-state";
import { StatusPill } from "@/components/status-pill";

// Filters live in the URL, not component state: a browse list is a thing
// members share and come back to, and Back after opening a league has to return
// to the page they were on rather than the top of an unfiltered list.
const searchSchema = z.object({
  q: z.string().optional(),
  mode: LeagueModeSchema.optional(),
  page: z.number().int().min(1).optional(),
});

export const Route = createFileRoute("/_authed/discovery")({
  validateSearch: searchSchema,
  component: Discovery,
});

const ALL_MODES = "all";

function Discovery() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const submittedQuery = search.q ?? "";
  const page = search.page ?? 1;

  // The text input is the one filter that isn't applied per keystroke — a
  // request per character — so it holds a draft until submit; the select and
  // the pager write straight to the URL.
  const [draftQuery, setDraftQuery] = useState(submittedQuery);
  // …but the URL can change without this box: a Back out of a search has to
  // take the words out of it too, or the input claims a filter the results
  // aren't under. Tracked against the last applied query rather than assigned
  // in an effect, so no render ever paints the two disagreeing.
  const [appliedQuery, setAppliedQuery] = useState(submittedQuery);
  if (submittedQuery !== appliedQuery) {
    setAppliedQuery(submittedQuery);
    setDraftQuery(submittedQuery);
  }

  const discovery = useDiscovery({ q: submittedQuery, mode: search.mode ?? null, page });

  // Any filter change resets to page 1: page 3 of the old list names nothing in
  // the new one, and the server would clamp it to a page the pager didn't ask
  // for.
  const setFilters = (next: { q?: string; mode?: LeagueMode }) => {
    void navigate({
      search: {
        q: (next.q ?? submittedQuery) || undefined,
        mode: "mode" in next ? next.mode : search.mode,
      },
    });
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-foreground">Browse public leagues</h1>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <form
          className="flex flex-1 items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setFilters({ q: draftQuery.trim() });
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="discovery-search">Search</Label>
            <Input
              id="discovery-search"
              placeholder="Search by league name"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
            />
          </div>
          <Button type="submit" size="lg">
            Search
          </Button>
        </form>
        <div className="sm:w-48">
          <LabeledSelect
            id="discovery-mode"
            label="Game mode"
            value={search.mode ?? ALL_MODES}
            onValueChange={(next) =>
              setFilters({ mode: next === ALL_MODES ? undefined : (next as LeagueMode) })
            }
            options={[
              { value: ALL_MODES, label: "All modes" },
              // Only modes a league can exist in — March Madness has none to
              // find until epic 07 builds the mode.
              ...OFFERED_LEAGUE_MODES.map((mode) => ({
                value: mode,
                label: leagueModeLabel(mode),
              })),
            ]}
          />
        </div>
      </div>

      <QueryState
        isPending={discovery.isPending}
        pendingFallback={<CardGridSkeleton label="Loading public leagues" />}
        isError={discovery.isError}
        onRetry={() => void discovery.refetch()}
        errorMessage="Couldn't load public leagues."
        isEmpty={discovery.data?.total === 0}
        emptyMessage={
          submittedQuery || search.mode
            ? "No public leagues match those filters."
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
        <Pagination
          className="pt-2"
          page={discovery.data?.page ?? 1}
          totalPages={discovery.data?.totalPages ?? 1}
          onPageChange={(next) => void navigate({ search: { ...search, page: next } })}
        />
      </QueryState>
    </main>
  );
}

/**
 * What a member is signing up for, in the order they need it: which game they'd
 * be playing, how much room is left, and the settings that decide what the
 * league asks of them each week (FB-35). Survivor shows no settings line
 * because it has no member-facing setting to show — its rules are the mode.
 */
function DiscoveryLeagueCard({ league }: { league: DiscoveryLeague }) {
  const join = useJoinPublicLeague(league.id);
  const now = useAppNow();
  const spotsLeft = league.maxMembers - league.memberCount;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{league.name}</CardTitle>
        {/* The mode is the one attribute that decides whether a member wants
            this league at all, so it carries a pill's weight rather than a
            caption's (FB-36). */}
        <CardDescription className="flex flex-wrap items-center gap-2">
          <StatusPill tone="accent">{leagueModeLabel(league.mode)}</StatusPill>
          <span>{league.seasonYear}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-2">
          <span>
            {league.memberCount} of {league.maxMembers} members
          </span>
          {/* Named where the count already is: "2 spots left" is the reason
              this league sorts where it does (ADR-0037). */}
          <span className="text-foreground">
            {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
          </span>
        </div>
        {league.pickemSettings && (
          <p>
            {pickTypeLabel(league.pickemSettings.pickType)} · {league.pickemSettings.picksPerWeek}{" "}
            pick
            {league.pickemSettings.picksPerWeek === 1 ? "" : "s"} per week
          </p>
        )}
        <p>{leagueTimingLine(league, now)}</p>
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
