import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { UsernameSchema } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { safeInternalPath } from "@/lib/redirect";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const searchSchema = z.object({
  // Invite-link return path threaded through sign-in → claim (mvp-spec
  // §Users & Identity onboarding; consumed by LG-3's /join/:code).
  redirect: z.string().optional(),
});

// Top-level (not under _authed): claiming is session-required, but this route
// is what satisfies the username gate — it must not itself be gated by it, and
// onboarding shouldn't show the signed-in app shell/session menu.
export const Route = createFileRoute("/claim-username")({
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    const { data: session } = await authClient.getSession();
    if (!session) {
      throw redirect({ to: "/sign-in", search: { redirect: search.redirect } });
    }
    // Already claimed — nothing to do here; send the user on to wherever they
    // were headed instead of showing the claim form again.
    if (session.user.username) {
      throw redirect({ to: safeInternalPath(search.redirect) });
    }
  },
  component: ClaimUsername,
});

function ClaimUsername() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const claim = useMutation({
    mutationFn: async (value: string) => {
      const { data, error, response } = await api.PATCH("/api/me", { body: { username: value } });
      if (error) {
        // Taken is field-level feedback, not a toast — surface inline and stop.
        if (response.status === 409) {
          setFieldError("That username is already taken.");
          return null;
        }
        throw error;
      }
      return data;
    },
    onSuccess: (data) => {
      if (!data) return;
      navigate({ to: safeInternalPath(search.redirect) });
    },
    onError: () => {
      toast.error("Couldn't claim that username — please try again.");
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = UsernameSchema.safeParse(username);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Invalid username.");
      return;
    }
    setFieldError(null);
    claim.mutate(parsed.data);
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <h1 className="text-2xl font-semibold text-foreground">Choose your username</h1>
          <CardDescription>
            3-20 characters: letters, numbers, and underscores. This is how other players will see
            you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  if (fieldError) setFieldError(null);
                }}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? "username-error" : undefined}
              />
              {fieldError && (
                <p id="username-error" className="text-sm text-destructive">
                  {fieldError}
                </p>
              )}
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full justify-center"
              disabled={claim.isPending}
            >
              {claim.isPending ? "Claiming…" : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
