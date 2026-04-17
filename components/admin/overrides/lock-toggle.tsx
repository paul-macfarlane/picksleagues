"use client";

import { useState, useTransition } from "react";
import { LockIcon, LockOpenIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { toggleLockAction } from "@/actions/admin-overrides";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { OverrideEntity } from "@/lib/validators/admin-overrides";

export function LockToggle({
  entity,
  id,
  locked,
  label,
}: {
  entity: OverrideEntity;
  id: string;
  locked: boolean;
  label: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [unlockOpen, setUnlockOpen] = useState(false);

  function submit(nextLocked: boolean) {
    startTransition(async () => {
      const result = await toggleLockAction({
        entity,
        id,
        locked: nextLocked,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(nextLocked ? `Locked ${label}` : `Unlocked ${label}`);
      setUnlockOpen(false);
    });
  }

  if (!locked) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => submit(true)}
        disabled={isPending}
      >
        <LockIcon className="size-3.5" />
        Lock
      </Button>
    );
  }

  return (
    <AlertDialog
      open={unlockOpen}
      onOpenChange={(next) => {
        if (isPending && !next) return;
        setUnlockOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={isPending}>
          <LockOpenIcon className="size-3.5" />
          Unlock
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TriangleAlertIcon className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>Unlock {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Future ESPN syncs can overwrite your manual edits on this row. Lock
            again from this page if you want to preserve them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={(event) => {
              event.preventDefault();
              submit(false);
            }}
          >
            {isPending ? "Unlocking…" : "Unlock"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
