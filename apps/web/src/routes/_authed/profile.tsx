import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useStore } from "@tanstack/react-form";
import { toast } from "sonner";
import {
  DisplayNameSchema,
  ImageUrlSchema,
  UsernameSchema,
  type MeResponse,
  type UpdateMeRequest,
} from "@picksleagues/schemas";
import { useDeleteAccount, useMe, useUpdateMe, ME_QUERY_KEY } from "@/api/me";
import { authClient } from "@/lib/auth";
import { useAvatarPreview } from "@/lib/avatar-preview";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserIdentity } from "@/components/user-identity";

export const Route = createFileRoute("/_authed/profile")({
  component: Profile,
});

function Profile() {
  // useSession's refetch lets the header pick up a display-name change without
  // a full navigation — the session menu reads Better Auth's session, not
  // /api/me, so invalidating the "me" query alone wouldn't touch it.
  const { refetch: refetchSession } = authClient.useSession();

  const me = useMe();

  useEffect(() => {
    if (me.isError) {
      toast.error("Couldn't load your profile — please try again.");
    }
  }, [me.isError]);

  if (me.isPending) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </main>
    );
  }

  if (me.isError || !me.data) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-4 sm:p-6">
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
      key={`${me.data.username ?? ""}:${me.data.displayName}:${me.data.imageOverride ?? ""}`}
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

  const update = useUpdateMe({
    // Taken is field-level feedback, not a toast — mirrors claim-username.
    onUsernameTaken: () =>
      form.setErrorMap({
        onSubmit: { fields: { username: "That username is already taken." } },
      }),
    onSuccess: async () => {
      toast.success("Profile updated");
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await refetchSession();
    },
    errorToastMessage: "Couldn't update your profile — please try again.",
  });

  const form = useForm({
    defaultValues: {
      displayName: profile.displayName,
      username: profile.username ?? "",
      // Always a string here: `null` is a wire concept (it's how the member
      // clears the override) materialized only at submit.
      imageOverride: profile.imageOverride ?? "",
    },
    onSubmit: async ({ value }) => {
      // Each field's own onSubmit validator (below) already confirmed it's
      // either unchanged or passes its schema — safe to parse again here for
      // the canonical (trimmed/lowercased) value to send.
      const displayNameChanged = value.displayName.trim() !== profile.displayName;
      const usernameChanged = value.username.trim().toLowerCase() !== (profile.username ?? "");
      const trimmedImage = value.imageOverride.trim();
      const imageOverrideChanged = trimmedImage !== (profile.imageOverride ?? "");

      const body: UpdateMeRequest = {};
      if (displayNameChanged) body.displayName = DisplayNameSchema.parse(value.displayName);
      if (usernameChanged) body.username = UsernameSchema.parse(value.username);
      // Emptying the field is the clear, and `null` is how the wire says so —
      // omitting the key would mean "leave it alone" instead.
      if (imageOverrideChanged) {
        body.imageOverride = trimmedImage === "" ? null : ImageUrlSchema.parse(trimmedImage);
      }

      if (Object.keys(body).length === 0) return;
      // Fire-and-forget `mutate`: form-core re-throws an awaited rejection out of
      // handleSubmit as an unhandled rejection; the mutation's onError owns failures.
      update.mutate(body);
    },
  });

  // `useStore` rather than this file's `form.Subscribe` idiom: a render prop
  // can't host the preview hook, and two subscriptions (header avatar, hint
  // below the field) would run two independent probes of the same URL. Same
  // store either way.
  const draftImage = useStore(form.store, (state) => state.values.imageOverride);
  const preview = useAvatarPreview({
    draft: draftImage,
    savedImage: profile.image,
    providerImage: profile.providerImage,
  });

  return (
    <main className="flex flex-1 flex-col items-center gap-4 p-4 sm:p-6">
      {/* Every top-level page carries this heading in this style — the identity
          card below shows *who* you are, which is not the same as naming the
          page for a screen reader landing on it. */}
      <h1 className="self-start text-2xl font-semibold text-foreground">Your profile</h1>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <UserIdentity
            displayName={profile.displayName}
            username={profile.username}
            image={preview.src}
            avatarSize="lg"
            className="flex-col"
          />
          <CardDescription>
            Your avatar comes from your sign-in provider unless you set an image URL below. This
            preview updates as you type; clearing the field goes back to the provider&apos;s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={profile.email} disabled readOnly />
            </div>
            <form.Field
              name="displayName"
              validators={{
                // Unchanged is always valid — only a real edit must pass DisplayNameSchema.
                onSubmit: ({ value }) => {
                  if (value.trim() === profile.displayName) return undefined;
                  const parsed = DisplayNameSchema.safeParse(value);
                  return parsed.success
                    ? undefined
                    : (parsed.error.issues[0]?.message ?? "Invalid display name.");
                },
              }}
            >
              {(field) => <FormTextField field={field} label="Display name" />}
            </form.Field>
            <form.Field
              name="username"
              validators={{
                // Unchanged is always valid — only a real edit must pass UsernameSchema.
                onSubmit: ({ value }) => {
                  const trimmed = value.trim().toLowerCase();
                  if (trimmed === (profile.username ?? "")) return undefined;
                  const parsed = UsernameSchema.safeParse(trimmed);
                  return parsed.success
                    ? undefined
                    : (parsed.error.issues[0]?.message ?? "Invalid username.");
                },
              }}
            >
              {(field) => (
                <FormTextField
                  field={field}
                  label="Username"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </form.Field>
            <form.Field
              name="imageOverride"
              validators={{
                // Unchanged is valid, and so is empty — emptying the field is
                // how the member reverts to the provider's avatar.
                onSubmit: ({ value }) => {
                  const trimmed = value.trim();
                  if (trimmed === (profile.imageOverride ?? "") || trimmed === "") return undefined;
                  const parsed = ImageUrlSchema.safeParse(trimmed);
                  return parsed.success
                    ? undefined
                    : (parsed.error.issues[0]?.message ?? "Enter an https image URL.");
                },
              }}
            >
              {(field) => (
                <FormTextField
                  field={field}
                  label="Avatar image URL"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://…"
                />
              )}
            </form.Field>
            {/* The avatar silently holding at its old image is ambiguous — it
                reads as "the preview is slow" when it actually means the URL
                won't render for anyone. `role="status"` so it's announced,
                since the preview itself is purely visual. */}
            {preview.failed && (
              <p role="status" className="text-xs text-muted-foreground">
                We couldn&apos;t load that image. Saving it will show your initials instead.
              </p>
            )}
            <form.Subscribe selector={(state) => state.values}>
              {(values) => {
                // Compare trimmed: the server stores the trimmed value, so a
                // whitespace-only edit must not enable Save or fire an
                // identical re-save.
                const displayNameChanged = values.displayName.trim() !== profile.displayName;
                const usernameChanged =
                  values.username.trim().toLowerCase() !== (profile.username ?? "");
                // Comparing against "" for an unset override is what enables
                // Save when the member *empties* a field that had a value.
                const imageOverrideChanged =
                  values.imageOverride.trim() !== (profile.imageOverride ?? "");
                const hasChanges = displayNameChanged || usernameChanged || imageOverrideChanged;

                return (
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full justify-center"
                    disabled={!hasChanges || update.isPending}
                  >
                    {update.isPending ? "Saving…" : "Save changes"}
                  </Button>
                );
              }}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>
      <DangerZone />
    </main>
  );
}

function DangerZone() {
  const deleteAccount = useDeleteAccount();

  return (
    <Card className="w-full max-w-sm ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>Deleting your account is permanent and immediate.</CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="destructive"
                size="lg"
                className="w-full justify-center"
                disabled={deleteAccount.isPending}
              />
            }
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
                Delete account
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
