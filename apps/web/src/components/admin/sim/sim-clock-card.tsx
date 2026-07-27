import { useState } from "react";
import {
  SIM_CLOCK_ADJUSTMENT_KIND,
  SIM_CLOCK_ANCHOR,
  SPORT,
  type SimClockAnchor,
  type SimStateResponse,
} from "@picksleagues/schemas";
import { useAdminSeasons } from "@/api/admin";
import { useAdjustSimClock } from "@/api/sim";
import { formatDateTime, toLocalDateTimeInputValue } from "@/lib/format";
import { LabeledSelect } from "@/components/labeled-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimControlRow } from "@/components/admin/sim/sim-control-row";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

// The fixed steps an operator nudges the clock by — a const table rather
// than five inline `mutate` calls so each button's label and ms stay paired.
const CLOCK_STEPS: { label: string; ms: number }[] = [
  { label: "−1 day", ms: -DAY_MS },
  { label: "−1 hour", ms: -HOUR_MS },
  { label: "+1 hour", ms: HOUR_MS },
  { label: "+1 day", ms: DAY_MS },
  { label: "+1 week", ms: WEEK_MS },
];

const ANCHOR_OPTIONS: { value: SimClockAnchor; label: string }[] = [
  { value: SIM_CLOCK_ANCHOR.WEEK_START, label: "Week start" },
  { value: SIM_CLOCK_ANCHOR.BEFORE_FIRST_KICKOFF, label: "Before first kickoff" },
  { value: SIM_CLOCK_ANCHOR.AFTER_LAST_GAME, label: "After last game" },
];

