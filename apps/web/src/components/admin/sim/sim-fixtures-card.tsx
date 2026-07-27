import { useState } from "react";
import { WEEK_TYPE, type SimStateResponse, type WeekType } from "@picksleagues/schemas";
import { useSimFixtureGames } from "@/api/sim";
import { AdminQueryState } from "@/components/admin/query-state";
import { weekTypeLabel } from "@/lib/game";
import { SimFixtureRow } from "@/components/admin/sim/sim-fixture-row";
import { LabeledSelect } from "@/components/labeled-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Sentinel for "no filter" — `LabeledSelect` is generic over `string` and
// needs a real option value, so an empty string (easy to confuse with an
// actual blank input elsewhere) isn't used.
const FILTER_ALL = "all";

// `UpdateSimFixtureGameRequestSchema.weekNumber`'s own bound (sim.ts) — every
// week an NFL season can produce, regular or postseason.
const MAX_WEEK_NUMBER = 18;
const WEEK_NUMBER_OPTIONS = Array.from({ length: MAX_WEEK_NUMBER }, (_, index) =>
  String(index + 1),
);

export function SimFixturesCard({ state }: { state: SimStateResponse }) {
  const [scenarioChoice, setScenarioChoice] = useState<string>();
  const [weekTypeFilter, setWeekTypeFilter] = useState<WeekType | typeof FILTER_ALL>(FILTER_ALL);
  const [weekNumberFilter, setWeekNumberFilter] = useState(FILTER_ALL);

  // Resolved against the scenarios actually loaded, never trusted from local
  // state (same idiom as sim-clock-card.tsx's season resolution): an
  // environment reset can delete the active scenario's fixtures, and a stale
  // choice would otherwise select an id the list no longer has.
  const selectedScenarioId =
    state.scenarios.find((scenario) => scenario.id === scenarioChoice)?.id ??
    state.activeScenario?.id ??
    state.scenarios[0]?.id;

  const weekType = weekTypeFilter === FILTER_ALL ? undefined : weekTypeFilter;
  const weekNumber = weekNumberFilter === FILTER_ALL ? undefined : Number(weekNumberFilter);
  const fixtures = useSimFixtureGames(selectedScenarioId, weekType, weekNumber);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fixtures</CardTitle>
        <CardDescription>
          A scenario&apos;s fixtures and their live projection. &quot;Final&quot; is the
          fixture&apos;s terminal truth; the provider reports &quot;projected&quot; (scheduled/in
          progress) until the simulated clock passes a game&apos;s kickoff (ADR-0012) — hand-edit
          either side below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <LabeledSelect
              id="sim-fixtures-scenario"
              label="Scenario"
              value={selectedScenarioId ?? null}
              onValueChange={setScenarioChoice}
              options={state.scenarios.map((scenario) => ({
                value: scenario.id,
                label: `${scenario.name} (${scenario.gameCount} games)`,
              }))}
            />
            <LabeledSelect
              id="sim-fixtures-week-type"
              label="Week type"
              value={weekTypeFilter}
              onValueChange={setWeekTypeFilter}
              options={[
                { value: FILTER_ALL, label: "All" },
                ...Object.values(WEEK_TYPE).map((value) => ({
                  value,
                  label: weekTypeLabel(value),
                })),
              ]}
            />
            <LabeledSelect
              id="sim-fixtures-week-number"
              label="Week"
              value={weekNumberFilter}
              onValueChange={setWeekNumberFilter}
              options={[
                { value: FILTER_ALL, label: "All" },
                ...WEEK_NUMBER_OPTIONS.map((value) => ({ value, label: `Week ${value}` })),
              ]}
            />
          </div>

          {/* A scenario-less environment leaves the games query skipped
              (`skipToken` in api/sim.ts), which reports `isPending` forever —
              treat "nothing to browse" as an empty state, same as
              games-browser.tsx's week-less season. */}
          <AdminQueryState
            isPending={Boolean(selectedScenarioId) && fixtures.isPending}
            isError={fixtures.isError}
            onRetry={() => fixtures.refetch()}
            errorMessage="Couldn't load fixtures."
            isEmpty={!selectedScenarioId || fixtures.data?.games.length === 0}
            emptyMessage={
              selectedScenarioId
                ? "No fixtures match this filter."
                : "No scenarios loaded yet — load one above."
            }
          >
            <ul className="flex flex-col gap-2">
              {fixtures.data?.games.map((game) => (
                <SimFixtureRow key={game.id} game={game} />
              ))}
            </ul>
          </AdminQueryState>
        </div>
      </CardContent>
    </Card>
  );
}
