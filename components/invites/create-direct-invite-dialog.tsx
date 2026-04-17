"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlusIcon, XIcon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  createDirectInviteAction,
  searchInviteCandidatesAction,
} from "@/actions/invites";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import type { Profile } from "@/lib/db/schema/profiles";
import { getInitials } from "@/lib/utils";
import {
  INVITE_EXPIRATION_DAYS_DEFAULT,
  LEAGUE_ROLE_LABELS,
  createDirectInviteSchema,
  type CreateDirectInviteInput,
} from "@/lib/validators/invites";

type CreateDirectInviteOutput = z.output<typeof createDirectInviteSchema>;

const SEARCH_DEBOUNCE_MS = 200;

export function CreateDirectInviteDialog({ leagueId }: { leagueId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Profile[]>([]);
  const searchSeq = useRef(0);

  const defaults: CreateDirectInviteInput = useMemo(
    () => ({
      leagueId,
      inviteeUserId: "",
      role: "member",
      expirationDays: INVITE_EXPIRATION_DAYS_DEFAULT,
    }),
    [leagueId],
  );

  const form = useForm<
    CreateDirectInviteInput,
    unknown,
    CreateDirectInviteOutput
  >({
    resolver: zodResolver(createDirectInviteSchema),
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

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length === 0 || selectedProfile) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      const result = await searchInviteCandidatesAction({
        leagueId,
        query: trimmed,
      });
      if (seq !== searchSeq.current) return;
      if (result.success) {
        setCandidates(result.data);
      } else {
        toast.error(result.error);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, leagueId, open, selectedProfile]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length === 0) {
      setCandidates([]);
    }
  }

  function handlePick(profile: Profile) {
    setSelectedProfile(profile);
    setValue("inviteeUserId", profile.userId, { shouldDirty: true });
    setQuery(profile.username);
    setCandidates([]);
  }

  function clearSelection() {
    setSelectedProfile(null);
    setQuery("");
    setCandidates([]);
    setValue("inviteeUserId", "", { shouldDirty: true });
  }

  function closeDialog(next: boolean) {
    if (isPending && !next) return;
    setOpen(next);
    if (!next) {
      reset(defaults);
      setSelectedProfile(null);
      setQuery("");
      setCandidates([]);
    }
  }

  function onSubmit(values: CreateDirectInviteOutput) {
    startTransition(async () => {
      const result = await createDirectInviteAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Invite sent.");
      closeDialog(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogTrigger asChild>
        <Button>
          <UserPlusIcon className="size-4" />
          Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            Pick a user by username or name. They&apos;ll see the invite on
            their home page.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <input type="hidden" {...register("leagueId")} />
          <input type="hidden" {...register("inviteeUserId")} />

          <Field>
            <FieldLabel htmlFor="invite-search">User</FieldLabel>
            {selectedProfile ? (
              <SelectedProfilePill
                profile={selectedProfile}
                onClear={clearSelection}
              />
            ) : (
              <>
                <Input
                  id="invite-search"
                  placeholder="Search by username or name"
                  value={query}
                  onChange={(event) => handleQueryChange(event.target.value)}
                  autoComplete="off"
                />
                <SearchResults
                  query={query}
                  candidates={candidates}
                  onPick={handlePick}
                />
              </>
            )}
            <FieldError errors={[errors.inviteeUserId]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="invite-role">Role</FieldLabel>
            <Select
              value={role}
              onValueChange={(value) =>
                setValue("role", value as CreateDirectInviteInput["role"], {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger id="invite-role">
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
            <FieldLabel htmlFor="invite-expires">Expires in (days)</FieldLabel>
            <Input
              id="invite-expires"
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
              onClick={() => closeDialog(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !selectedProfile}>
              {isPending ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SelectedProfilePill({
  profile,
  onClear,
}: {
  profile: Profile;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-2">
      <div className="flex items-center gap-2">
        <Avatar size="sm">
          {profile.avatarUrl ? (
            <AvatarImage src={profile.avatarUrl} alt="" />
          ) : null}
          <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{profile.name}</span>
          <span className="text-xs text-muted-foreground">
            @{profile.username}
          </span>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Clear selection"
        onClick={onClear}
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

function SearchResults({
  query,
  candidates,
  onPick,
}: {
  query: string;
  candidates: Profile[];
  onPick: (profile: Profile) => void;
}) {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;
  if (candidates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No matching users yet. Give it a moment or refine your search.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1 rounded-md border bg-card p-1">
      {candidates.map((profile) => (
        <li key={profile.userId}>
          <button
            type="button"
            onClick={() => onPick(profile)}
            className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-muted"
          >
            <Avatar size="sm">
              {profile.avatarUrl ? (
                <AvatarImage src={profile.avatarUrl} alt="" />
              ) : null}
              <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-medium">{profile.name}</span>
              <span className="text-xs text-muted-foreground">
                @{profile.username}
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
