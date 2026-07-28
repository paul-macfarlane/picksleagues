import { MEMBER_ROLE, type LeagueMember, type LeagueResponse } from "@picksleagues/schemas";
import { useKickMember, useLeaveLeague, useUpdateMemberRole } from "@/api/members";
import { authClient } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { memberRoleLabel } from "@/lib/league";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserIdentity } from "@/components/user-identity";

export function MembersSection({
  league,
  isCommissioner,
}: {
  league: LeagueResponse;
  isCommissioner: boolean;
}) {
  const { data: session } = authClient.useSession();
  const leagueId = league.id;
  const myUserId = session?.user.id;

  const updateRole = useUpdateMemberRole(leagueId);
  const kickMember = useKickMember(leagueId);

  // Moved from the Danger Zone (item 4/5 consolidation) — every member,
  // regardless of role, can leave from here; a sole member leaving deletes
  // the league (server-enforced, unchanged).
  const leaveLeague = useLeaveLeague(leagueId);

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

        {/* Clearly separated from the roster above — visible to every
            member, not gated on isCommissioner. */}
        <div className="mt-2 border-t border-border pt-3">
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  className="w-full justify-center text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={leaveLeague.isPending}
                />
              }
            >
              Leave league
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave {league.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  You&apos;ll lose access to this league&apos;s picks and standings.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={leaveLeague.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={leaveLeague.isPending}
                  onClick={() => leaveLeague.mutate()}
                >
                  Leave league
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
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
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
      <UserIdentity
        displayName={member.displayName}
        username={member.username}
        image={member.image}
        isViewer={isOwnRow}
      >
        <span className="block truncate text-xs text-muted-foreground">
          {memberRoleLabel(member.role)} · Joined {formatDate(member.joinedAt)}
        </span>
      </UserIdentity>
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
              {/* Scoped to this row's kick (isKickPending already keys off
                  `mutation.variables`): confirming closes the dialog, so the
                  trigger is the only thing left to block a second submit. */}
              <AlertDialogTrigger
                render={<Button variant="destructive" size="sm" disabled={isKickPending} />}
              >
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
