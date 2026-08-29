import { createFileRoute } from "@tanstack/react-router";
import { useForm, useStore } from "@tanstack/react-form";
import { toastSuccess } from "@/lib/toast";
import {
  DisplayNameSchema,
  ImageUrlSchema,
  UsernameSchema,
  type MeResponse,
  type UpdateMeRequest,
} from "@picksleagues/schemas";
import { useDeleteAccount, useDeletionBlockers, useMe, useUpdateMe } from "@/api/me";
import { authClient } from "@/lib/auth";
import { useSignOut } from "@/lib/sign-out";
import { isTheme, THEME_OPTIONS, type Theme } from "@/lib/theme";
import { useTheme } from "next-themes";
import { LoadingRegion } from "@/components/loading";
import { QueryState } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAvatarPreview } from "@/lib/avatar-preview";
import { AvatarThemePreview } from "@/components/avatar-theme-preview";
import { InstallCard } from "@/components/install-card";
import { LabeledSelect } from "@/components/labeled-select";
import { CopyrightNotice, LegalLinks } from "@/components/legal-footer";
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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Section } from "@/components/section";
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

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <QueryState
        isPending={me.isPending}
        pendingFallback={
          <LoadingRegion
            label="Loading profile"
            className="flex w-full flex-col items-center gap-4"
          >
            <Skeleton className="h-8 w-40 self-start" />
            <Skeleton className="h-96 w-full max-w-sm self-center" />
          </LoadingRegion>
        }
        isError={me.isError}
        onRetry={() => void me.refetch()}
        errorMessage="Couldn't load your profile."
      >
        {me.data && (
          // Keyed on the server values so a successful save (which invalidates
          // and refetches "me") remounts the form with fresh initial state
          // instead of syncing local state from a prop in an effect.
          <ProfileForm
            key={`${me.data.username ?? ""}:${me.data.displayName}:${me.data.imageOverride ?? ""}`}
            profile={me.data}
            refetchSession={refetchSession}
          />
        )}
      </QueryState>
    </main>
  );
}

function ProfileForm({
  profile,
  refetchSession,
}: {
  profile: MeResponse;
  refetchSession: () => Promise<void>;
}) {
  const update = useUpdateMe({
    // Taken is field-level feedback, not a toast — mirrors claim-username.
    onUsernameTaken: () =>
      form.setErrorMap({
        onSubmit: { fields: { username: "That username is already taken." } },
      }),
    onSuccess: async () => {
      toastSuccess("Profile updated");
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

  // Rendered inside Profile's <main> (which owns the page column and the
  // QueryState gate) — this is content, not a page.
  return (
    <>
      {/* Every top-level page carries this heading in this style — the identity
          card below shows *who* you are, which is not the same as naming the
          page for a screen reader landing on it. */}
      <h1 className="self-start text-2xl text-foreground">Your profile</h1>
      {/* One column owns the width for everything below the heading, so no
          section can drift to the page edge while its neighbours sit centred
          — which is exactly what happened when each set its own `max-w-sm`. */}
      <div className="flex w-full max-w-sm flex-col gap-4 self-center">
        <Card>
          <CardHeader className="items-center text-center">
            <UserIdentity
              displayName={profile.displayName}
              username={profile.username}
              image={preview.src}
              avatarSize="lg"
              className="flex-col"
            />
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
                    if (trimmed === (profile.imageOverride ?? "") || trimmed === "")
                      return undefined;
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
                    hint="Comes from your sign-in provider unless you set one here. Clear the field to go back."
                  />
                )}
              </form.Field>
              {/* The avatar silently holding at its old image is ambiguous — it
                reads as "the preview is slow" when it actually means the URL
                won't render for anyone. `role="status"` so it's announced,
                since the preview itself is purely visual. */}
              {/* Only while the URL is being changed: the header avatar already
                shows the saved image in the current theme, and the question
                the swatches answer — does this read on *both* grounds — is one
                the member asks before saving, not after. */}
              {draftImage.trim() !== (profile.imageOverride ?? "") && (
                <AvatarThemePreview image={preview.src} displayName={profile.displayName} />
              )}
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
                      Save changes
                    </Button>
                  );
                }}
              </form.Subscribe>
            </form>
          </CardContent>
        </Card>
        {/* One page, sectioned (owner, 2026-08-22) rather than a /settings
          split: on phones this tab is the whole account surface — the header
          menu that used to hold theme and sign-out is gone below `sm` — and
          a second route would add navigation a friends-scale app doesn't
          need yet. */}
        <AppearanceCard />
        <InstallCard />
        <AccountCard />
        <AboutCard />
        <DangerZone />
      </div>
    </>
  );
}

function AppearanceCard() {
  // No SSR pass, so next-themes' `theme` is already correct on first paint;
  // `isTheme` guards the string it types as `string | undefined`.
  const { theme, setTheme } = useTheme();

  return (
    <Section title="Appearance">
      <LabeledSelect<Theme>
        id="theme"
        label="Theme"
        value={isTheme(theme) ? theme : null}
        onValueChange={setTheme}
        options={[...THEME_OPTIONS]}
      />
    </Section>
  );
}

function AccountCard() {
  const signOut = useSignOut();

  return (
    <Section title="Account">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full justify-center"
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
    </Section>
  );
}

function AboutCard() {
  return (
    <Section title="About">
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <LegalLinks />
        <CopyrightNotice />
      </div>
    </Section>
  );
}

function DangerZone() {
  const deleteAccount = useDeleteAccount();
  // Disable-with-reason before the click, matching the Leave button's
  // sole-commissioner treatment (FB-6, FB-13): the server would only refuse
  // with a 409 the member can't act on from here. A failed read falls open —
  // the deletion transaction re-checks, and its refusal names the same reason.
  const blockers = useDeletionBlockers();
  const blockingLeagues = blockers.data?.leagues ?? [];
  const blocked = blockingLeagues.length > 0;

  return (
    <Section
      title={<span className="text-destructive">Danger zone</span>}
      description="Deleting your account is permanent and immediate."
    >
      {blocked && (
        <p data-testid="deletion-blocked-reason" className="text-sm text-muted-foreground">
          You&apos;re the only commissioner of{" "}
          {blockingLeagues.map((league) => league.name).join(", ")} — promote another commissioner
          there before deleting your account.
        </p>
      )}
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              variant="destructive"
              size="lg"
              className="w-full justify-center"
              disabled={blocked || deleteAccount.isPending}
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
    </Section>
  );
}
