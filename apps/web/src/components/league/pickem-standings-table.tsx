import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import type { PickemStandingsRow } from "@picksleagues/schemas";
import { usePickemStandings } from "@/api/pickem";
import { formatDateTime } from "@/lib/format";
import { rankLabel, sharedRankCounts } from "@/lib/standings";
import { cn } from "@/lib/utils";
import { QueryState } from "@/components/query-state";
import { UserIdentity } from "@/components/user-identity";

export const STANDINGS_SORT_COLUMN = {
  RANK: "rank",
  MEMBER: "member",
  RECORD: "record",
  POINTS: "points",
} as const;

export type StandingsSortColumn =
  (typeof STANDINGS_SORT_COLUMN)[keyof typeof STANDINGS_SORT_COLUMN];

export const SORT_DIRECTION = { ASCENDING: "ascending", DESCENDING: "descending" } as const;

// Named for the `aria-sort` token set so the attribute is the value itself
// rather than a mapping this file has to keep in sync.
export type SortDirection = (typeof SORT_DIRECTION)[keyof typeof SORT_DIRECTION];

export interface StandingsSort {
  column: StandingsSortColumn;
  direction: SortDirection;
}

/**
 * Rank ascending is the league's actual standing, so it is what loads — sorting
 * is a lens over the board, never a replacement for it.
 */
export const DEFAULT_STANDINGS_SORT: StandingsSort = {
  column: STANDINGS_SORT_COLUMN.RANK,
  direction: SORT_DIRECTION.ASCENDING,
};

// The direction a column takes on its *first* click: best-first for the scoring
// columns, natural order for rank and name.
const INITIAL_DIRECTION: Record<StandingsSortColumn, SortDirection> = {
  [STANDINGS_SORT_COLUMN.RANK]: SORT_DIRECTION.ASCENDING,
  [STANDINGS_SORT_COLUMN.MEMBER]: SORT_DIRECTION.ASCENDING,
  [STANDINGS_SORT_COLUMN.RECORD]: SORT_DIRECTION.DESCENDING,
  [STANDINGS_SORT_COLUMN.POINTS]: SORT_DIRECTION.DESCENDING,
};

/** Clicking the sorted column reverses it; clicking another one adopts its default. */
export function nextStandingsSort(
  current: StandingsSort,
  column: StandingsSortColumn,
): StandingsSort {
  if (current.column !== column) return { column, direction: INITIAL_DIRECTION[column] };
  return {
    column,
    direction:
      current.direction === SORT_DIRECTION.ASCENDING
        ? SORT_DIRECTION.DESCENDING
        : SORT_DIRECTION.ASCENDING,
  };
}

function compareAscending(
  column: StandingsSortColumn,
  a: PickemStandingsRow,
  b: PickemStandingsRow,
): number {
  switch (column) {
    case STANDINGS_SORT_COLUMN.RANK:
      return a.rank - b.rank;
    case STANDINGS_SORT_COLUMN.MEMBER:
      return a.displayName.localeCompare(b.displayName);
    // The record column's headline number. Its other two figures are shown, not
    // ordered on — inventing "then fewer losses" here would be a scoring rule
    // the spec doesn't have.
    case STANDINGS_SORT_COLUMN.RECORD:
      return a.wins - b.wins;
    case STANDINGS_SORT_COLUMN.POINTS:
      return a.points - b.points;
  }
}

/**
 * Reorders the rows the server already ranked. Deliberately *only* a reordering:
 * `rank` is competition ranking computed server-side (ties share a rank), so it
 * travels with its row untouched — a member sorted to the top of a
 * record-sorted board is still whatever rank the league says they are.
 *
 * Stable by construction (`Array#sort` is), so rows the comparator calls equal
 * keep the server's display-name order rather than shuffling between renders.
 */
export function sortStandingsRows(
  rows: readonly PickemStandingsRow[],
  sort: StandingsSort,
): PickemStandingsRow[] {
  const factor = sort.direction === SORT_DIRECTION.ASCENDING ? 1 : -1;
  return [...rows].sort((a, b) => factor * compareAscending(sort.column, a, b));
}

