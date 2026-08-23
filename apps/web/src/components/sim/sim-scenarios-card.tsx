import { SIM_SCENARIO_SOURCE, type SimStateResponse } from "@picksleagues/schemas";
import { cn } from "@/lib/utils";
import { rowClassName } from "@/components/row";
import { useLoadSimScenario } from "@/api/sim";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/status-pill";

function ScenarioRow({
  name,
  subtitle,
  meta,
  active,
  pending,
  onLoad,
}: {
  name: string;
  subtitle: string;
  meta: string;
  active: boolean;
  pending: boolean;
  onLoad: () => void;
}) {
  return (
    <li
      className={cn(
        rowClassName,
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{name}</p>
          {active && <StatusPill tone="strong">Active</StatusPill>}
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <p className="text-xs text-muted-foreground">{meta}</p>
      </div>
      <Button variant="outline" size="sm" disabled={pending} onClick={onLoad}>
        Load
      </Button>
    </li>
  );
}

export function SimScenariosCard({ state }: { state: SimStateResponse }) {
  const load = useLoadSimScenario();
  const importedSeasons = state.scenarios.filter(
    (scenario) => scenario.source === SIM_SCENARIO_SOURCE.REPLAY,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scenarios</CardTitle>
        <CardDescription>
          Loading a scenario re-anchors the simulated clock to its start (ADR-0012). Reset first if
          you want a clean slate — a load never clears already-ingested sports data.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm">Edge-case scenarios</h3>
          <ul className="flex flex-col">
            {state.library.map((entry) => {
              const persisted = state.scenarios.find((scenario) => scenario.slug === entry.slug);
              return (
                <ScenarioRow
                  key={entry.slug}
                  name={entry.name}
                  subtitle={entry.description}
                  meta={`Covers: ${entry.covers} · ${
                    persisted ? `${persisted.gameCount} games` : "Not loaded yet"
                  }`}
                  active={state.activeScenario?.slug === entry.slug}
                  pending={load.isPending && load.variables === entry.slug}
                  onLoad={() => load.mutate(entry.slug)}
                />
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm">Imported seasons</h3>
          {importedSeasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No seasons imported yet — use the replay import below.
            </p>
          ) : (
            <ul className="flex flex-col">
              {importedSeasons.map((scenario) => (
                <ScenarioRow
                  key={scenario.slug}
                  name={scenario.name}
                  subtitle={`${scenario.seasonYear} · ${scenario.gameCount} games`}
                  meta={`Updated ${formatDateTime(scenario.updatedAt)}`}
                  active={state.activeScenario?.slug === scenario.slug}
                  pending={load.isPending && load.variables === scenario.slug}
                  onLoad={() => load.mutate(scenario.slug)}
                />
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
