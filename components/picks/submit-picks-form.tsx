"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { submitPicksAction } from "@/actions/picks";
import { EventPickCard } from "@/components/picks/event-pick-card";
import { Button } from "@/components/ui/button";
import type { EventWithTeams, OddsWithSportsbookName } from "@/data/events";
import type { PickType } from "@/lib/db/schema/leagues";
import type { Pick } from "@/lib/db/schema/picks";

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

  const unstartedEvents = useMemo(
    () => events.filter((e) => nowMs < e.startTime.getTime()),
    [events, nowMs],
  );
  const lockedEvents = useMemo(
    () => events.filter((e) => nowMs >= e.startTime.getTime()),
    [events, nowMs],
  );
  const requiredCount = Math.min(picksPerPhase, unstartedEvents.length);

  const existingPickByEventId = useMemo(
    () => new Map(existingPicks.map((p) => [p.eventId, p])),
    [existingPicks],
  );

  const [selections, setSelections] = useState<Map<string, string>>(() => {
    const initial = new Map<string, string>();
    for (const event of unstartedEvents) {
      const prior = existingPickByEventId.get(event.id);
      if (prior) initial.set(event.id, prior.teamId);
    }
    return initial;
  });

  function togglePick(eventId: string, teamId: string): void {
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

  const picksMade = selections.size;
  const canSubmit = picksMade === requiredCount && requiredCount > 0;

  function handleSubmit(): void {
    const picks = Array.from(selections.entries()).map(([eventId, teamId]) => ({
      eventId,
      teamId,
    }));
    startTransition(async () => {
      const result = await submitPicksAction({ leagueId, phaseId, picks });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Picks saved");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 pb-24">
      <ul className="flex flex-col gap-3">
        {events.map((event) => {
          const locked = nowMs >= event.startTime.getTime();
          const existingPick = existingPickByEventId.get(event.id) ?? null;
          const selectedTeamId = locked
            ? (existingPick?.teamId ?? null)
            : (selections.get(event.id) ?? null);
          const frozenSpread = locked
            ? (existingPick?.spreadAtLock ?? null)
            : null;
          const pickResult = locked ? (existingPick?.pickResult ?? null) : null;
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
                pickResult={pickResult}
                isLocked={locked}
                onSelect={
                  locked ? undefined : (teamId) => togglePick(event.id, teamId)
                }
              />
            </li>
          );
        })}
      </ul>
      {requiredCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              {lockedEvents.length > 0
                ? `${picksMade}/${requiredCount} picks (${lockedEvents.length} game${lockedEvents.length === 1 ? "" : "s"} locked)`
                : `${picksMade}/${requiredCount} picks`}
            </span>
            <Button
              type="button"
              size="lg"
              disabled={!canSubmit || isPending}
              onClick={handleSubmit}
            >
              {isPending
                ? "Submitting…"
                : `Submit Picks (${picksMade}/${requiredCount})`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
