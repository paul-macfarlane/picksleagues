import { MEMBER_ROLE, type LeagueMember, type LeagueResponse } from "@picksleagues/schemas";
import { useUpdateMemberDues } from "@/api/dues";
import { useKickMember, useLeaveLeague, useUpdateMemberRole } from "@/api/members";
import { authClient } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { hasSoleCommissioner, memberRoleLabel } from "@/lib/league";
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
import { rowClassName } from "@/components/row";
import { Section } from "@/components/section";
import { UserIdentity } from "@/components/user-identity";

const KICK_LOCKED_REASON_ID = "kick-locked-reason";
const DEMOTE_LOCKED_REASON_ID = "demote-locked-reason";
const LEAVE_LOCKED_REASON_ID = "leave-league-reason";

export function MembersSection({
  league,
  isCommissioner,
  started,
}: {
  league: LeagueResponse;
  isCommissioner: boolean;
  started: boolean;
}) {
  const { data: session } = authClient.useSession();
  const leagueId = league.id;
  const myUserId = session?.user.id;

  const updateRole = useUpdateMemberRole(leagueId);
  const kickMember = useKickMember(leagueId);
  const updateDues = useUpdateMemberDues(leagueId);

  // The mark control exists only while the league tracks dues: the server
  // refuses a mark with no amount set (dues_not_enabled, ADR-0045), and a
  // league that never collects sees no dues surface anywhere.
  const canMarkDues = isCommissioner && league.duesAmount !== null;

  // Disables a sole commissioner's own Demote up front rather than walking
  // them through a confirmation whose outcome the server can't grant.
  const soleCommissioner = hasSoleCommissioner(league);

  // Every member, regardless of role, can leave from here.
  const leaveLeague = useLeaveLeague(leagueId);

  // Leaving hits the same server boundaries as the row actions: frozen once
  // the league starts, and refused whenever it would strand the league
  // without a commissioner (ADR-0004) — a sole-member commissioner deletes
  // the league (Settings → Danger zone) rather than emptying it. Same
  // disable-with-reason treatment as Demote: a confirmation the server must
  // refuse is worse than a stated lock.
  const leaveLockedReason = started
    ? "Membership is frozen once the league starts."
    : isCommissioner && soleCommissioner
      ? league.members.length === 1
        ? "You're the league's only member — deleting it from Settings is how you leave."
        : "Leaving needs another commissioner — promote a replacement first."
      : null;

  return (
    <Section
      title="Members"
      description={`${league.members.length} member${league.members.length === 1 ? "" : "s"}`}
    >
      {/* One note serves every row's Kick trigger rather than
            repeating the reason per row — each disabled trigger below points
            at it via aria-describedby. */}
      {isCommissioner && started && (
        <p id={KICK_LOCKED_REASON_ID} className="text-sm text-muted-foreground">
          Removing members is locked once the league starts.
        </p>
      )}
      {isCommissioner && soleCommissioner && (
        <p id={DEMOTE_LOCKED_REASON_ID} className="text-sm text-muted-foreground">
          Stepping down needs another commissioner — promote a replacement first.
        </p>
      )}

      <ul className="flex flex-col">
        {league.members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isCommissioner={isCommissioner}
            isOwnRow={member.userId === myUserId}
            demoteLocked={soleCommissioner}
            kickLocked={started}
            onPromote={() =>
              updateRole.mutate({ memberId: member.id, role: MEMBER_ROLE.COMMISSIONER })
            }
            onDemote={() => updateRole.mutate({ memberId: member.id, role: MEMBER_ROLE.MEMBER })}
            onKick={() => kickMember.mutate(member.id)}
            onToggleDuesPaid={
              canMarkDues
                ? () => updateDues.mutate({ memberId: member.id, paid: member.duesPaidAt === null })
                : undefined
            }
            isRolePending={updateRole.isPending && updateRole.variables?.memberId === member.id}
            isKickPending={kickMember.isPending && kickMember.variables === member.id}
            isDuesPending={updateDues.isPending && updateDues.variables?.memberId === member.id}
          />
        ))}
      </ul>

      {/* Clearly separated from the roster above — visible to every
            member, not gated on isCommissioner. */}
      <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
        {leaveLockedReason !== null && (
          <p id={LEAVE_LOCKED_REASON_ID} className="text-sm text-muted-foreground">
            {leaveLockedReason}
          </p>
        )}
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="outline"
                className="w-full justify-center text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={leaveLockedReason !== null || leaveLeague.isPending}
                aria-describedby={leaveLockedReason !== null ? LEAVE_LOCKED_REASON_ID : undefined}
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
    </Section>
  );
}

function MemberRow({
  member,
  isCommissioner,
  isOwnRow,
  demoteLocked,
  kickLocked,
  onPromote,
  onDemote,
  onKick,
  onToggleDuesPaid,
  isRolePending,
  isKickPending,
  isDuesPending,
}: {
  member: LeagueMember;
  isCommissioner: boolean;
  isOwnRow: boolean;
  demoteLocked: boolean;
  kickLocked: boolean;
  onPromote: () => void;
  onDemote: () => void;
  onKick: () => void;
  // Absent while the league isn't tracking dues — no control renders at all.
  onToggleDuesPaid: (() => void) | undefined;
  isRolePending: boolean;
  isKickPending: boolean;
  isDuesPending: boolean;
}) {
  return (
    <li className={cn(rowClassName, "flex flex-wrap items-center justify-between gap-3")}>
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
          {/* One tap either way — the server treats both directions as
              idempotent, so a stale label can't double-record or error. The
              label names the commissioner's next action; it is not the
              status display every member sees (DUES-3). */}
          {onToggleDuesPaid && (
            <Button variant="outline" size="sm" disabled={isDuesPending} onClick={onToggleDuesPaid}>
              {member.duesPaidAt === null ? "Mark paid" : "Mark unpaid"}
            </Button>
          )}
          {/* Promote/demote are anytime actions (LEAGUE_ACTION rules) — they
              stay enabled post-start; only Kick below has a window. */}
          {member.role === MEMBER_ROLE.COMMISSIONER ? (
            isOwnRow ? (
              // Self-demotion alone gets a confirmation: it's the one role
              // change the actor can't undo from their own UI — the moment it
              // lands they have no Promote button, and only another
              // commissioner can restore them. Demoting someone else stays one
              // click because the actor keeps the power to reverse it. A sole
              // commissioner's trigger is disabled outright (same idiom as
              // Kick's locked state): the server refuses that demotion
              // (≥1-commissioner invariant, ADR-0004), so a dialog could only
              // confirm an action that must fail.
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isRolePending || demoteLocked}
                      aria-describedby={demoteLocked ? DEMOTE_LOCKED_REASON_ID : undefined}
                    />
                  }
                >
                  Demote
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Step down as commissioner?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You&apos;ll lose commissioner tools immediately, and only another commissioner
                      can re-promote you.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isRolePending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={isRolePending}
                      onClick={onDemote}
                    >
                      Step down
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button variant="outline" size="sm" disabled={isRolePending} onClick={onDemote}>
                Demote
              </Button>
            )
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
                render={
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={kickLocked || isKickPending}
                    aria-describedby={kickLocked ? KICK_LOCKED_REASON_ID : undefined}
                  />
                }
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
    </li>
  );
}
