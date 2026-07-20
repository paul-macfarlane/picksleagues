import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { GoogleIcon, DiscordIcon } from "@/components/icons";

export const Route = createFileRoute("/sign-in")({
  // Signed-in users have nothing to do here — send them straight to the dashboard.
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session) {
      throw redirect({ to: "/" });
    }
  },
  component: SignIn,
});

function SignIn() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/health");
      if (error) throw error;
      return data;
    },
  });

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <h1 className="text-2xl font-semibold text-foreground">Picks Leagues</h1>
          <CardDescription>Sports pick&apos;em with friends.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Colors/border below are Google's mandated Sign-In button treatment, not
              theme tokens — see Google Identity branding guidelines cited in icons.tsx. */}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full justify-center gap-3 border-[#747775] bg-white text-[#1F1F1F] hover:bg-white/90"
            onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/" })}
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
            onClick={() => authClient.signIn.social({ provider: "discord", callbackURL: "/" })}
          >
            <DiscordIcon className="h-5 w-5" />
            Continue with Discord
          </Button>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        API: {health.isPending ? "checking…" : health.data?.status === "ok" ? "up" : "unreachable"}
      </p>
    </main>
  );
}
