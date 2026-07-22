import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
  ELIMINATION_PUSH_TIE_RESOLUTION,
  INVITE_STATUS,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  MARCH_MADNESS_SCORING_MODEL,
  MEMBER_ROLE,
  PICKEM_PUSH_TIE_RESOLUTION,
  LeagueNameSchema,
  type CreateInviteRequest,
  type EliminationPushTieResolution,
  type EliminationSettings,
  type Invite,
  type LeagueMember,
  type LeagueResponse,
  type LeagueVisibility,
  type MarchMadnessScoringModel,
  type MarchMadnessSettings,
  type MemberRole,
  type PickType,
  type PickemPushTieResolution,
  type PickemSettings,
  type UpdateLeagueRequest,
} from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { leagueModeLabel, memberRoleLabel } from "@/lib/league";
import { initialsOf } from "@/lib/user";
import {
  EliminationSettingsFields,
  MarchMadnessSettingsFields,
  PickemSettingsFields,
  RadioField,
  VISIBILITY_OPTIONS,
  decodeWeek,
  encodeWeek,
} from "@/components/league-settings-fields";
import { FormTextField } from "@/components/form-field";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// A single home for the query key so every mutation in this file invalidates
// (and the top-level query subscribes to) the exact same cache entry.
function leagueQueryKey(leagueId: string) {
  return ["league", leagueId];
}

export const Route = createFileRoute("/_authed/leagues/$leagueId")({
  component: LeagueHome,
});

function LeagueHome() {
  const { leagueId } = Route.useParams();

  const league = useQuery({
    queryKey: leagueQueryKey(leagueId),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/leagues/{leagueId}", {
        params: { path: { leagueId } },
      });
      if (error) {
        // 404 covers both "doesn't exist" and "not a member" — represent it
        // as "no league" rather than an error state (private leagues stay
        // hidden, mirrors join preview).
        if (response.status === 404) return null;
        throw error;
      }
      // The generated openapi types mark defaulted settings fields (e.g.
      // pushTieResolution) as optional even though the server always
      // serializes them — LeagueResponseSchema (packages/schemas) is the
      // real source of truth for the response shape.
      return data as LeagueResponse;
    },
  });

  useEffect(() => {
    if (league.isError) {
      toast.error("Couldn't load this league — please try again.");
    }
  }, [league.isError]);

  if (league.isPending) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
        <p className="text-sm text-muted-foreground">Loading league…</p>
      </main>
    );
  }

  if (league.isError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this league.</p>
        <Button variant="outline" onClick={() => league.refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  if (!league.data) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4 sm:p-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <CardTitle>League not found</CardTitle>
            <CardDescription>
              This league doesn&apos;t exist, or you&apos;re not a member.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/"
              className={buttonVariants({ size: "lg", className: "w-full justify-center" })}
            >
              Back to dashboard
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <LeagueHomeContent league={league.data} />;
}

function LeagueHomeContent({ league }: { league: LeagueResponse }) {
  const isCommissioner = league.myRole === MEMBER_ROLE.COMMISSIONER;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <LeagueHeader league={league} isCommissioner={isCommissioner} />

      <Card>
        <CardHeader>
          <CardTitle>Standings</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filled per mode once picks/scoring ship (later epics) — nothing
              to compute yet. */}
          <p className="text-sm text-muted-foreground">
            Standings will appear here once picks ship.
          </p>
        </CardContent>
      </Card>

      <MembersSection league={league} isCommissioner={isCommissioner} />

      {isCommissioner && <InvitePanel leagueId={league.id} isCommissioner={isCommissioner} />}

      {isCommissioner && <LeagueSettingsSection league={league} />}

      <DangerZoneSection league={league} isCommissioner={isCommissioner} />
    </main>
  );
}

