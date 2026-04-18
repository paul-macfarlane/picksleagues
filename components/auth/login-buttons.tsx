"use client";

import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { DiscordIcon, GoogleIcon } from "@/components/auth/oauth-icons";

type Provider = "google" | "discord";

export function LoginButtons({
  callbackURL = "/leagues",
}: {
  callbackURL?: string;
}) {
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);

  async function handleSignIn(provider: Provider) {
    setPendingProvider(provider);
    try {
      await authClient.signIn.social({ provider, callbackURL });
    } catch {
      toast.error("Sign-in failed. Please try again.");
      setPendingProvider(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <Button
        type="button"
        size="lg"
        variant="outline"
        onClick={() => handleSignIn("google")}
        disabled={pendingProvider !== null}
        className="w-full"
      >
        <GoogleIcon data-icon="inline-start" className="size-4" />
        {pendingProvider === "google" ? "Redirecting…" : "Continue with Google"}
      </Button>
      <Button
        type="button"
        size="lg"
        variant="outline"
        onClick={() => handleSignIn("discord")}
        disabled={pendingProvider !== null}
        className="w-full"
      >
        <DiscordIcon data-icon="inline-start" className="size-4" />
        {pendingProvider === "discord"
          ? "Redirecting…"
          : "Continue with Discord"}
      </Button>
    </div>
  );
}
