import type { PickType } from "@picksleagues/schemas";
import { useLeagueWeeks } from "@/api/picks";
import { useErrorToast } from "@/lib/use-error-toast";
import { LabeledSelect } from "@/components/labeled-select";
import { StandingsTable } from "@/components/league/standings-table";
import { StandingsWeekDetail } from "@/components/league/standings-week-detail";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/query-state";

// Not a real week id — the season-cumulative board's option in the toggle
// (spec §Standings: two parallel leaderboards). Chosen over `undefined` so it
// can be a normal option value in LabeledSelect.
const SEASON_SCOPE = "season";

// Pick'em's standings: a season/week toggle over one board (spec §Standings),
// plus the week/pick detail section once a specific week is selected — the
// two are combined here rather than as separate routes/tabs so the "week
// scope" state (owned by the caller, e.g. a URL search param) drives both.
export function StandingsSection({
  leagueId,
  weekId,
  onSelectWeek,
  pickType,
}: {
  leagueId: string;
  // undefined selects the season-cumulative board (the default view).
  weekId: string | undefined;
  onSelectWeek: (weekId: string | undefined) => void;
  pickType: PickType;
}) {
  const weeks = useLeagueWeeks(leagueId);

  useErrorToast(weeks.isError, "Couldn't load this league's weeks — please try again.");

  const allWeeks = weeks.data?.weeks ?? [];
  const scopeOptions = [
    { value: SEASON_SCOPE, label: "Season" },
    ...allWeeks.map((week) => ({ value: week.id, label: week.label })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Standings</CardTitle>
          <CardDescription>
            {weekId ? "That week's points only." : "Cumulative points across the season."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <QueryState
            isPending={weeks.isPending}
            pendingMessage="Loading weeks…"
            isError={weeks.isError}
            onRetry={() => weeks.refetch()}
            errorMessage="Couldn't load this league's weeks."
          >
            {weeks.data && (
              <>
                <LabeledSelect
                  id="standings-scope-select"
                  label="View"
                  value={weekId ?? SEASON_SCOPE}
                  onValueChange={(next) => onSelectWeek(next === SEASON_SCOPE ? undefined : next)}
                  options={scopeOptions}
                />
                <StandingsTable leagueId={leagueId} weekId={weekId} />
              </>
            )}
          </QueryState>
        </CardContent>
      </Card>

      {weekId && <StandingsWeekDetail leagueId={leagueId} weekId={weekId} pickType={pickType} />}
    </div>
  );
}
