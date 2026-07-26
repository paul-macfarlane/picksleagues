import { useState } from "react";
import { SIM_RESET_SCOPE } from "@picksleagues/schemas";
import { useMyLeagues } from "@/api/leagues";
import { useResetSim } from "@/api/sim";
import { LabeledSelect } from "@/components/labeled-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SimControlRow } from "@/components/admin/sim/sim-control-row";

// Whether an environment reset also drops the active scenario — modeled as
// its own choice rather than a raw boolean so the select's options read as a
// choice, not a checkbox pretending to be a dropdown.
const SCENARIO_DISPOSITION = {
  KEEP: "keep",
  DROP: "drop",
} as const;

type ScenarioDisposition = (typeof SCENARIO_DISPOSITION)[keyof typeof SCENARIO_DISPOSITION];

const SCENARIO_DISPOSITION_OPTIONS: { value: ScenarioDisposition; label: string }[] = [
  // "Keep" rewinds the clock to the scenario's start rather than leaving it
  // where it was (reset.ts) — the whole point is that the wiped season
  // re-ingests as unplayed, so the label says so.
  { value: SCENARIO_DISPOSITION.KEEP, label: "Keep it and rewind to its start" },
  { value: SCENARIO_DISPOSITION.DROP, label: "Drop it and return to real time" },
];

export function SimResetCard() {
  // Only the operator's own leagues — that's the only league list the
  // contract exposes; there's no admin "all leagues" endpoint.
  const leagues = useMyLeagues();
  const reset = useResetSim();
  const [leagueId, setLeagueId] = useState<string>();
  const [disposition, setDisposition] = useState<ScenarioDisposition>(SCENARIO_DISPOSITION.KEEP);

  const myLeagues = leagues.data?.leagues ?? [];
  // Resolved against the *current* list, not trusted from local state: a reset
  // deletes leagues, so a selection made before one can outlive its row and
  // would otherwise stay submittable as a dead id.
  const selectedLeague = myLeagues.find((league) => league.id === leagueId);

  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Reset</CardTitle>
        <CardDescription>
          Wipe test data. Never touches users, sessions, or accounts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <SimControlRow
          title="Reset a league"
          description="Deletes that league's invites, members, seasons, and the league row itself."
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <LabeledSelect
                id="sim-reset-league"
                label="League"
                value={selectedLeague?.id ?? null}
                onValueChange={setLeagueId}
                options={myLeagues.map((league) => ({ value: league.id, label: league.name }))}
              />
              {leagues.isError && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Couldn&apos;t load your leagues.
                </p>
              )}
            </div>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="destructive" disabled={!selectedLeague || reset.isPending} />
                }
              >
                Reset league
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Reset {selectedLeague?.name ?? "this league"}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes {selectedLeague?.name ?? "the league"}&apos;s invites, members,
                    seasons, and the league row itself. This can&apos;t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={reset.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={reset.isPending}
                    onClick={() =>
                      selectedLeague &&
                      reset.mutate({ scope: SIM_RESET_SCOPE.LEAGUE, leagueId: selectedLeague.id })
                    }
                  >
                    Reset league
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SimControlRow>

        <SimControlRow
          title="Reset the environment"
          description="Deletes every league's rows plus all ingested seasons, weeks, games, and odds snapshots. Teams are kept."
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <LabeledSelect
                id="sim-reset-scenario-disposition"
                label="Active scenario"
                value={disposition}
                onValueChange={setDisposition}
                options={SCENARIO_DISPOSITION_OPTIONS}
              />
            </div>
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="destructive" disabled={reset.isPending} />}
              >
                Reset environment
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset the environment?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes every league&apos;s rows plus all ingested seasons, weeks, games,
                    and odds snapshots. Teams are kept; users and sessions are never touched.{" "}
                    {disposition === SCENARIO_DISPOSITION.KEEP
                      ? "The active scenario stays loaded and the simulated clock rewinds to its start, so the wiped season re-ingests as unplayed."
                      : "The active scenario is deleted and the simulated clock returns to real time."}{" "}
                    This can&apos;t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={reset.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={reset.isPending}
                    onClick={() =>
                      reset.mutate({
                        scope: SIM_RESET_SCOPE.ENVIRONMENT,
                        dropScenario: disposition === SCENARIO_DISPOSITION.DROP,
                      })
                    }
                  >
                    Reset environment
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SimControlRow>
      </CardContent>
    </Card>
  );
}
