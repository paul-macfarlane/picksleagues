"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CopyIcon, LinkIcon, Trash2Icon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { formatDistanceToNow } from "date-fns";

import {
  createLinkInviteAction,
  revokeLinkInviteAction,
} from "@/actions/invites";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LinkInvite } from "@/lib/db/schema/leagues";
import {
  INVITE_EXPIRATION_DAYS_DEFAULT,
  LEAGUE_ROLE_LABELS,
  createLinkInviteSchema,
  type CreateLinkInviteInput,
} from "@/lib/validators/invites";

type CreateLinkInviteOutput = z.output<typeof createLinkInviteSchema>;

export function LinkInvitesSection({
  leagueId,
  existingInvites,
  disabledReason,
}: {
  leagueId: string;
  existingInvites: LinkInvite[];
  disabledReason: string | null;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Invite by link</h2>
          <p className="text-sm text-muted-foreground">
            Share a link with anyone you want to invite.
          </p>
        </div>
        {disabledReason === null ? (
          <CreateLinkInviteDialog leagueId={leagueId} />
        ) : null}
      </div>
      {disabledReason !== null ? (
        <p className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
      {existingInvites.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {existingInvites.map((invite) => (
            <li key={invite.id}>
              <LinkInviteRow invite={invite} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CreateLinkInviteDialog({ leagueId }: { leagueId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const defaults: CreateLinkInviteInput = {
    leagueId,
    role: "member",
    expirationDays: INVITE_EXPIRATION_DAYS_DEFAULT,
  };

  const form = useForm<CreateLinkInviteInput, unknown, CreateLinkInviteOutput>({
    resolver: zodResolver(createLinkInviteSchema),
    mode: "onBlur",
    defaultValues: defaults,
  });

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    control,
    formState: { errors },
  } = form;

  const role = useWatch({ control, name: "role" });

  function onSubmit(values: CreateLinkInviteOutput) {
    startTransition(async () => {
      const result = await createLinkInviteAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const url = buildJoinUrl(result.data.invite.token);
      await copyToClipboard(url);
      toast.success("Link invite created and copied to your clipboard.");
      reset(defaults);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending && !next) return;
        setOpen(next);
        if (!next) reset(defaults);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <LinkIcon className="size-4" />
          New link invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a link invite</DialogTitle>
          <DialogDescription>
            Anyone with the link can join until it expires.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <input type="hidden" {...register("leagueId")} />

          <Field>
            <FieldLabel htmlFor="link-role">Role</FieldLabel>
            <Select
              value={role}
              onValueChange={(value) =>
                setValue("role", value as CreateLinkInviteInput["role"], {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger id="link-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LEAGUE_ROLE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={[errors.role]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="link-expires">Expires in (days)</FieldLabel>
            <Input
              id="link-expires"
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              {...register("expirationDays")}
              aria-invalid={errors.expirationDays ? true : undefined}
            />
            <FieldDescription>Between 1 and 30 days.</FieldDescription>
            <FieldError errors={[errors.expirationDays]} />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create & copy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkInviteRow({ invite }: { invite: LinkInvite }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const expired = invite.expiresAt <= new Date();

  function handleCopy() {
    const url = buildJoinUrl(invite.token);
    startTransition(async () => {
      await copyToClipboard(url);
      toast.success("Link copied.");
    });
  }

  function handleRevoke() {
    startTransition(async () => {
      const result = await revokeLinkInviteAction({ inviteId: invite.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Invite revoked.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col">
        <p className="text-sm font-medium">
          {LEAGUE_ROLE_LABELS[invite.role]} invite
        </p>
        <p className="text-xs text-muted-foreground">
          {expired
            ? "Expired"
            : `Expires in ${formatDistanceToNow(invite.expiresAt)}`}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopy}
          disabled={isPending || expired}
        >
          <CopyIcon className="size-4" />
          Copy link
        </Button>
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
    </div>
  );
}

function buildJoinUrl(token: string): string {
  if (typeof window === "undefined") return `/join/${token}`;
  return `${window.location.origin}/join/${token}`;
}

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast.error("Couldn't copy to clipboard.");
  }
}
