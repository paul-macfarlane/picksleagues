import { useState } from "react";
import {
  SIM_CLOCK_ADJUSTMENT_KIND,
  SIM_CLOCK_ANCHOR,
  SPORT,
  type SimClockAnchor,
  type SimStateResponse,
} from "@picksleagues/schemas";
import { useAdminGames, useAdminSeasons } from "@/api/admin";
import { useAdjustSimClock } from "@/api/sim";
import { formatDateTime, toLocalDateTimeInputValue } from "@/lib/format";
import { useErrorToast } from "@/lib/use-error-toast";
import { LabeledDateTimeField } from "@/components/labeled-date-time-field";
import { LabeledSelect } from "@/components/labeled-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Figures } from "@/components/figures";
import { SimControlRow } from "@/components/sim/sim-control-row";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

// The fixed steps an operator nudges the clock by — a const table rather
// than five inline `mutate` calls so each button's label and ms stay paired.
const CLOCK_STEPS: { label: string; ms: number }[] = [
  // Symmetric on purpose (FB-31): every forward step has its inverse, so an
  // overshoot is undone by the button beside the one that caused it.
  { label: "−1 week", ms: -WEEK_MS },
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

/**
 * Jump straight to one of the selected week's kickoff windows (FB-31) — the
 * Sunday 1pm wave, the late games, the night game — instead of nudging by hours
 * and overshooting.
 *
 * The slots are **derived from the week's own games**, never a table of ET
 * times. A hardcoded 1:00pm is wrong for an international kickoff, a
 * Thursday/Saturday slate, or a holiday window, and it would offer the operator
 * an instant no game occupies. Reading the games instead means the list is
 * exactly the slate that exists.
 *
 * Lands *on* the kickoff, which is the instant those games lock (`kickoff <=
 * now`, arch D11) and the state an operator jumping to a slate wants to be in.
 */
function KickoffSlotRow({
  weekId,
  pending,
  onJump,
}: {
  weekId: string | undefined;
  pending: boolean;
  onJump: (input: { kind: typeof SIM_CLOCK_ADJUSTMENT_KIND.INSTANT; instant: string }) => void;
}) {
  const games = useAdminGames(weekId);
  useErrorToast(games.isError, "Couldn't load this week's games — please try again.");
  const [slot, setSlot] = useState<string>();

  // Distinct kickoff instants with how many games each starts — the count is
  // what tells a 12-game wave from a lone night game at a glance.
  const slots = [
    ...(games.data?.games ?? [])
      .reduce(
        (acc, game) => acc.set(game.kickoffAt, (acc.get(game.kickoffAt) ?? 0) + 1),
        new Map<string, number>(),
      )
      .entries(),
  ].sort(([a], [b]) => a.localeCompare(b));

  // Never trusted from local state: changing the week (or an environment reset)
  // leaves a selection that names an instant this week doesn't have.
  const selected = slots.find(([instant]) => instant === slot)?.[0] ?? slots[0]?.[0];

  return (
    <SimControlRow
      title="Jump to a kickoff slot"
      description="Lands the clock exactly on one of the selected week's kickoffs, locking that wave of games."
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <LabeledSelect
            id="sim-clock-kickoff"
            label="Kickoff"
            value={selected ?? null}
            onValueChange={setSlot}
            options={slots.map(([instant, count]) => ({
              value: instant,
              label: `${formatDateTime(instant)} · ${count} game${count === 1 ? "" : "s"}`,
            }))}
          />
        </div>
        <Button
          disabled={!selected || pending}
          onClick={() =>
            selected && onJump({ kind: SIM_CLOCK_ADJUSTMENT_KIND.INSTANT, instant: selected })
          }
        >
          Jump to kickoff
        </Button>
      </div>
      {!games.isPending && slots.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No games synced for the selected week — run the schedule sync job first.
        </p>
      )}
    </SimControlRow>
  );
}

export function SimClockCard({ state }: { state: SimStateResponse }) {
  const adjust = useAdjustSimClock();
  const seasons = useAdminSeasons(SPORT.NFL);
  // Otherwise a failed seasons query is indistinguishable from a genuinely
  // empty database: both render empty selects and a disabled Jump. A query
  // behind a control toasts (engineering rules §Quality).
  useErrorToast(seasons.isError, "Couldn't load seasons — please try again.");
  const allSeasons = seasons.data?.seasons ?? [];

  const [seasonId, setSeasonId] = useState<string>();
  const [weekId, setWeekId] = useState<string>();
  const [anchor, setAnchor] = useState<SimClockAnchor>(SIM_CLOCK_ANCHOR.BEFORE_FIRST_KICKOFF);
  // Tracks the clock instead of freezing at mount (FB-32): the control is
  // "start from now and adjust", and a field still showing where the clock was
  // three jumps ago is a stale default the operator has to notice.
  //
  // Re-seeded only while it still holds what it was last seeded with, which is
  // the anti-clobber property the mount-only seed was protecting: once the
  // operator types (or picks) anything, the 15s poll (api/sim.ts) leaves it
  // alone. After a successful Set the clock becomes the value in the field, so
  // the two agree again and tracking resumes.
  const [instantValue, setInstantValue] = useState(() =>
    toLocalDateTimeInputValue(state.clock.now),
  );
  const [seededFrom, setSeededFrom] = useState(state.clock.now);
  if (state.clock.now !== seededFrom) {
    setSeededFrom(state.clock.now);
    if (instantValue === toLocalDateTimeInputValue(seededFrom)) {
      setInstantValue(toLocalDateTimeInputValue(state.clock.now));
    }
  }

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
  // Defaults to the season's current week (server-resolved, FB-11): a Jump
  // control that opens on week 1 is a jump *backwards* for most of a season.
  const effectiveWeekId =
    selectedSeason?.weeks.find((week) => week.id === weekId)?.id ??
    selectedSeason?.currentWeekId ??
    selectedSeason?.weeks[0]?.id;

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
        <CardDescription>What every &quot;now&quot; read in the app resolves to.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* The three readings are the panel's numerals; the scenario is a
            name, and a name in condensed caps wraps badly at 390px, so it
            keeps the eyebrow-over-body shape beside them. Testids sit on the
            values: what proves this panel reached GET /api/sim/state is the
            reading, and the label beside it is copy. */}
        <Figures
          numeralClassName="text-xl"
          figures={[
            { label: "Simulated now", value: formatDateTime(state.clock.now), testId: "sim-now" },
            { label: "Real now", value: formatDateTime(state.clock.realNow) },
            { label: "Offset", value: formatOffset(state.clock.offsetMs), testId: "sim-offset" },
          ]}
        />
        <div className="flex flex-col gap-1">
          <p className="type-eyebrow">Active scenario</p>
          <p className="text-sm text-foreground">
            {state.activeScenario
              ? `${state.activeScenario.name} (${state.activeScenario.seasonYear})`
              : "None — the provider serves real data"}
          </p>
        </div>

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

        <KickoffSlotRow weekId={effectiveWeekId} pending={instantPending} onJump={adjust.mutate} />

        <SimControlRow
          title="Set an exact instant"
          description="Pick any date (jump straight to a year via the dropdowns) and time to position the clock at."
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              {/* Not a TanStack Form field: there's no free-text validation
                  surface here to wire a Zod schema against, and this is a
                  sibling of the plain selects above, not a data-entry form. */}
              <LabeledDateTimeField
                id="sim-clock-instant"
                label="Instant"
                value={instantValue}
                onChange={setInstantValue}
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
