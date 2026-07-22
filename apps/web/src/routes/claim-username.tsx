import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { toast } from "sonner";
import { UsernameSchema } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { safeInternalPath } from "@/lib/redirect";
import { FormTextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

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

  const claim = useMutation({
    mutationFn: async (value: string) => {
      const { data, error, response } = await api.PATCH("/api/me", { body: { username: value } });
      if (error) {
        // Taken is field-level feedback, not a toast — surface inline and stop.
        if (response.status === 409) {
          form.setErrorMap({
            onSubmit: { fields: { username: "That username is already taken." } },
          });
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

  const form = useForm({
    defaultValues: { username: "" },
    onSubmit: async ({ value }) => {
      // The field validator below already confirmed this passes UsernameSchema;
      // parse again to send the trimmed+lowercased canonical value the API expects.
      await claim.mutateAsync(UsernameSchema.parse(value.username));
    },
  });

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
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
            noValidate
          >
            <form.Field name="username" validators={{ onSubmit: UsernameSchema }}>
              {(field) => (
                <FormTextField
                  field={field}
                  label="Username"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </form.Field>
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
