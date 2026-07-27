import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LEAGUE_MODE, type PickemSettings } from "@picksleagues/schemas";
import { useLeagueWeeks } from "@/api/picks";
import { useLeague } from "@/api/leagues";
import { PickemPicks } from "@/components/league/pickem-picks";
import { LabeledSelect } from "@/components/labeled-select";

const searchSchema = z.object({
  // Selection lives in the URL so a chosen week survives a refresh and is
  // linkable (same rationale as admin/games.tsx) — the week *list* and its
  // default still come from the server (GET .../weeks), never derived here.
  weekId: z.string().optional(),
});

export const Route = createFileRoute("/_authed/leagues/$leagueId/picks")({
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
  const weeks = useLeagueWeeks(leagueId);

  if (!league.data) return null;
  // Direct navigation guard — the tab itself only renders for Pick'em
  // leagues (route.tsx), but this route is still reachable by URL.
  if (league.data.mode !== LEAGUE_MODE.PICKEM) return null;

  const allWeeks = weeks.data?.weeks ?? [];
  const effectiveWeekId = weekId ?? weeks.data?.currentWeekId ?? undefined;

  return (
    <div className="flex flex-col gap-4">
      {weeks.isPending && (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading weeks…</p>
      )}

      {weeks.isError && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load this league&apos;s weeks.
        </p>
      )}

      {weeks.data && allWeeks.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No weeks in range for this league yet.
        </p>
      )}

      {weeks.data && allWeeks.length > 0 && (
        <>
          <LabeledSelect
            id="pickem-week-select"
            label="Week"
            value={effectiveWeekId ?? null}
            onValueChange={(next) => navigate({ search: { weekId: next }, replace: true })}
            options={allWeeks.map((week) => ({ value: week.id, label: week.label }))}
          />

          {effectiveWeekId && (
            <PickemPicks
              leagueId={leagueId}
              weekId={effectiveWeekId}
              pickType={(league.data.settings as PickemSettings).pickType}
            />
          )}
        </>
      )}
    </div>
  );
}