function SortableHeader({
  label,
  column,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  column: StandingsSortColumn;
  sort: StandingsSort;
  onSort: (sort: StandingsSort) => void;
  align?: "left" | "right";
}) {
  const isActive = sort.column === column;
  const next = nextStandingsSort(sort, column);
  const Indicator = sort.direction === SORT_DIRECTION.ASCENDING ? ArrowUpIcon : ArrowDownIcon;

  return (
    // `aria-sort` belongs on the header cell, and only the sorted one carries a
    // direction — "none" everywhere else.
    <th scope="col" aria-sort={isActive ? sort.direction : "none"} className="p-0">
      <button
        type="button"
        onClick={() => onSort(next)}
        // Names the *action*, and keeps the visible label inside it so voice
        // control still matches what's on screen (WCAG 2.5.3).
        aria-label={`Sort by ${label}, ${next.direction}`}
        className={cn(
          "flex w-full items-center gap-0.5 px-2 py-2 font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          align === "right" ? "justify-end" : "justify-start",
          isActive && "text-foreground",
        )}
      >
        <span className="truncate">{label}</span>
        {isActive ? <Indicator aria-hidden="true" className="size-3 shrink-0" /> : null}
      </button>
    </th>
  );
}

export function PickemStandingsTable({ leagueId, weekId }: { leagueId: string; weekId?: string }) {
  const standings = usePickemStandings(leagueId, weekId);
  const [sort, setSort] = useState<StandingsSort>(DEFAULT_STANDINGS_SORT);

  const rows = sortStandingsRows(standings.data?.rows ?? [], sort);
  const lastUpdatedAt = standings.data?.lastUpdatedAt;
  const sharedCounts = sharedRankCounts(rows);

  return (
    <QueryState
      isPending={standings.isPending}
      pendingMessage="Loading standings…"
      isError={standings.isError}
      onRetry={() => standings.refetch()}
      errorMessage="Couldn't load standings."
    >
      <div className="flex flex-col gap-2">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing has settled yet — standings appear once the period&apos;s games go final.
          </p>
        ) : (
          // `table-fixed` with explicit widths on the narrow columns (rather
          // than a wider table inside an `overflow-x-auto` wrapper) so the
          // numbers stay on-screen at phone width instead of sitting past an
          // unscrolled edge. The record column is a single "W-L-P" cell for the
          // same reason: three more numeric columns would not fit, and the
          // widths here are sized for the sorted column's arrow as well as the
          // label.
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-14" />
                <col />
                <col className="w-16" />
                <col className="w-14" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <SortableHeader
                    label="Rank"
                    column={STANDINGS_SORT_COLUMN.RANK}
                    sort={sort}
                    onSort={setSort}
                  />
                  <SortableHeader
                    label="Member"
                    column={STANDINGS_SORT_COLUMN.MEMBER}
                    sort={sort}
                    onSort={setSort}
                  />
                  <SortableHeader
                    label="W-L-P"
                    column={STANDINGS_SORT_COLUMN.RECORD}
                    sort={sort}
                    onSort={setSort}
                    align="right"
                  />
                  {/* Points is the last column by design. Ties share a rank and
                      nothing is shown behind it (ADR-0018 decision 4), so there
                      is deliberately no further number to separate two members
                      level on points. */}
                  <SortableHeader
                    label="Pts"
                    column={STANDINGS_SORT_COLUMN.POINTS}
                    sort={sort}
                    onSort={setSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.leagueMemberId}
                    className={cn(
                      "border-b border-border last:border-0",
                      row.isViewer && "bg-accent/40",
                    )}
                  >
                    {/* The three value cells carry testids because a table cell
                        has no accessible name of its own: without them the only
                        way to address one is by column index, which is exactly
                        the binding a re-ordered or re-labelled board is allowed
                        to break. The merge-gate journey reads all three to prove
                        two tied members share a rank with nothing behind it. */}
                    <td
                      data-testid="standings-rank"
                      className="px-2 py-2 text-xs font-medium tabular-nums"
                    >
                      {rankLabel(row.rank, sharedCounts)}
                    </td>
                    <td className="px-2 py-2">
                      {/* Compact: the numeric columns claim fixed width, so the
                          username is dropped rather than truncating the name
                          (repo owner's decided rule). */}
                      <UserIdentity
                        displayName={row.displayName}
                        username={row.username}
                        image={row.image}
                        isViewer={row.isViewer}
                        variant="compact"
                        avatarSize="sm"
                      />
                    </td>
                    <td
                      data-testid="standings-record"
                      className="px-2 py-2 text-right text-xs tabular-nums"
                    >
                      {row.wins}-{row.losses}-{row.pushes}
                    </td>
                    <td
                      data-testid="standings-points"
                      className="px-2 py-2 text-right text-xs tabular-nums"
                    >
                      {row.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The spec requires a "last updated" stamp and forbids claiming
            real-time freshness — never "live", just when settlement last wrote
            this board. */}
        <p className="text-xs text-muted-foreground">
          {lastUpdatedAt
            ? `Last updated ${formatDateTime(lastUpdatedAt)}`
            : "Nothing has settled yet."}
        </p>
      </div>
    </QueryState>
  );
}
