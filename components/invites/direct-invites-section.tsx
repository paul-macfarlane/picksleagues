"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { revokeDirectInviteAction } from "@/actions/invites";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { DirectInviteWithProfiles } from "@/data/invites";
import { getInitials } from "@/lib/utils";
import { LEAGUE_ROLE_LABELS } from "@/lib/validators/invites";

export function DirectInvitesSection({
  invites,
}: {
  invites: DirectInviteWithProfiles[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Pending direct invites</h2>
        <p className="text-sm text-muted-foreground">
          Revoke anything you sent by mistake.
        </p>
      </div>
      {invites.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          No pending direct invites.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {invites.map((invite) => (
            <li key={invite.id}>
              <DirectInviteRow invite={invite} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DirectInviteRow({ invite }: { invite: DirectInviteWithProfiles }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const expired = invite.expiresAt <= new Date();
  const invitee = invite.invitee;

  function handleRevoke() {
    startTransition(async () => {
      const result = await revokeDirectInviteAction({ inviteId: invite.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Invite revoked.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <Avatar size="sm">
        {invitee?.avatarUrl ? (
          <AvatarImage src={invitee.avatarUrl} alt="" />
        ) : null}
        <AvatarFallback>{getInitials(invitee?.name ?? "?")}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {invitee?.name ?? "Unknown user"}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {invitee ? `@${invitee.username} · ` : ""}
          {LEAGUE_ROLE_LABELS[invite.role]} ·{" "}
          {expired
            ? "Expired"
            : `Expires in ${formatDistanceToNow(invite.expiresAt)}`}
        </span>
      </div>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={handleRevoke}
        disabled={isPending}
      >
        <Trash2Icon className="size-4" />
        Revoke
      </Button>
    </div>
  );
}
