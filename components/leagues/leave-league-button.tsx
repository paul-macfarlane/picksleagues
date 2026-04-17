"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LogOutIcon } from "lucide-react";
import { toast } from "sonner";

import { leaveLeagueAction } from "@/actions/members";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function LeaveLeagueButton({
  leagueId,
  leagueName,
  isSoleMember,
}: {
  leagueId: string;
  leagueName: string;
  isSoleMember: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await leaveLeagueAction({ leagueId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      if (result.data.leagueDeleted) {
        toast.success(`Deleted ${leagueName}.`);
      } else {
        toast.success(`Left ${leagueName}.`);
      }
      router.replace("/leagues");
      router.refresh();
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (isPending && !next) return;
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant={isSoleMember ? "destructive" : "outline"}>
          <LogOutIcon className="size-4" />
          Leave league
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isSoleMember ? `Delete ${leagueName}?` : `Leave ${leagueName}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSoleMember
              ? "You're the only member, so leaving deletes the league. This can't be undone."
              : "You'll stop receiving picks for this league. Historical picks and standings remain."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              handleConfirm();
            }}
            disabled={isPending}
            className={
              isSoleMember
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {isPending
              ? isSoleMember
                ? "Deleting…"
                : "Leaving…"
              : isSoleMember
                ? "Delete league"
                : "Leave league"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
