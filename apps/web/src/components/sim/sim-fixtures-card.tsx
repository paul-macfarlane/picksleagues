import { useState } from "react";
import { WEEK_TYPE, type SimStateResponse, type WeekType } from "@picksleagues/schemas";
import { useSimFixtureGames } from "@/api/sim";
import { QueryState } from "@/components/query-state";
import { weekTypeLabel } from "@/lib/game";
import { SimFixtureRow } from "@/components/sim/sim-fixture-row";
import { LabeledSelect } from "@/components/labeled-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Regular season runs to 18; our postseason numbering is contiguous 1-4
// (ESPN's gapped numbers are normalized in the provider adapter). Offering 18
// postseason options would be 14 guaranteed-empty views, in the one control
// that is now the only way to navigate a scenario.
//
// Both bounds must stay inside `UpdateSimFixtureGameRequestSchema.weekNumber`'s
// 1..18, which is deliberately *not* conditional on week type — so a hand-edit
// can still PATCH a fixture to postseason week 7, and this browser would then
// have no way to list it again. Ingestion and replay import can't produce that
// state; only an operator editing against the raw API can.
const MAX_WEEK_NUMBER_BY_TYPE: Record<WeekType, number> = {
  [WEEK_TYPE.REGULAR]: 18,
  [WEEK_TYPE.POSTSEASON]: 4,
};

function weekNumberOptions(weekType: WeekType): string[] {
  return Array.from({ length: MAX_WEEK_NUMBER_BY_TYPE[weekType] }, (_, index) => String(index + 1));
}

// Week type and week number are both required, never an "all" option: a
// replay season is ~285 fixtures, so an unfiltered (or half-filtered) list
// buries every control below it, which is the exact complaint this card
// exists to fix.
const DEFAULT_WEEK_TYPE: WeekType = WEEK_TYPE.REGULAR;
const DEFAULT_WEEK_NUMBER = "1";

export function SimFixturesCard({ state }: { state: SimStateResponse }) {
  const [scenarioChoice, setScenarioChoice] = useState<string>();
  const [weekType, setWeekType] = useState<WeekType>(DEFAULT_WEEK_TYPE);
  const [weekNumberFilter, setWeekNumberFilter] = useState(DEFAULT_WEEK_NUMBER);

  // Resolved against the scenarios actually loaded, never trusted from local
  // state (same idiom as sim-clock-card.tsx's season resolution): an
  // environment reset can delete the active scenario's fixtures, and a stale
  // choice would otherwise select an id the list no longer has.
  const selectedScenarioId =
    state.scenarios.find((scenario) => scenario.id === scenarioChoice)?.id ??
    state.activeScenario?.id ??
    state.scenarios[0]?.id;

  // Clamped to the selected type's range rather than trusted from state:
  // switching regular week 12 -> postseason would otherwise select a week that
  // does not exist, and render a value absent from the select's own options.
  const weekOptions = weekNumberOptions(weekType);
  const effectiveWeekNumber = weekOptions.includes(weekNumberFilter)
    ? weekNumberFilter
    : DEFAULT_WEEK_NUMBER;
  const weekNumber = Number(effectiveWeekNumber);
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
              value={weekType}
              onValueChange={setWeekType}
              options={Object.values(WEEK_TYPE).map((value) => ({
                value,
                label: weekTypeLabel(value),
              }))}
            />
            <LabeledSelect
              id="sim-fixtures-week-number"
              label="Week"
              value={effectiveWeekNumber}
              onValueChange={setWeekNumberFilter}
              options={weekOptions.map((value) => ({ value, label: `Week ${value}` }))}
            />
          </div>

          {/* A scenario-less environment leaves the games query skipped
              (`skipToken` in api/sim.ts), which reports `isPending` forever —
              treat "nothing to browse" as an empty state, same as
              games-browser.tsx's week-less season. */}
          <QueryState
            isPending={Boolean(selectedScenarioId) && fixtures.isPending}
            isError={fixtures.isError}
            onRetry={() => fixtures.refetch()}
            errorMessage="Couldn't load fixtures."
            isEmpty={!selectedScenarioId || fixtures.data?.games.length === 0}
            emptyMessage={
              selectedScenarioId
                ? "No fixtures in this week — try another week or week type."
                : "No scenarios loaded yet — load one on the Scenarios tab."
            }
          >
            <ul className="flex flex-col gap-2">
              {fixtures.data?.games.map((game) => (
                <SimFixtureRow key={game.id} game={game} />
              ))}
            </ul>
          </QueryState>
        </div>
      </CardContent>
    </Card>
  );
}
