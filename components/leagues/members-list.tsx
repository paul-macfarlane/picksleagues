"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  MoreHorizontalIcon,
  ShieldIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  demoteMemberAction,
  promoteMemberAction,
  removeMemberAction,
} from "@/actions/members";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LeagueMemberWithProfile } from "@/data/members";
import { getInitials } from "@/lib/utils";

type Action = "promote" | "demote" | "remove";

export function MembersList({
  leagueId,
  members,
  viewerUserId,
  viewerIsCommissioner,
  canRemove,
}: {
  leagueId: string;
  members: LeagueMemberWithProfile[];
  viewerUserId: string;
  viewerIsCommissioner: boolean;
  canRemove: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {members.map((member) => (
        <li key={member.id}>
          <MemberRow
            leagueId={leagueId}
            member={member}
            viewerUserId={viewerUserId}
            viewerIsCommissioner={viewerIsCommissioner}
            canRemove={canRemove}
          />
        </li>
      ))}
    </ul>
  );
}

function MemberRow({
  leagueId,
  member,
  viewerUserId,
  viewerIsCommissioner,
  canRemove,
}: {
  leagueId: string;
  member: LeagueMemberWithProfile;
  viewerUserId: string;
  viewerIsCommissioner: boolean;
  canRemove: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<Action | null>(null);

  const isSelf = member.userId === viewerUserId;
  const isCommissioner = member.role === "commissioner";

  function run(action: Action) {
    setPendingAction(action);
    startTransition(async () => {
      const payload = { leagueId, userId: member.userId };
      const result =
        action === "promote"
          ? await promoteMemberAction(payload)
          : action === "demote"
            ? await demoteMemberAction(payload)
            : await removeMemberAction(payload);
      setPendingAction(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        action === "promote"
          ? `${member.profile.name} is now a commissioner.`
          : action === "demote"
            ? `${member.profile.name} is now a member.`
            : `${member.profile.name} has been removed.`,
      );
      router.refresh();
    });
  }

  const showMenu = viewerIsCommissioner && (!isSelf || isCommissioner);

  return (
    <div className="flex items-center gap-3 p-3">
      <Avatar size="sm">
        {member.profile.avatarUrl ? (
          <AvatarImage src={member.profile.avatarUrl} alt="" />
        ) : null}
        <AvatarFallback>{getInitials(member.profile.name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {member.profile.name}
          {isSelf ? " (you)" : ""}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          @{member.profile.username}
        </span>
      </div>
      <Badge variant={isCommissioner ? "default" : "secondary"}>
        {isCommissioner ? "Commissioner" : "Member"}
      </Badge>
      {showMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={isPending}
              aria-label={`Manage ${member.profile.name}`}
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isCommissioner ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  run("demote");
                }}
                disabled={isPending}
              >
                <UserIcon className="size-4" />
                {pendingAction === "demote"
                  ? "Demoting…"
                  : isSelf
                    ? "Step down"
                    : "Demote to member"}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  run("promote");
                }}
                disabled={isPending}
              >
                <ShieldIcon className="size-4" />
                {pendingAction === "promote"
                  ? "Promoting…"
                  : "Promote to commissioner"}
              </DropdownMenuItem>
            )}
            {!isSelf && canRemove ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    run("remove");
                  }}
                  disabled={isPending}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2Icon className="size-4" />
                  {pendingAction === "remove" ? "Removing…" : "Remove"}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
