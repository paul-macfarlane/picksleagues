import { toast } from "sonner";
import { RowsSkeleton } from "@/components/loading";
import { QueryState } from "@/components/query-state";
import { INVITE_STATUS, type Invite } from "@picksleagues/schemas";
import { useCreateInvite, useLeagueInvites, useRevokeInvite } from "@/api/invites";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CREATE_LOCKED_REASON_ID = "invite-create-locked-reason";

export function InvitePanel({
  leagueId,
  isCommissioner,
  started,
}: {
  leagueId: string;
  isCommissioner: boolean;
  started: boolean;
}) {
  // Only a commissioner can list invites (403 otherwise) — this panel is
  // only ever mounted for commissioners, but the guard stays explicit.
  const invites = useLeagueInvites(leagueId, isCommissioner);

  const createInvite = useCreateInvite(leagueId);
  const revokeInvite = useRevokeInvite(leagueId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invites</CardTitle>
        <CardDescription>Share a link so others can join.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <QueryState
          isPending={invites.isPending}
          pendingFallback={
            <RowsSkeleton label="Loading invites" rows={2} rowClassName="h-14 w-full" />
          }
          isError={invites.isError}
          onRetry={() => void invites.refetch()}
          errorMessage="Couldn't load invites."
          isEmpty={invites.data?.invites.length === 0}
          emptyMessage="No invites yet."
        >
          <ul className="flex flex-col gap-3">
            {invites.data?.invites.map((invite) => (
              <InviteRow
                key={invite.code}
                invite={invite}
                onRevoke={() => revokeInvite.mutate(invite.code)}
                isRevoking={revokeInvite.isPending && revokeInvite.variables === invite.code}
              />
            ))}
          </ul>
        </QueryState>
        {/* The panel itself survives the start — revoking a leaked link stays
            available for as long as the link does (ADR-0029). Only minting a
            new one closes, and it says so rather than vanishing. */}
        <NewInviteButton
          onCreate={() => createInvite.mutate()}
          isPending={createInvite.isPending}
          locked={started}
        />
      </CardContent>
    </Card>
  );
}

function InviteRow({
  invite,
  onRevoke,
  isRevoking,
}: {
  invite: Invite;
  onRevoke: () => void;
  isRevoking: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground capitalize">{invite.status}</span>
        <span className="text-xs text-muted-foreground">
          Created {formatDate(invite.createdAt)}
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1">
          <dt>Uses:</dt>
          <dd>{invite.useCount}</dd>
        </div>
      </dl>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(`${window.location.origin}/join/${invite.code}`);
            toast.success("Invite link copied");
          }}
        >
          Copy link
        </Button>
        {invite.status === INVITE_STATUS.ACTIVE && (
          <Button variant="destructive" size="sm" disabled={isRevoking} onClick={onRevoke}>
            Revoke
          </Button>
        )}
      </div>
    </li>
  );
}

// An invite has no create-time options (ADR-0032) — one button mints a bare
// revocable code, so there is no form here to validate.
function NewInviteButton({
  onCreate,
  isPending,
  locked,
}: {
  onCreate: () => void;
  isPending: boolean;
  locked: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      {/* The server's 409 stays the enforcement; this note explains the
          disabled button rather than letting it vanish. */}
      {locked && (
        <p id={CREATE_LOCKED_REASON_ID} className="text-sm text-muted-foreground">
          New invite links can&apos;t be created once the league starts. Existing links can still be
          revoked.
        </p>
      )}
      <Button
        size="sm"
        className="self-start"
        disabled={locked || isPending}
        aria-describedby={locked ? CREATE_LOCKED_REASON_ID : undefined}
        onClick={onCreate}
      >
        Create invite link
      </Button>
    </div>
  );
}
