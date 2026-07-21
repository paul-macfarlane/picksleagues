import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DisplayNameSchema, UsernameSchema, type MeResponse } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ME_QUERY_KEY = ["me"];

export const Route = createFileRoute("/_authed/profile")({
  component: Profile,
});

function Profile() {
  // useSession's refetch lets the header pick up a display-name change without
  // a full navigation — the session menu reads Better Auth's session, not
  // /api/me, so invalidating the "me" query alone wouldn't touch it.
  const { refetch: refetchSession } = authClient.useSession();

  const me = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/me");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (me.isError) {
      toast.error("Couldn't load your profile — please try again.");
    }
  }, [me.isError]);

  if (me.isPending) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </main>
    );
  }

  if (me.isError || !me.data) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your profile.</p>
        <Button variant="outline" onClick={() => me.refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  // Keyed on the server values so a successful save (which invalidates and
  // refetches "me") remounts the form with fresh initial state instead of
  // syncing local state from a prop in an effect.
  return (
    <ProfileForm
      key={`${me.data.username ?? ""}:${me.data.displayName}`}
      profile={me.data}
      refetchSession={refetchSession}
    />
  );
}

function ProfileForm({
  profile,
  refetchSession,
}: {
  profile: MeResponse;
  refetchSession: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username ?? "");
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: async (body: { username?: string; displayName?: string }) => {
      const { data, error, response } = await api.PATCH("/api/me", { body });
      if (error) {
        // Taken is field-level feedback, not a toast — mirrors claim-username.
        if (response.status === 409) {
          setUsernameError("That username is already taken.");
          return null;
        }
        throw error;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      toast.success("Profile updated");
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await refetchSession();
    },
    onError: () => {
      toast.error("Couldn't update your profile — please try again.");
    },
  });

  const trimmedUsername = username.trim();
  // Compare trimmed: the server stores the trimmed value, so a whitespace-only
  // edit must not enable Save or fire an identical re-save.
  const displayNameChanged = displayName.trim() !== profile.displayName;
  const usernameChanged = trimmedUsername.toLowerCase() !== (profile.username ?? "");
  const hasChanges = displayNameChanged || usernameChanged;
  const initials = initialsOf(profile.displayName);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDisplayNameError(null);
    setUsernameError(null);

    const body: { username?: string; displayName?: string } = {};

    if (displayNameChanged) {
      const parsed = DisplayNameSchema.safeParse(displayName);
      if (!parsed.success) {
        setDisplayNameError(parsed.error.issues[0]?.message ?? "Invalid display name.");
        return;
      }
      body.displayName = parsed.data;
    }

    // Only validate username when it actually changed — an untouched blank
    // field (shouldn't happen post-claim, but stay defensive) must never send
    // `username: ""` to the PATCH.
    if (usernameChanged) {
      const parsed = UsernameSchema.safeParse(trimmedUsername);
      if (!parsed.success) {
        setUsernameError(parsed.error.issues[0]?.message ?? "Invalid username.");
        return;
      }
      body.username = parsed.data;
    }

    if (Object.keys(body).length === 0) return;
    update.mutate(body);
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-4 p-4 sm:p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Avatar size="lg">
            <AvatarImage src={profile.image ?? undefined} alt="" />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <h1 className="text-2xl font-semibold text-foreground">Your profile</h1>
          <CardDescription>Your avatar comes from your sign-in provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={profile.email} disabled readOnly />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  if (displayNameError) setDisplayNameError(null);
                }}
                aria-invalid={displayNameError ? true : undefined}
                aria-describedby={displayNameError ? "display-name-error" : undefined}
              />
              {displayNameError && (
                <p id="display-name-error" className="text-sm text-destructive">
                  {displayNameError}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="off"
                spellCheck={false}
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  if (usernameError) setUsernameError(null);
                }}
                aria-invalid={usernameError ? true : undefined}
                aria-describedby={usernameError ? "username-error" : undefined}
              />
              {usernameError && (
                <p id="username-error" className="text-sm text-destructive">
                  {usernameError}
                </p>
              )}
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full justify-center"
              disabled={!hasChanges || update.isPending}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <DangerZone />
    </main>
  );
}

function DangerZone() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const deleteAccount = useMutation({
    mutationFn: async () => {
      // 204 has no body — success is "no error", not a `data` payload.
      const { error } = await api.DELETE("/api/me");
      if (error) throw error;
    },
    onSuccess: () => {
      // The account and every session are already gone server-side, so there's
      // nothing left for authClient.signOut() to revoke; clearing the query
      // cache drops every stale fetch, and /sign-in's beforeLoad re-checks
      // getSession() itself, which will find no session to bounce back from.
      queryClient.clear();
      navigate({ to: "/sign-in" });
    },
    onError: () => {
      toast.error("Couldn't delete your account — please try again.");
    },
  });

  return (
    <Card className="w-full max-w-sm ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>Deleting your account is permanent and immediate.</CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive" size="lg" className="w-full justify-center" />}
          >
            Delete account
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This can&apos;t be undone. Your account is anonymized immediately: your username is
                released, your display name and avatar are replaced with a &quot;Deleted User&quot;
                placeholder, and your sign-in identities are removed. Your picks and league history
                stay under that placeholder. You&apos;ll be signed out everywhere, and signing in
                again with the same provider creates a brand-new account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteAccount.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleteAccount.isPending}
                onClick={() => deleteAccount.mutate()}
              >
                {deleteAccount.isPending ? "Deleting…" : "Delete account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
