import type { ReactNode } from "react";
import { useLeagueWeeks } from "@/api/weeks";
import { RowsSkeleton } from "@/components/loading";
import { QueryState } from "@/components/query-state";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The week-scoped page shell: load the league's weeks, let the member pick one,
 * and render the section belonging to whichever week is selected.
 *
 * Shared by the two pick surfaces (`/picks`, `/league-picks`), which are the
 * same page frame around different content. Generic rather than `pickem*`
 * because Survivor's weekly slate is the second mode that will use it
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
        pendingFallback={
          <RowsSkeleton label="Loading weeks" rows={2} rowClassName="h-9 w-full sm:max-w-xs" />
        }
        isError={weeks.isError}
        onRetry={() => weeks.refetch()}
        errorMessage="Couldn't load this league's weeks."
        isEmpty={allWeeks.length === 0}
        emptyMessage="No weeks in range for this league yet."
      >
        {/* The week is the page's subject, so its name takes the display role
            (ADR-0043 §1) — composed here rather than through `LabeledSelect`,
            whose bordered input look is right for a settings field and wrong
            for a heading. Still a real Select: same id, label association,
            keyboard, and options, so nothing a journey binds to moves. The
            label is screen-reader-only because the value already says "Week":
            an eyebrow `WEEK` over `WEEK 1` is the word twice. */}
        <div className="flex flex-col">
          <Label htmlFor={selectId} className="sr-only">
            Week
          </Label>
          {/* `items` is Base UI's value→label map for the closed trigger —
              without it the trigger renders the raw wire id. `null`, never
              `undefined`, for "no selection": `undefined` flips the Select to
              uncontrolled. */}
          <Select
            items={allWeeks.map((week) => ({ value: week.id, label: week.label }))}
            value={effectiveWeekId ?? null}
            onValueChange={(next) => {
              if (next) onSelectWeek(next);
            }}
          >
            <SelectTrigger
              id={selectId}
              // The trigger's own `h-8` is bound to its size attribute, so the
              // override must be too; the chevron is ink beside ink numerals.
              className="type-display h-auto rounded-sm border-0 px-0 py-0 text-2xl data-[size=default]:h-auto dark:bg-transparent dark:hover:bg-transparent [&_svg]:size-5 [&_svg]:text-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allWeeks.map((week) => (
                <SelectItem key={week.id} value={week.id}>
                  {week.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {effectiveWeekId && children(effectiveWeekId)}
      </QueryState>
    </div>
  );
}
