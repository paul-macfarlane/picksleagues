"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteAccount } from "@/actions/account";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteAccount();
      if (result && !result.success) {
        toast.error(result.error);
        setOpen(false);
      }
    });
  }

  return (
    <div className="border-destructive/50 space-y-3 rounded-lg border p-4">
      <h2 className="text-destructive text-lg font-semibold">Danger Zone</h2>
      <p className="text-muted-foreground text-sm">
        Permanently delete your account. Your identity will be anonymized but
        historical picks and standings will be preserved for league integrity.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive">Delete Account</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you absolutely sure?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. Your profile will be permanently
              anonymized and you will be signed out. Historical data (picks,
              standings) will remain but will no longer be linked to your
              identity.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? "Deleting..." : "Yes, delete my account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
