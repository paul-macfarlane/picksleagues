import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { INVITE_STATUS, type CreateInviteRequest, type Invite } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InvitePanel({
  leagueId,
  isCommissioner,
}: {
  leagueId: string;
  isCommissioner: boolean;
}) {
  const queryClient = useQueryClient();
  const invitesQueryKey = ["league-invites", leagueId];

  const invites = useQuery({
    queryKey: invitesQueryKey,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/leagues/{leagueId}/invites", {
        params: { path: { leagueId } },
      });
      if (error) throw error;
      return data;
    },
    // Only a commissioner can list invites (403 otherwise) — this panel is
    // only ever mounted for commissioners, but the guard stays explicit.
    enabled: isCommissioner,
  });

  useEffect(() => {
    if (invites.isError) {
      toast.error("Couldn't load invites — please try again.");
    }
  }, [invites.isError]);

  const createInvite = useMutation({
    mutationFn: async (body: CreateInviteRequest) => {
      const { data, error, response } = await api.POST("/api/leagues/{leagueId}/invites", {
        params: { path: { leagueId } },
        body,
      });
      if (error) {
        if (response.status === 400) {
          toast.error(error.message);
          return null;
        }
        throw error;
      }
      return data;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      if (data) toast.success("Invite created");
    },
    onError: () => toast.error("Couldn't create an invite — please try again."),
  });

  const revokeInvite = useMutation({
    mutationFn: async (code: string) => {
      const { error } = await api.DELETE("/api/leagues/{leagueId}/invites/{code}", {
        params: { path: { leagueId, code } },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
    },
    onError: () => toast.error("Couldn't revoke that invite — please try again."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invites</CardTitle>
        <CardDescription>Share a link so others can join.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {invites.isPending && <p className="text-sm text-muted-foreground">Loading invites…</p>}
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
                isRevoking={revokeInvite.isPending}
              />
            ))}
          </ul>
        )}
        <NewInviteForm
          onCreate={(body) => createInvite.mutate(body)}
          isPending={createInvite.isPending}
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
          Created {new Date(invite.createdAt).toLocaleDateString()}
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
          <dd>{invite.expiresAt ? new Date(invite.expiresAt).toLocaleString() : "Never"}</dd>
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
}: {
  onCreate: (body: CreateInviteRequest) => void;
  isPending: boolean;
}) {
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");

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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-expires-at">Expires (optional)</Label>
          <Input
            id="invite-expires-at"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </div>
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
          />
        </div>
      </div>
      <Button type="submit" size="sm" className="self-start" disabled={isPending}>
        {isPending ? "Creating…" : "Create invite link"}
      </Button>
    </form>
  );
}
