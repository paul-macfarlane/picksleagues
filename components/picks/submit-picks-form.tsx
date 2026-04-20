"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { submitPicksAction } from "@/actions/picks";
import { EventPickCard } from "@/components/picks/event-pick-card";
import { Button } from "@/components/ui/button";
import type { EventWithTeams, OddsWithSportsbookName } from "@/data/events";
import type { PickType } from "@/lib/db/schema/leagues";
import type { Pick } from "@/lib/db/schema/picks";
import { hasEventStarted } from "@/lib/nfl/leagues";
import { formatEasternDateTime } from "@/lib/nfl/scheduling";

export function SubmitPicksForm({
  leagueId,
  phaseId,
  events,
  oddsByEventId,
  pickType,
  existingPicks,
  picksPerPhase,
  nowMs,
}: {
  leagueId: string;
  phaseId: string;
  events: EventWithTeams[];
  oddsByEventId: Record<string, OddsWithSportsbookName>;
  pickType: PickType;
  existingPicks: Pick[];
  picksPerPhase: number;
  nowMs: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Live-tick the client's notion of "now" forward from the server's
  // snapshot so per-event lock transitions fire without a page refresh.
  // Without this, a game that kicks off while the form is open stays
  // visually interactive and the user only finds out on submit failure.
  const [currentNowMs, setCurrentNowMs] = useState(nowMs);
  useEffect(() => {
    const startReal = Date.now();
    const interval = setInterval(() => {
      setCurrentNowMs(nowMs + (Date.now() - startReal));
    }, 30_000);
    return () => clearInterval(interval);
  }, [nowMs]);

  const currentNow = useMemo(() => new Date(currentNowMs), [currentNowMs]);
  const unstartedEvents = useMemo(
    () => events.filter((e) => !hasEventStarted(e, currentNow)),
    [events, currentNow],
  );

  const unstartedEventIds = useMemo(
    () => new Set(unstartedEvents.map((e) => e.id)),
    [unstartedEvents],
  );
  const existingPickEventIds = useMemo(
    () => new Set(existingPicks.map((p) => p.eventId)),
    [existingPicks],
  );
  // Locked picks are started games the viewer picked — render them in
  // their own section so the user can see their in-flight / final picks
  // alongside the games they still need to pick. Started games the user
  // didn't pick are hidden — noise on My Picks.
  const lockedPickedEvents = useMemo(
    () =>
      events.filter(
        (e) => hasEventStarted(e, currentNow) && existingPickEventIds.has(e.id),
      ),
    [events, currentNow, existingPickEventIds],
  );
  // Existing picks on started events count against the league's
  // picksPerPhase budget — they're locked in and preserved. Required
  // count is the remaining quota available in this submission; never
  // negative, never more than the unstarted pool.
  const lockedPickCount = lockedPickedEvents.length;
  const requiredCount = Math.min(
    Math.max(picksPerPhase - lockedPickCount, 0),
    unstartedEvents.length,
  );

  const existingPickByEventId = useMemo(
    () => new Map(existingPicks.map((p) => [p.eventId, p])),
    [existingPicks],
  );

  // Saved selections scoped to unstarted events — these are the picks the
  // user can still change. Started-game picks are preserved server-side and
  // don't participate in dirty-state.
  const savedSelections = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of unstartedEvents) {
      const prior = existingPickByEventId.get(event.id);
      if (prior) map.set(event.id, prior.teamId);
    }
    return map;
  }, [unstartedEvents, existingPickByEventId]);

  const hasSubmittedBefore = existingPicks.length > 0;
  const lastSavedAt = useMemo(() => {
    if (existingPicks.length === 0) return null;
    return new Date(
      Math.max(...existingPicks.map((p) => p.updatedAt.getTime())),
    );
  }, [existingPicks]);

  const [selections, setSelections] = useState<Map<string, string>>(
    () => new Map(savedSelections),
  );

  function togglePick(eventId: string, teamId: string): void {
    // Defensive check — if the card is visually still interactive but the
    // event isn't in the editable set (stale render, admin-overridden
    // status, or a game that kicked off between renders), reject the
    // click outright. Belt-and-suspenders with the auto-prune below.
    if (!unstartedEventIds.has(eventId)) {
      toast.error("That game has already started — its pick is locked.");
      return;
    }
    setSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(eventId);
      if (current === teamId) {
        next.delete(eventId);
        return next;
      }
      if (!next.has(eventId) && next.size >= requiredCount) {
        toast.error(
          `You can only pick ${requiredCount} game${requiredCount === 1 ? "" : "s"} — deselect one first.`,
        );
        return prev;
      }
      next.set(eventId, teamId);
      return next;
    });
  }

  // Auto-prune selections that reference events no longer in the
  // editable set. This runs whenever `unstartedEvents` changes (a game
  // kicked off per the ticker, a fresh fetch delivered an updated event
  // list, etc.) and keeps `selections` a strict subset of
  // `unstartedEventIds`. Single source of truth: if the event isn't in
  // `unstartedEvents`, it can't be in `selections`.
  useEffect(() => {
    const prunable = Array.from(selections.keys()).filter(
      (eventId) => !unstartedEventIds.has(eventId),
    );
    if (prunable.length === 0) return;
    setSelections((prev) => {
      const next = new Map(prev);
      for (const id of prunable) next.delete(id);
      return next;
    });
    toast.info(
      prunable.length === 1
        ? "A game started — your selection was removed."
        : `${prunable.length} games started — your selections were removed.`,
    );
  }, [unstartedEventIds, selections]);

  const picksMade = selections.size;

  const isDirty = useMemo(() => {
    if (selections.size !== savedSelections.size) return true;
    for (const [eventId, teamId] of selections) {
      if (savedSelections.get(eventId) !== teamId) return true;
    }
    return false;
  }, [selections, savedSelections]);

  const isComplete = picksMade === requiredCount && requiredCount > 0;
  const canSubmit = isComplete && isDirty;
  const showAtsRefreshBanner =
    isDirty && pickType === "against_the_spread" && hasSubmittedBefore;

  // Reset target is "saved if any, else empty." Button is only useful when
  // current selections differ from the reset target — that's the single
  // condition for both "start over" (no saved picks) and "undo my edits"
  // (saved picks + dirty) cases.
  const canReset = hasSubmittedBefore ? isDirty : selections.size > 0;
  const resetLabel = hasSubmittedBefore ? "Revert changes" : "Clear picks";

  function handleReset(): void {
    setSelections(new Map(savedSelections));
  }

  function liveSpreadFor(eventId: string, teamId: string): number | null {
    const event = events.find((e) => e.id === eventId);
    const odds = oddsByEventId[eventId];
    if (!event || !odds) return null;
    return teamId === event.homeTeamId
      ? (odds.homeSpread ?? null)
      : (odds.awaySpread ?? null);
  }

  function handleSubmit(): void {
    const picks = Array.from(selections.entries()).map(([eventId, teamId]) => ({
      eventId,
      teamId,
      // Always include expectedSpread when we have it — the action only
      // validates it for ATS leagues. This is the spread the user saw for
      // their picked team at submit time; the server rejects with
      // STALE_ODDS if the line has moved since.
      expectedSpread:
        pickType === "against_the_spread"
          ? liveSpreadFor(eventId, teamId)
          : null,
    }));
    startTransition(async () => {
      const result = await submitPicksAction({ leagueId, phaseId, picks });
      if (!result.success) {
        toast.error(result.error);
        // Any server rejection means the client's view of the phase may
        // be stale — odds moved, a game kicked off, an admin overrode a
        // status, etc. Refresh so the RSC tree re-fetches and the form's
        // `events` / `odds` props catch up. Local `selections` survive
        // since they're client state; the auto-prune effect will drop
        // anything that references a now-started event.
        router.refresh();
        return;
      }
      toast.success("Picks saved");
      router.refresh();
    });
  }

  // "Take latest odds" banner: ATS only, saved picks, clean state, and at
  // least one pick whose frozen spread differs from the current live line.
  // Clicking the button re-submits with the same selections — the action
  // refreshes `spreadAtLock` from current odds (the §9.3 atomic refresh).
  const movedPickCount = useMemo(() => {
    if (pickType !== "against_the_spread") return 0;
    if (!hasSubmittedBefore || isDirty) return 0;
    let count = 0;
    for (const [eventId, teamId] of savedSelections) {
      const saved = existingPickByEventId.get(eventId);
      const live = liveSpreadFor(eventId, teamId);
      if (
        saved?.spreadAtLock != null &&
        live != null &&
        saved.spreadAtLock !== live
      ) {
        count++;
      }
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pickType,
    hasSubmittedBefore,
    isDirty,
    savedSelections,
    existingPickByEventId,
    oddsByEventId,
    events,
  ]);
  const showTakeLatestBanner = movedPickCount > 0;

  return (
    <div className="flex flex-col gap-3 pb-24">
      {hasSubmittedBefore ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          <Check className="h-4 w-4" aria-hidden />
          <span>
            Picks saved
            {lastSavedAt
              ? ` · last updated ${formatEasternDateTime(lastSavedAt)}`
              : ""}
            {isDirty ? " · unsaved changes" : ""}
          </span>
        </div>
      ) : null}
      {showTakeLatestBanner ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
        >
          <span className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
            {movedPickCount === 1
              ? "Line moved on 1 of your picks"
              : `Lines moved on ${movedPickCount} of your picks`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={handleSubmit}
          >
            Take latest odds
          </Button>
        </div>
      ) : null}
      {lockedPickedEvents.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Locked picks ({lockedPickedEvents.length})
          </h2>
          <ul className="flex flex-col gap-3">
            {lockedPickedEvents.map((event) => {
              const existingPick = existingPickByEventId.get(event.id) ?? null;
              return (
                <li key={event.id}>
                  <EventPickCard
                    event={event}
                    homeTeam={event.homeTeam}
                    awayTeam={event.awayTeam}
                    odds={oddsByEventId[event.id] ?? null}
                    pickType={pickType}
                    selectedTeamId={existingPick?.teamId ?? null}
                    frozenSpread={existingPick?.spreadAtLock ?? null}
                    pickResult={existingPick?.pickResult ?? null}
                    isLocked
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {requiredCount === 0 && lockedPickCount > 0 ? (
        <div
          role="status"
          className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground"
        >
          All {lockedPickCount} picks locked in for this week.
        </div>
      ) : null}
      {unstartedEvents.length > 0 && requiredCount > 0 ? (
        <section className="flex flex-col gap-2">
          {lockedPickedEvents.length > 0 ? (
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pick {requiredCount} game{requiredCount === 1 ? "" : "s"}
            </h2>
          ) : null}
          <ul className="flex flex-col gap-3">
            {unstartedEvents.map((event) => {
              const existingPick = existingPickByEventId.get(event.id) ?? null;
              const selectedTeamId = selections.get(event.id) ?? null;
              // When clean, show the frozen spread on the saved pick. When
              // dirty, drop the frozen spread so the card falls through to
              // the live line — that's what will be locked in on
              // re-submit. Pass the prior frozen spread as a hint when the
              // selected team matches the saved pick ("was −3.5").
              const frozenSpread = isDirty
                ? null
                : (existingPick?.spreadAtLock ?? null);
              const priorFrozenSpread =
                isDirty &&
                existingPick?.teamId === selectedTeamId &&
                existingPick?.spreadAtLock != null
                  ? existingPick.spreadAtLock
                  : null;
              return (
                <li key={event.id}>
                  <EventPickCard
                    event={event}
                    homeTeam={event.homeTeam}
                    awayTeam={event.awayTeam}
                    odds={oddsByEventId[event.id] ?? null}
                    pickType={pickType}
                    selectedTeamId={selectedTeamId}
                    frozenSpread={frozenSpread}
                    priorFrozenSpread={priorFrozenSpread}
                    pickResult={null}
                    isLocked={false}
                    onSelect={(teamId) => togglePick(event.id, teamId)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {requiredCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-0">
            {showAtsRefreshBanner ? (
              <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden
                />
                <span>
                  Re-submitting locks in the current spreads on all picks — not
                  just the ones you changed.
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                {canReset ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={handleReset}
                  >
                    {resetLabel}
                  </Button>
                ) : null}
                <span className="truncate text-sm text-muted-foreground">
                  {lockedPickCount > 0
                    ? `${picksMade}/${requiredCount} picks (${lockedPickCount} locked)`
                    : `${picksMade}/${requiredCount} picks`}
                </span>
              </div>
              <Button
                type="button"
                size="lg"
                disabled={!canSubmit || isPending}
                onClick={handleSubmit}
              >
                {isPending
                  ? "Submitting…"
                  : !hasSubmittedBefore
                    ? `Submit Picks (${picksMade}/${requiredCount})`
                    : isDirty
                      ? `Update Picks (${picksMade}/${requiredCount})`
                      : "Saved ✓"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
