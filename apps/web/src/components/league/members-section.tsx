import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MEMBER_ROLE,
  type LeagueMember,
  type LeagueResponse,
  type MemberRole,
} from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { memberRoleLabel } from "@/lib/league";
import { initialsOf } from "@/lib/user";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { leagueQueryKey } from "@/components/league/query-key";

export function MembersSection({
  league,
  isCommissioner,
}: {
  league: LeagueResponse;
  isCommissioner: boolean;
}) {
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const leagueId = league.id;
  const myUserId = session?.user.id;

  const updateRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: MemberRole }) => {
      const { error, response } = await api.PATCH("/api/leagues/{leagueId}/members/{memberId}", {
        params: { path: { leagueId, memberId } },
        body: { role },
      });
      if (error) {
        // cap_exceeded / last_commissioner are expected refusals the server
        // already phrases — surface verbatim, don't throw.
        if (response.status === 409) {
          toast.error(error.message);
          return null;
        }
        throw error;
      }
      return true;
    },
    onSuccess: async () => {
      // Role changes alter the dashboard's commissioner badge too.
      await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
      await queryClient.invalidateQueries({ queryKey: ["my-leagues"] });
    },
    onError: () => toast.error("Couldn't update that member's role — please try again."),
  });

  const kickMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error, response } = await api.DELETE("/api/leagues/{leagueId}/members/{memberId}", {
        params: { path: { leagueId, memberId } },
      });
      if (error) {
        if (response.status === 409 || response.status === 400) {
          toast.error(error.message);
          return null;
        }
        throw error;
      }
      return true;
    },
    onSuccess: async () => {
      // Kicks change the member count the dashboard card shows.
      await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
      await queryClient.invalidateQueries({ queryKey: ["my-leagues"] });
    },
    onError: () => toast.error("Couldn't remove that member — please try again."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          {league.members.length} member{league.members.length === 1 ? "" : "s"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {league.members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isCommissioner={isCommissioner}
            isOwnRow={member.userId === myUserId}
            onPromote={() =>
              updateRole.mutate({ memberId: member.id, role: MEMBER_ROLE.COMMISSIONER })
            }
            onDemote={() => updateRole.mutate({ memberId: member.id, role: MEMBER_ROLE.MEMBER })}
            onKick={() => kickMember.mutate(member.id)}
            isRolePending={updateRole.isPending && updateRole.variables?.memberId === member.id}
            isKickPending={kickMember.isPending && kickMember.variables === member.id}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function MemberRow({
  member,
  isCommissioner,
  isOwnRow,
  onPromote,
  onDemote,
  onKick,
  isRolePending,
  isKickPending,
}: {
  member: LeagueMember;
  isCommissioner: boolean;
  isOwnRow: boolean;
  onPromote: () => void;
  onDemote: () => void;
  onKick: () => void;
  isRolePending: boolean;
  isKickPending: boolean;
}) {
  const initials = initialsOf(member.displayName);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
      <div className="flex items-center gap-3">
        <Avatar>
          <AvatarImage src={member.image ?? undefined} alt="" />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{member.displayName}</span>
          {member.username && (
            <span className="text-xs text-muted-foreground">@{member.username}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {memberRoleLabel(member.role)} · Joined {new Date(member.joinedAt).toLocaleDateString()}
          </span>
        </div>
      </div>
      {isCommissioner && (
        <div className="flex items-center gap-2">
          {member.role === MEMBER_ROLE.COMMISSIONER ? (
            <Button variant="outline" size="sm" disabled={isRolePending} onClick={onDemote}>
              Demote
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={isRolePending} onClick={onPromote}>
              Promote
            </Button>
          )}
          {!isOwnRow && (
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
                Kick
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {member.displayName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    They&apos;ll be removed from the league immediately.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isKickPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={isKickPending}
                    onClick={onKick}
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
    </div>
  );
}