// A signed human delta ("+3d 4h 12m"), zero units dropped, at least one unit
// always shown — the raw ms offset is meaningless to an operator at a glance.
function formatOffset(ms: number): string {
  if (ms === 0) return "real time";
  const sign = ms < 0 ? "−" : "+";
  let minutesTotal = Math.round(Math.abs(ms) / MINUTE_MS);
  const days = Math.floor(minutesTotal / (24 * 60));
  minutesTotal -= days * 24 * 60;
  const hours = Math.floor(minutesTotal / 60);
  minutesTotal -= hours * 60;
  const minutes = minutesTotal;

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return `${sign}${parts.join(" ")}`;
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function SimClockCard({ state }: { state: SimStateResponse }) {
  const adjust = useAdjustSimClock();
  const seasons = useAdminSeasons(SPORT.NFL);
  const allSeasons = seasons.data?.seasons ?? [];

  const [seasonId, setSeasonId] = useState<string>();
  const [weekId, setWeekId] = useState<string>();
  const [anchor, setAnchor] = useState<SimClockAnchor>(SIM_CLOCK_ANCHOR.BEFORE_FIRST_KICKOFF);
  // Seeded once from the clock at mount — re-seeding on every 15s poll
  // (api/sim.ts) would clobber whatever instant the operator is mid-typing.
  const [instantValue, setInstantValue] = useState(() =>
    toLocalDateTimeInputValue(state.clock.now),
  );

  // A week identifies its own season, so a selection needs only `weekId`;
  // `seasonId` alone covers "season chosen, no week yet" — the same
  // derivation as the games browser (games-browser.tsx), just backed by
  // local state rather than the URL since this control is transient, not a
  // shareable view.
  const selectedSeason =
    allSeasons.find((season) => season.weeks.some((week) => week.id === weekId)) ??
    allSeasons.find((season) => season.id === seasonId) ??
    allSeasons[0];
  // Resolved against the weeks actually loaded, never trusted from local state:
  // an environment reset deletes every week (and a re-sync mints new ids), so a
  // selection made beforehand would otherwise keep Jump enabled and post a dead
  // id — and render the select with a value absent from its own options.
  const effectiveWeekId =
    selectedSeason?.weeks.find((week) => week.id === weekId)?.id ?? selectedSeason?.weeks[0]?.id;

  // Each control scopes its own pending state off `mutation.variables`
  // (async-button standard) rather than one flag disabling every sibling.
  const advancePending = (ms: number) =>
    adjust.isPending &&
    adjust.variables?.kind === SIM_CLOCK_ADJUSTMENT_KIND.ADVANCE &&
    adjust.variables.ms === ms;
  const weekPending = adjust.isPending && adjust.variables?.kind === SIM_CLOCK_ADJUSTMENT_KIND.WEEK;
  const instantPending =
    adjust.isPending && adjust.variables?.kind === SIM_CLOCK_ADJUSTMENT_KIND.INSTANT;
  const resetPending =
    adjust.isPending && adjust.variables?.kind === SIM_CLOCK_ADJUSTMENT_KIND.RESET;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Simulated clock</CardTitle>
        <CardDescription>
          What every &quot;now&quot; read in the app resolves to (arch D13).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusItem label="Simulated now" value={formatDateTime(state.clock.now)} />
          <StatusItem label="Real now" value={formatDateTime(state.clock.realNow)} />
          <StatusItem label="Offset" value={formatOffset(state.clock.offsetMs)} />
          <StatusItem
            label="Active scenario"
            value={
              state.activeScenario
                ? `${state.activeScenario.name} (${state.activeScenario.seasonYear})`
                : "None — the provider serves real data"
            }
          />
        </dl>

        <SimControlRow title="Advance by a step" description="Nudge the clock forward or back.">
          <div className="flex flex-wrap gap-2">
            {CLOCK_STEPS.map((step) => (
              <Button
                key={step.label}
                variant="outline"
                size="sm"
                disabled={advancePending(step.ms)}
                onClick={() =>
                  adjust.mutate({ kind: SIM_CLOCK_ADJUSTMENT_KIND.ADVANCE, ms: step.ms })
                }
              >
                {step.label}
              </Button>
            ))}
          </div>
        </SimControlRow>

        <SimControlRow
          title="Jump to a week"
          description="Anchors the clock relative to a synced week's games."
        >
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LabeledSelect
                id="sim-clock-season"
                label="Season"
                value={selectedSeason?.id ?? null}
                // Drops the week: carrying one over from a different season
                // would select a week this season doesn't have.
                onValueChange={(next) => {
                  setSeasonId(next);
                  setWeekId(undefined);
                }}
                options={allSeasons.map((season) => ({
                  value: season.id,
                  label: `${season.year}${season.provisional ? " (provisional)" : ""}`,
                }))}
              />
              <LabeledSelect
                id="sim-clock-week"
                label="Week"
                value={effectiveWeekId ?? null}
                onValueChange={setWeekId}
                options={(selectedSeason?.weeks ?? []).map((week) => ({
                  value: week.id,
                  label: week.label,
                }))}
              />
              <LabeledSelect
                id="sim-clock-anchor"
                label="Anchor"
                value={anchor}
                onValueChange={setAnchor}
                options={ANCHOR_OPTIONS}
              />
            </div>
            {/* Otherwise a failed seasons query is indistinguishable from a
                genuinely empty database: both render empty selects and a
                disabled Jump, with nothing to act on. */}
            {seasons.isError && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-muted-foreground">Couldn&apos;t load seasons.</p>
                <Button variant="outline" size="sm" onClick={() => seasons.refetch()}>
                  Retry
                </Button>
              </div>
            )}
            {!seasons.isError && !seasons.isPending && allSeasons.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No seasons synced yet — run the schedule sync job first.
              </p>
            )}
            <Button
              disabled={!effectiveWeekId || weekPending}
              onClick={() =>
                effectiveWeekId &&
                adjust.mutate({
                  kind: SIM_CLOCK_ADJUSTMENT_KIND.WEEK,
                  weekId: effectiveWeekId,
                  anchor,
                })
              }
            >
              Jump
            </Button>
          </div>
        </SimControlRow>

        <SimControlRow
          title="Set an exact instant"
          description="Type or pick any instant to position the clock at."
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="sim-clock-instant">Instant</Label>
              {/* A native datetime picker, not a TanStack Form field: there's
                  no free-text validation surface here to wire a Zod schema
                  against, and this is a sibling of the plain selects above,
                  not a data-entry form. */}
              <Input
                id="sim-clock-instant"
                type="datetime-local"
                value={instantValue}
                onChange={(event) => setInstantValue(event.target.value)}
              />
            </div>
            <Button
              disabled={!instantValue || instantPending}
              onClick={() => {
                if (!instantValue) return;
                adjust.mutate({
                  kind: SIM_CLOCK_ADJUSTMENT_KIND.INSTANT,
                  instant: new Date(instantValue).toISOString(),
                });
              }}
            >
              Set
            </Button>
          </div>
        </SimControlRow>

        <SimControlRow
          title="Back to real time"
          description="Returns the clock to real time. Any loaded scenario stays loaded — this only unpauses the clock."
        >
          <Button
            variant="outline"
            disabled={resetPending}
            onClick={() => adjust.mutate({ kind: SIM_CLOCK_ADJUSTMENT_KIND.RESET })}
          >
            Back to real time
          </Button>
        </SimControlRow>
      </CardContent>
    </Card>
  );
}
