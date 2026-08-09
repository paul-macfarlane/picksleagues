import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { authClient } from "@/lib/auth";
import { safeInternalPath } from "@/lib/redirect";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { GoogleIcon, DiscordIcon } from "@/components/icons";

const searchSchema = z.object({
  // Invite-link return path (mvp-spec §Users & Identity onboarding; LG-3's
  // /join/:code) — threaded through OAuth → claim username → dashboard.
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/sign-in")({
  validateSearch: searchSchema,
  // Signed-in users have nothing to do here — send them on to wherever they
  // were headed.
  beforeLoad: async ({ search }) => {
    const { data: session } = await authClient.getSession();
    if (session) {
      throw redirect({ to: safeInternalPath(search.redirect) });
    }
  },
  component: SignIn,
});

function SignIn() {
  const { redirect: redirectParam } = Route.useSearch();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <BrandMark className="mx-auto size-12" />
          <h1 className="text-2xl font-semibold text-foreground">Picks Leagues</h1>
          <CardDescription>Sports pick&apos;em with friends.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Colors/border below are Google's mandated Sign-In button treatment, not
              theme tokens — see Google Identity branding guidelines cited in icons.tsx.
              Google's guidelines permit this light-on-white button on dark surfaces, so
              it must render identically in both themes. The plain (non-`dark:`) classes
              alone aren't enough: the `outline` variant's own `dark:bg-input/30` /
              `dark:border-input` / `dark:hover:bg-input/50` are `dark:`-prefixed compound
              selectors, which beat un-prefixed single-class selectors like `bg-white` in
              dark mode regardless of source order — tailwind-merge only dedupes classes
              within the same modifier context, so it can't resolve this either. Explicit
              `dark:` overrides here are what actually wins the cascade. */}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full justify-center gap-3 border-[#747775] bg-white text-[#1F1F1F] hover:bg-white/90 dark:border-[#747775] dark:bg-white dark:text-[#1F1F1F] dark:hover:bg-white/90"
            onClick={() =>
              authClient.signIn.social({
                provider: "google",
                callbackURL: safeInternalPath(redirectParam),
              })
            }
          >
            <GoogleIcon className="h-5 w-5" />
            Continue with Google
          </Button>
          {/* Discord "Blurple" (#5865F2) is mandated by Discord's brand guidelines,
              cited in icons.tsx — the other sanctioned non-token color. */}
          <Button
            type="button"
            size="lg"
            className="w-full justify-center gap-3 bg-[#5865F2] text-white hover:bg-[#4752C4]"
            onClick={() =>
              authClient.signIn.social({
                provider: "discord",
                callbackURL: safeInternalPath(redirectParam),
              })
            }
          >
            <DiscordIcon className="h-5 w-5" />
            Continue with Discord
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
