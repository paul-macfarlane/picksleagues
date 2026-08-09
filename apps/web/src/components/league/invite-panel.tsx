import { useEffect, useState } from "react";
import { RowsSkeleton } from "@/components/loading";
import { toast } from "sonner";
import { INVITE_STATUS, type CreateInviteRequest, type Invite } from "@picksleagues/schemas";
import { useCreateInvite, useLeagueInvites, useRevokeInvite } from "@/api/invites";
import { formatDate, formatDateTime } from "@/lib/format";
import { LabeledDateTimeField } from "@/components/labeled-date-time-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  useEffect(() => {
    if (invites.isError) {
      toast.error("Couldn't load invites — please try again.");
    }
  }, [invites.isError]);

  const createInvite = useCreateInvite(leagueId);
  const revokeInvite = useRevokeInvite(leagueId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invites</CardTitle>
        <CardDescription>Share a link so others can join.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {invites.isPending && (
          <RowsSkeleton label="Loading invites" rows={2} rowClassName="h-14 w-full" />
        )}
        {invites.data && invites.data.invites.length === 0 && (
          <p className="text-sm text-muted-foreground">No invites yet.</p>
        )}
        {invites.data && invites.data.invites.length > 0 && (
          <ul className="flex flex-col gap-3">
            {invites.data.invites.map((invite) => (
              <InviteRow
                key={invite.code}
                invite={invite}
                onRevoke={() => revokeInvite.mutate(invite.code)}
                isRevoking={revokeInvite.isPending && revokeInvite.variables === invite.code}
              />
            ))}
          </ul>
        )}
        {/* The panel itself survives the start — revoking a leaked link stays
            available for as long as the link does (ADR-0029). Only minting a
            new one closes, and it says so rather than vanishing. */}
        <NewInviteForm
          onCreate={(body) => createInvite.mutate(body)}
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
          <dd>
            {invite.useCount}/{invite.maxUses ?? "∞"}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>Expires:</dt>
          <dd>{invite.expiresAt ? formatDateTime(invite.expiresAt) : "Never"}</dd>
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

// Stated deviation from the TanStack-Form rule: two optional scalar inputs
// (expiry, max uses) with no per-field validation — the schema-bounded body
// is assembled once at submit, mirroring the settings editors below.
function NewInviteForm({
  onCreate,
  isPending,
  locked,
}: {
  onCreate: (body: CreateInviteRequest) => void;
  isPending: boolean;
  locked: boolean;
}) {
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const describedBy = locked ? CREATE_LOCKED_REASON_ID : undefined;

  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const body: CreateInviteRequest = {};
        // Parsing a user-entered datetime-local value into an ISO instant is
        // the one place "new Date()" is allowed — it's not a "now" read.
        if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();
        if (maxUses) body.maxUses = Number(maxUses);
        onCreate(body);
        setExpiresAt("");
        setMaxUses("");
      }}
    >
      <h3 className="text-sm font-semibold text-foreground">New invite</h3>
      {/* One note serves every control below, each pointing at it via
          aria-describedby — the server's 409 stays the enforcement. */}
      {locked && (
        <p id={CREATE_LOCKED_REASON_ID} className="text-sm text-muted-foreground">
          New invite links can&apos;t be created once the league starts. Existing links can still be
          revoked.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledDateTimeField
          id="invite-expires-at"
          label="Expires (optional)"
          value={expiresAt}
          onChange={setExpiresAt}
          disabled={locked}
          aria-describedby={describedBy}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-max-uses">Max uses (optional)</Label>
          <Input
            id="invite-max-uses"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            step={1}
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
            disabled={locked}
            aria-describedby={describedBy}
          />
        </div>
      </div>
      <Button
        type="submit"
        size="sm"
        className="self-start"
        disabled={locked || isPending}
        aria-describedby={describedBy}
      >
        Create invite link
      </Button>
    </form>
  );
}