function LeagueHeader({
  league,
  isCommissioner,
}: {
  league: LeagueResponse;
  isCommissioner: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-xl">{league.name}</CardTitle>
            <CardDescription>
              {leagueModeLabel(league.mode)} · {league.seasonYear}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize">
              {league.visibility}
            </span>
            {isCommissioner && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Commissioner
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p>
          {league.members.length} member{league.members.length === 1 ? "" : "s"}
        </p>
        <p>
          {league.startsAt
            ? `Starts ${new Date(league.startsAt).toLocaleString()}`
            : "Start date TBD"}
        </p>
      </CardContent>
    </Card>
  );
}

function MembersSection({
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
            isRolePending={updateRole.isPending}
            isKickPending={kickMember.isPending}
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
                    {isKickPending ? "Removing…" : "Remove"}
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

function InvitePanel({ leagueId, isCommissioner }: { leagueId: string; isCommissioner: boolean }) {
  const queryClient = useQueryClient();
  const invitesQueryKey = ["league-invites", leagueId];

  const invites = useQuery({
    queryKey: invitesQueryKey,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/leagues/{leagueId}/invites", {
        params: { path: { leagueId } },
      });
      if (error) throw error;
      return data;
    },
    // Only a commissioner can list invites (403 otherwise) — this panel is
    // only ever mounted for commissioners, but the guard stays explicit.
    enabled: isCommissioner,
  });

  useEffect(() => {
    if (invites.isError) {
      toast.error("Couldn't load invites — please try again.");
    }
  }, [invites.isError]);

  const createInvite = useMutation({
    mutationFn: async (body: CreateInviteRequest) => {
      const { data, error, response } = await api.POST("/api/leagues/{leagueId}/invites", {
        params: { path: { leagueId } },
        body,
      });
      if (error) {
        if (response.status === 400) {
          toast.error(error.message);
          return null;
        }
        throw error;
      }
      return data;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      if (data) toast.success("Invite created");
    },
    onError: () => toast.error("Couldn't create an invite — please try again."),
  });

  const revokeInvite = useMutation({
    mutationFn: async (code: string) => {
      const { error } = await api.DELETE("/api/leagues/{leagueId}/invites/{code}", {
        params: { path: { leagueId, code } },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
    },
    onError: () => toast.error("Couldn't revoke that invite — please try again."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invites</CardTitle>
        <CardDescription>Share a link so others can join.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {invites.isPending && <p className="text-sm text-muted-foreground">Loading invites…</p>}
        {invites.data && invites.data.invites.length === 0 && (
          <p className="text-sm text-muted-foreground">No invites yet.</p>
        )}
        {invites.data && invites.data.invites.length > 0 && (
          <ul className="flex flex-col gap-3">
            {invites.data.invites.map((invite) => (
              <InviteRow
                key={invite.code}
                invite={invite}
                onRevoke={() => revokeInvite.mutate(invite.code)}
                isRevoking={revokeInvite.isPending}
              />
            ))}
          </ul>
        )}
        <NewInviteForm
          onCreate={(body) => createInvite.mutate(body)}
          isPending={createInvite.isPending}
        />
      </CardContent>
    </Card>
  );
}

function InviteRow({
  invite,
  onRevoke,
  isRevoking,
}: {
  invite: Invite;
  onRevoke: () => void;
  isRevoking: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground capitalize">{invite.status}</span>
        <span className="text-xs text-muted-foreground">
          Created {new Date(invite.createdAt).toLocaleDateString()}
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1">
          <dt>Uses:</dt>
          <dd>
            {invite.useCount}/{invite.maxUses ?? "∞"}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>Expires:</dt>
          <dd>{invite.expiresAt ? new Date(invite.expiresAt).toLocaleString() : "Never"}</dd>
        </div>
      </dl>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(`${window.location.origin}/join/${invite.code}`);
            toast.success("Invite link copied");
          }}
        >
          Copy link
        </Button>
        {invite.status === INVITE_STATUS.ACTIVE && (
          <Button variant="destructive" size="sm" disabled={isRevoking} onClick={onRevoke}>
            Revoke
          </Button>
        )}
      </div>
    </li>
  );
}

// Stated deviation from the TanStack-Form rule: two optional scalar inputs
// (expiry, max uses) with no per-field validation — the schema-bounded body
// is assembled once at submit, mirroring the settings editors below.
function NewInviteForm({
  onCreate,
  isPending,
}: {
  onCreate: (body: CreateInviteRequest) => void;
  isPending: boolean;
}) {
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");

  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const body: CreateInviteRequest = {};
        // Parsing a user-entered datetime-local value into an ISO instant is
        // the one place "new Date()" is allowed — it's not a "now" read.
        if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();
        if (maxUses) body.maxUses = Number(maxUses);
        onCreate(body);
        setExpiresAt("");
        setMaxUses("");
      }}
    >
      <h3 className="text-sm font-semibold text-foreground">New invite</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-expires-at">Expires (optional)</Label>
          <Input
            id="invite-expires-at"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-max-uses">Max uses (optional)</Label>
          <Input
            id="invite-max-uses"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            step={1}
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
          />
        </div>
      </div>
      <Button type="submit" size="sm" className="self-start" disabled={isPending}>
        {isPending ? "Creating…" : "Create invite link"}
      </Button>
    </form>
  );
}

