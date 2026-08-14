import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  type AdminAuditAction,
  type AdminAuditEntry,
  type AdminAuditTargetTable,
} from "@picksleagues/schemas";
import { useAdminAudit } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { Pagination } from "@/components/ui/pagination";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingRegion } from "@/components/loading";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QueryState } from "@/components/query-state";
import { UserIdentity } from "@/components/user-identity";

// Wire value → operator copy. A lookup keyed by the union rather than a chain
// of comparisons, so adding an action is a compile error here instead of a row
// that renders its raw slug.
const ACTION_LABEL: Record<AdminAuditAction, string> = {
  [ADMIN_AUDIT_ACTION.GAME_OVERRIDE]: "Game override",
  [ADMIN_AUDIT_ACTION.LEAGUE_REBUILD]: "League rebuild",
  [ADMIN_AUDIT_ACTION.NFL_TEAM_SEASON_STATS_OVERRIDE]: "Team stats override",
  [ADMIN_AUDIT_ACTION.NFL_GAME_STAT_CONTEXT_OVERRIDE]: "Stat context override",
};

const TARGET_TABLE_LABEL: Record<AdminAuditTargetTable, string> = {
  [ADMIN_AUDIT_TARGET_TABLE.GAMES]: "Game",
  [ADMIN_AUDIT_TARGET_TABLE.LEAGUE_SEASONS]: "League season",
  [ADMIN_AUDIT_TARGET_TABLE.NFL_TEAM_SEASON_STATS]: "Team season stats",
  [ADMIN_AUDIT_TARGET_TABLE.NFL_GAME_STAT_CONTEXT]: "Game stat context",
};

/**
 * The admin action log (arch §Manual Sports Data Overrides: "who, what, when,
 * previous value"), paged. Timestamps are absolute rather than relative to the
 * app clock — the spec keeps the precise instant on audit rows, and "yesterday"
 * beside a correction is worse than a date.
 *
 * Paging state is the route's, not this component's: a reload or a Back keeps
 * the operator's place only if it lives in the URL.
 */
export function AuditLog({
  offset,
  onOffsetChange,
}: {
  offset: number;
  onOffsetChange: (offset: number) => void;
}) {
  const audit = useAdminAudit(offset);
  const page = audit.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>
          Every admin override and rebuild — who did it, what it targeted, and what stood there
          before.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          isPending={audit.isPending}
          pendingFallback={<AuditSkeleton />}
          isError={audit.isError}
          onRetry={() => audit.refetch()}
          errorMessage="Couldn't load the audit log."
          // Emptiness is a property of the trail, not of the page: an offset
          // past the end still needs its pager rendered so the operator can
          // get back.
          isEmpty={page?.total === 0}
          emptyMessage="No admin actions recorded yet."
        >
          {page && (
            <div className="flex flex-col gap-3">
              {/* Five columns don't fit a phone, so the table keeps its width
                  and scrolls rather than wrapping cells into unreadable stacks.
                  The scroll container is `Table`'s own — do not add one here. */}
              <Table className="min-w-3xl text-xs">
                <TableHeader>
                  <TableRow className="text-xs font-medium text-muted-foreground">
                    <TableHead>When</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Prior value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.entries.map((entry) => (
                    <AuditRow key={entry.id} entry={entry} />
                  ))}
                </TableBody>
              </Table>

              <AuditPager
                total={page.total}
                limit={page.limit}
                offset={page.offset}
                shown={page.entries.length}
                onOffsetChange={onOffsetChange}
              />
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function AuditSkeleton() {
  return (
    <LoadingRegion label="Loading the audit log" className="flex flex-col gap-2">
      {Array.from({ length: 5 }, (_unused, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </LoadingRegion>
  );
}

function AuditRow({ entry }: { entry: AdminAuditEntry }) {
  return (
    <TableRow className="align-top">
      <TableCell className="text-muted-foreground">{formatDateTime(entry.createdAt)}</TableCell>
      <TableCell>
        {/* An admin is a user like any other here: name over @username, never a
            bare email. Compact because the columns beside it need the room. */}
        <UserIdentity
          displayName={entry.admin.displayName}
          username={entry.admin.username}
          variant="compact"
          showAvatar={false}
        />
      </TableCell>
      <TableCell className="text-foreground">{ACTION_LABEL[entry.action]}</TableCell>
      {/* Two stacked lines, so this cell opts out of the primitive's
          `whitespace-nowrap`. */}
      <TableCell className="whitespace-normal">
        {/* A null label means the target row is gone — audit rows outlive their
            targets by design, so this is expected state, not missing data. */}
        <span className="text-foreground">{entry.targetLabel ?? "No longer exists"}</span>
        <span className="block text-muted-foreground">{TARGET_TABLE_LABEL[entry.targetTable]}</span>
      </TableCell>
      <TableCell className="whitespace-normal">
        {/* Collapsed by default: the shape differs per action and a row is
            scanned far more often than a prior value is read. */}
        <details>
          <summary className="cursor-pointer text-muted-foreground select-none">Show</summary>
          <pre className="mt-1 max-w-xs overflow-x-auto rounded-md bg-muted p-2 text-xs">
            {JSON.stringify(entry.priorValue, null, 2)}
          </pre>
        </details>
      </TableCell>
    </TableRow>
  );
}

/**
 * Every number here comes from the response envelope, never from what the view
 * asked for: the server clamps and defaults `limit`, so a range derived from
 * the request would mislabel the very page being shown.
 */
function AuditPager({
  total,
  limit,
  offset,
  shown,
  onOffsetChange,
}: {
  total: number;
  limit: number;
  offset: number;
  shown: number;
  onOffsetChange: (offset: number) => void;
}) {
  const last = offset + shown;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">
        {shown === 0 ? `Showing none of ${total}` : `Showing ${offset + 1}–${last} of ${total}`}
      </p>
      {/* Offsets translated to pages at the boundary rather than in the pager:
          this view's URL contract is an offset, and the shared control counts
          pages so both lists page identically. */}
      <Pagination
        page={Math.floor(offset / limit) + 1}
        totalPages={Math.max(1, Math.ceil(total / limit))}
        onPageChange={(page) => onOffsetChange((page - 1) * limit)}
      />
    </div>
  );
}
