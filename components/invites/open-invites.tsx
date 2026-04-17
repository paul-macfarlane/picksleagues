"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { respondToDirectInviteAction } from "@/actions/invites";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DirectInviteWithContext } from "@/data/invites";
import { LEAGUE_ROLE_LABELS } from "@/lib/validators/invites";
import { formatDistanceToNow } from "date-fns";

export function OpenInvites({
  invites,
}: {
  invites: DirectInviteWithContext[];
}) {
  if (invites.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Open invites</h2>
      <ul className="flex flex-col gap-3">
        {invites.map((invite) => (
          <li key={invite.id}>
            <DirectInviteCard invite={invite} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DirectInviteCard({ invite }: { invite: DirectInviteWithContext }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<
    "accept" | "decline" | null
  >(null);

  function respond(response: "accept" | "decline") {
    setPendingAction(response);
    startTransition(async () => {
      const result = await respondToDirectInviteAction({
        inviteId: invite.id,
        response,
      });
      setPendingAction(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (response === "accept") {
        toast.success(`Joined ${invite.league.name}.`);
        router.push(`/leagues/${invite.league.id}`);
      } else {
        toast.success("Invite declined.");
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold">{invite.league.name}</h3>
          <p className="text-xs text-muted-foreground">
            Invited as {LEAGUE_ROLE_LABELS[invite.role]}
            {invite.inviter ? ` by ${invite.inviter.name}` : ""} · expires in{" "}
            {formatDistanceToNow(invite.expiresAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => respond("decline")}
            disabled={isPending}
          >
            {pendingAction === "decline" ? "Declining…" : "Decline"}
          </Button>
          <Button
            size="sm"
            onClick={() => respond("accept")}
            disabled={isPending}
          >
            {pendingAction === "accept" ? "Accepting…" : "Accept"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