function LeagueSettingsSection({ league }: { league: LeagueResponse }) {
  const queryClient = useQueryClient();
  const leagueId = league.id;

  const updateLeague = useMutation({
    mutationFn: async (body: UpdateLeagueRequest) => {
      const { data, error, response } = await api.PATCH("/api/leagues/{leagueId}", {
        params: { path: { leagueId } },
        body,
      });
      if (error) {
        // league_started (409) or a settings shape that fails the mode's
        // schema (400) are both server-derived refusals — surface the exact
        // message, don't throw.
        if (response.status === 409 || response.status === 400) {
          toast.error(error.message);
          return null;
        }
        throw error;
      }
      return data;
    },
    onSuccess: async (data) => {
      // Renames show on the dashboard card too.
      await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
      await queryClient.invalidateQueries({ queryKey: ["my-leagues"] });
      if (data) toast.success("League updated");
    },
    onError: () => toast.error("Couldn't update this league — please try again."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>League settings</CardTitle>
        {/* Edit controls always render for commissioners; a post-start edit
            is refused via the server's 409 (league_started) rather than a
            client-computed "now" gate — lock state is derived, never
            stored, and every mutation re-validates server-side (arch D11). */}
        <CardDescription>Visibility and mode settings lock once the league starts.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <RenameForm
          key={league.name}
          league={league}
          onSave={(name) => updateLeague.mutate({ name })}
          isPending={updateLeague.isPending}
        />
        <VisibilitySection
          key={league.visibility}
          league={league}
          onSave={(visibility) => updateLeague.mutate({ visibility })}
          isPending={updateLeague.isPending}
        />
        <SettingsFieldsSection
          league={league}
          onSave={(settings) => updateLeague.mutate({ settings })}
          isPending={updateLeague.isPending}
        />
      </CardContent>
    </Card>
  );
}

function RenameForm({
  league,
  onSave,
  isPending,
}: {
  league: LeagueResponse;
  onSave: (name: string) => void;
  isPending: boolean;
}) {
  const form = useForm({
    defaultValues: { name: league.name },
    onSubmit: async ({ value }) => {
      const name = LeagueNameSchema.parse(value.name);
      if (name === league.name) return;
      onSave(name);
    },
  });

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      noValidate
    >
      <h3 className="text-sm font-semibold text-foreground">League name</h3>
      <form.Field name="name" validators={{ onSubmit: LeagueNameSchema }}>
        {(field) => <FormTextField field={field} label="Name" />}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.name}>
        {(name) => (
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={name.trim() === league.name || isPending}
          >
            {isPending ? "Saving…" : "Save name"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

function VisibilitySection({
  league,
  onSave,
  isPending,
}: {
  league: LeagueResponse;
  onSave: (visibility: LeagueVisibility) => void;
  isPending: boolean;
}) {
  const [visibility, setVisibility] = useState<LeagueVisibility>(league.visibility);

  return (
    <div className="flex flex-col gap-2">
      <RadioField
        legend="Visibility"
        name="league-visibility"
        value={visibility}
        onValueChange={setVisibility}
        options={VISIBILITY_OPTIONS}
      />
      <Button
        size="sm"
        className="self-start"
        disabled={visibility === league.visibility || isPending}
        onClick={() => onSave(visibility)}
      >
        {isPending ? "Saving…" : "Save visibility"}
      </Button>
    </div>
  );
}

function SettingsFieldsSection({
  league,
  onSave,
  isPending,
}: {
  league: LeagueResponse;
  onSave: (settings: unknown) => void;
  isPending: boolean;
}) {
  if (league.mode === LEAGUE_MODE.PICKEM) {
    return (
      <PickemSettingsEditor
        settings={league.settings as PickemSettings}
        onSave={onSave}
        isPending={isPending}
      />
    );
  }
  if (league.mode === LEAGUE_MODE.ELIMINATION) {
    return (
      <EliminationSettingsEditor
        settings={league.settings as EliminationSettings}
        onSave={onSave}
        isPending={isPending}
      />
    );
  }
  return (
    <MarchMadnessSettingsEditor
      settings={league.settings as MarchMadnessSettings}
      onSave={onSave}
      isPending={isPending}
    />
  );
}

// The three settings editors below share new.tsx's stated deviation from the
// TanStack-Form rule: select/radio/stepper state whose option sets are already
// schema-constrained, parsed as one object at submit (server re-validates).
function PickemSettingsEditor({
  settings,
  onSave,
  isPending,
}: {
  settings: PickemSettings;
  onSave: (settings: unknown) => void;
  isPending: boolean;
}) {
  const [startWeek, setStartWeek] = useState(encodeWeek(settings.startWeek));
  const [endWeek, setEndWeek] = useState(encodeWeek(settings.endWeek));
  const [pickType, setPickType] = useState<PickType>(settings.pickType);
  const [picksPerWeek, setPicksPerWeek] = useState(settings.picksPerWeek);
  const [pushTie, setPushTie] = useState<PickemPushTieResolution>(
    settings.pushTieResolution ?? PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT,
  );

  return (
    <div className="flex flex-col gap-4">
      <PickemSettingsFields
        startWeek={startWeek}
        onStartWeekChange={setStartWeek}
        endWeek={endWeek}
        onEndWeekChange={setEndWeek}
        pickType={pickType}
        onPickTypeChange={setPickType}
        picksPerWeek={picksPerWeek}
        onPicksPerWeekChange={setPicksPerWeek}
        pushTie={pushTie}
        onPushTieChange={setPushTie}
      />
      <Button
        size="sm"
        className="self-start"
        disabled={isPending}
        onClick={() => {
          const parsed = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM].safeParse({
            startWeek: decodeWeek(startWeek),
            endWeek: decodeWeek(endWeek),
            pickType,
            picksPerWeek,
            pushTieResolution: pushTie,
          });
          if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Check your league settings.");
            return;
          }
          onSave(parsed.data);
        }}
      >
        {isPending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}

function EliminationSettingsEditor({
  settings,
  onSave,
  isPending,
}: {
  settings: EliminationSettings;
  onSave: (settings: unknown) => void;
  isPending: boolean;
}) {
  const [startWeek, setStartWeek] = useState(encodeWeek(settings.startWeek));
  const [endWeek, setEndWeek] = useState(encodeWeek(settings.endWeek));
  const [pickType, setPickType] = useState<PickType>(settings.pickType);
  const [pushTie, setPushTie] = useState<EliminationPushTieResolution>(
    settings.pushTieResolution ?? ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE,
  );

  return (
    <div className="flex flex-col gap-4">
      <EliminationSettingsFields
        startWeek={startWeek}
        onStartWeekChange={setStartWeek}
        endWeek={endWeek}
        onEndWeekChange={setEndWeek}
        pickType={pickType}
        onPickTypeChange={setPickType}
        pushTie={pushTie}
        onPushTieChange={setPushTie}
      />
      <Button
        size="sm"
        className="self-start"
        disabled={isPending}
        onClick={() => {
          const parsed = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.ELIMINATION].safeParse({
            startWeek: decodeWeek(startWeek),
            endWeek: decodeWeek(endWeek),
            pickType,
            pushTieResolution: pushTie,
          });
          if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Check your league settings.");
            return;
          }
          onSave(parsed.data);
        }}
      >
        {isPending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}

function MarchMadnessSettingsEditor({
  settings,
  onSave,
  isPending,
}: {
  settings: MarchMadnessSettings;
  onSave: (settings: unknown) => void;
  isPending: boolean;
}) {
  const [maxBrackets, setMaxBrackets] = useState(settings.maxBracketsPerMember);
  const [scoringModel, setScoringModel] = useState<MarchMadnessScoringModel>(settings.scoringModel);
  const [roundValues, setRoundValues] = useState<number[]>(
    settings.scoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM
      ? settings.roundValues
      : [0, 0, 0, 0, 0, 0],
  );

  return (
    <div className="flex flex-col gap-4">
      <MarchMadnessSettingsFields
        maxBrackets={maxBrackets}
        onMaxBracketsChange={setMaxBrackets}
        scoringModel={scoringModel}
        onScoringModelChange={setScoringModel}
        roundValues={roundValues}
        onRoundValueChange={(index, next) =>
          setRoundValues((prev) => prev.map((value, i) => (i === index ? next : value)))
        }
      />
      <Button
        size="sm"
        className="self-start"
        disabled={isPending}
        onClick={() => {
          const assembled =
            scoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM
              ? { maxBracketsPerMember: maxBrackets, scoringModel, roundValues }
              : { maxBracketsPerMember: maxBrackets, scoringModel };
          const parsed = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.MARCH_MADNESS].safeParse(assembled);
          if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Check your league settings.");
            return;
          }
          onSave(parsed.data);
        }}
      >
        {isPending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}

function DangerZoneSection({
  league,
  isCommissioner,
}: {
  league: LeagueResponse;
  isCommissioner: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const leagueId = league.id;

  const leaveLeague = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE("/api/leagues/{leagueId}/members/me", {
        params: { path: { leagueId } },
      });
      if (error) {
        if (response.status === 409) {
          toast.error(error.message);
          return false;
        }
        throw error;
      }
      return true;
    },
    onSuccess: async (left) => {
      if (!left) {
        await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
        return;
      }
      toast.success("Left the league");
      await queryClient.invalidateQueries({ queryKey: ["my-leagues"] });
      navigate({ to: "/" });
    },
    onError: () => toast.error("Couldn't leave this league — please try again."),
  });

  const deleteLeague = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE("/api/leagues/{leagueId}", {
        params: { path: { leagueId } },
      });
      if (error) {
        if (response.status === 409) {
          toast.error(error.message);
          return false;
        }
        throw error;
      }
      return true;
    },
    onSuccess: async (deleted) => {
      if (!deleted) {
        await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
        return;
      }
      toast.success("League deleted");
      await queryClient.invalidateQueries({ queryKey: ["my-leagues"] });
      navigate({ to: "/" });
    },
    onError: () => toast.error("Couldn't delete this league — please try again."),
  });

  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive" className="w-full justify-center" />}
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
                {leaveLeague.isPending ? "Leaving…" : "Leave league"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {isCommissioner && (
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" className="w-full justify-center" />}
            >
              Delete league
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {league.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the league, its settings, members, and invites. This
                  can&apos;t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteLeague.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={deleteLeague.isPending}
                  onClick={() => deleteLeague.mutate()}
                >
                  {deleteLeague.isPending ? "Deleting…" : "Delete league"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}
