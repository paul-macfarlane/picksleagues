"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { joinViaLinkInviteAction } from "@/actions/invites";
import { Button } from "@/components/ui/button";

export function JoinLinkButton({ token }: { token: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleJoin() {
    startTransition(async () => {
      const result = await joinViaLinkInviteAction({ token });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.alreadyMember ? "Already a member." : "Joined the league.",
      );
      router.push(`/leagues/${result.data.leagueId}`);
      router.refresh();
    });
  }

  return (
    <Button onClick={handleJoin} disabled={isPending} className="w-full">
      {isPending ? "Joining…" : "Join league"}
    </Button>
  );
}
