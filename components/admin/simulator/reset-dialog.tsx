"use client";

import { useState, useTransition } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { resetSimulatorAction } from "@/actions/simulator";
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

export function ResetSimulatorDialog({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await resetSimulatorAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Simulator reset");
      setOpen(false);
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Prevent escape / backdrop-click from dismissing mid-reset — the
        // Cancel button is already disabled during `isPending`.
        if (isPending && !next) return;
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={disabled} className="w-fit">
          Reset simulation
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TriangleAlertIcon className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>Reset the simulator?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the simulated season&apos;s phases, events, odds, and
            external mappings. Teams stay. You&apos;ll need to initialize again
            before advancing.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={(event) => {
              event.preventDefault();
              handleConfirm();
            }}
          >
            {isPending ? "Resetting…" : "Reset"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
