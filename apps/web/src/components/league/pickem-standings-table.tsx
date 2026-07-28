import { usePickemStandings } from "@/api/pickem";
import { formatDateTime } from "@/lib/format";
import { useErrorToast } from "@/lib/use-error-toast";
import { cn } from "@/lib/utils";
import { QueryState } from "@/components/query-state";
import { UserIdentity } from "@/components/user-identity";

// Signed so a viewer can tell a favorable differential from an unfavorable one
// at a glance — zero renders plain, matching the pick entry card's spread label.
function formatSigned(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `${value}`;
}

// Members level on points *and* differential share a rank (spec §Tiebreakers)
// — counted here so ties render "T-<rank>" rather than silently renumbering.
// Exported for its unit test: the vitest `unit` project runs in a node
// environment, so the rule is pinned as a pure function rather than through a
// component render (same idiom as sim/fixture-patch.ts).
export function rankLabel(rank: number, sharedCounts: Map<number, number>): string {
  return (sharedCounts.get(rank) ?? 0) > 1 ? `T-${rank}` : `${rank}`;
}

export function PickemStandingsTable({ leagueId, weekId }: { leagueId: string; weekId?: string }) {
  const standings = usePickemStandings(leagueId, weekId);

  useErrorToast(standings.isError, "Couldn't load standings — please try again.");

  const rows = standings.data?.rows ?? [];
  const lastUpdatedAt = standings.data?.lastUpdatedAt;

  const sharedCounts = new Map<number, number>();
  for (const row of rows) {
    sharedCounts.set(row.rank, (sharedCounts.get(row.rank) ?? 0) + 1);
  }

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
          // `table-fixed` with explicit widths on the narrow numeric columns
          // (rather than a wider table inside an `overflow-x-auto` wrapper) so
          // Pts/Diff — required alongside points (spec) — stay on-screen at
          // phone width instead of sitting past an unscrolled edge.
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-11" />
                <col />
                <col className="w-10" />
                <col className="w-14" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <th scope="col" className="px-2 py-2">
                    Rank
                  </th>
                  <th scope="col" className="px-2 py-2">
                    Member
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    Pts
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    Diff
                  </th>
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
                    <td className="px-2 py-2 text-xs font-medium tabular-nums">
                      {rankLabel(row.rank, sharedCounts)}
                    </td>
                    <td className="px-2 py-2">
                      {/* Compact: Rank/Pts/Diff already claim fixed width (~171px
                          total at 375px), so the username is dropped rather than
                          truncating the name (repo owner's decided rule). */}
                      <UserIdentity
                        displayName={row.displayName}
                        username={row.username}
                        image={row.image}
                        isViewer={row.isViewer}
                        variant="compact"
                        avatarSize="sm"
                      />
                    </td>
                    <td className="px-2 py-2 text-right text-xs tabular-nums">{row.points}</td>
                    <td className="px-2 py-2 text-right text-xs tabular-nums">
                      {formatSigned(row.differential)}
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
