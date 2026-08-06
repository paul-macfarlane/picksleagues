import { useLeagueWeeks } from "@/api/weeks";
import { LabeledSelect } from "@/components/labeled-select";
import { PickemStandingsTable } from "@/components/league/pickem-standings-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/query-state";

// Not a real week id — the season-cumulative board's option in the toggle
// (spec §Standings: two parallel leaderboards). Chosen over `undefined` so it
// can be a normal option value in LabeledSelect.
const SEASON_SCOPE = "season";

// Pick'em's standings: a season/week toggle over one board (spec §Standings).
//
// This scope selector once also revealed the week/pick detail below it, which
// made the whole league's picks a side effect of a standings control — and made
// season standings + this week's picks an unreachable combination. That section
// now has its own tab (`/league-picks`), so this selector does one thing.
export function PickemStandingsSection({
  leagueId,
  weekId,
  onSelectWeek,
}: {
  leagueId: string;
  // undefined selects the season-cumulative board (the default view).
  weekId: string | undefined;
  onSelectWeek: (weekId: string | undefined) => void;
}) {
  const weeks = useLeagueWeeks(leagueId);

  const allWeeks = weeks.data?.weeks ?? [];
  const scopeOptions = [
    { value: SEASON_SCOPE, label: "Season" },
    ...allWeeks.map((week) => ({ value: week.id, label: week.label })),
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Addressed by testid rather than by a card whose title happens to read
          "Standings" (QLTY-2). */}
      <Card data-testid="standings-card">
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
                <PickemStandingsTable leagueId={leagueId} weekId={weekId} />
              </>
            )}
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}
