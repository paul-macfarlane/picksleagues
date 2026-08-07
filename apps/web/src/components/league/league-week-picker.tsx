import type { ReactNode } from "react";
import { useLeagueWeeks } from "@/api/weeks";
import { LabeledSelect } from "@/components/labeled-select";
import { QueryState } from "@/components/query-state";

/**
 * The week-scoped page shell: load the league's weeks, let the member pick one,
 * and render the section belonging to whichever week is selected.
 *
 * Shared by the two pick surfaces (`/picks`, `/league-picks`), which are the
 * same page frame around different content. Generic rather than `pickem*`
 * because Elimination's weekly slate is the second mode that will use it
 * unchanged (engineering rule on mode-specific naming).
 *
 * Two things live here rather than at each call site, because they are what the
 * two pages would otherwise restate and drift on:
 *
 * - **The default.** An absent search param falls back to the server's current
 *   week — never a week derived in the browser.
 * - **The resolved week's type.** `children` is a function so the week arrives
 *   as a non-optional string: the shell already withholds its body until the
 *   weeks land, and a plain node would make every caller re-guard with a
 *   `{weekId && …}` of its own.
 */
export function LeagueWeekPicker({
  leagueId,
  selectId,
  weekId,
  onSelectWeek,
  children,
}: {
  leagueId: string;
  // Distinct per page so the label association survives if two of these ever
  // render on one screen.
  selectId: string;
  // The caller's search param: undefined means "whatever the current week is".
  weekId: string | undefined;
  onSelectWeek: (weekId: string) => void;
  children: (weekId: string) => ReactNode;
}) {
  const weeks = useLeagueWeeks(leagueId);
  const allWeeks = weeks.data?.weeks ?? [];
  const effectiveWeekId = weekId ?? weeks.data?.currentWeekId ?? undefined;

  return (
    <div className="flex flex-col gap-4">
      <QueryState
        isPending={weeks.isPending}
        pendingMessage="Loading weeks…"
        isError={weeks.isError}
        onRetry={() => weeks.refetch()}
        errorMessage="Couldn't load this league's weeks."
        isEmpty={allWeeks.length === 0}
        emptyMessage="No weeks in range for this league yet."
      >
        <LabeledSelect
          id={selectId}
          label="Week"
          value={effectiveWeekId ?? null}
          onValueChange={onSelectWeek}
          options={allWeeks.map((week) => ({ value: week.id, label: week.label }))}
        />

        {effectiveWeekId && children(effectiveWeekId)}
      </QueryState>
    </div>
  );
}
