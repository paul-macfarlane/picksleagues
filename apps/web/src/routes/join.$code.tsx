import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { JOIN_BLOCKED_REASON, JOIN_BLOCKED_REASON_MESSAGES } from "@picksleagues/schemas";
import { useJoinPreview } from "@/api/invites";
import { useJoinByCode } from "@/api/members";
import { authClient } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { leagueModeLabel } from "@/lib/league";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingRegion } from "@/components/loading";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Top-level (not under _authed): mirrors claim-username.tsx — the invite
 * round-trip owns its own redirect state so sign-in/claim can return here
 * (mvp-spec §Invites: "Visiting a link while signed out routes through
 * sign-in and back"; lib/redirect.ts names this route as the consumer).
 */
export const Route = createFileRoute("/join/$code")({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
    if (!session.user.username) {
      throw redirect({ to: "/claim-username", search: { redirect: location.href } });
    }
  },
  component: JoinByCode,
});

function JoinByCode() {
  const { code } = Route.useParams();

  const preview = useJoinPreview(code);

  // A blocked join can mean the preview is stale (e.g. someone else just took
  // the last spot) — refetch so the card reflects reality.
  const join = useJoinByCode(code, async () => {
    await preview.refetch();
  });

  if (preview.isPending) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6">
        <LoadingRegion label="Loading invite" className="w-full max-w-sm">
          <Skeleton className="h-56 w-full" />
        </LoadingRegion>
      </main>
    );
  }

  // Inline message + Retry, no toast: a failed view belongs in the space the
  // content would have occupied (engineering rules §Quality).

  if (preview.isError) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this invite.</p>
        <Button variant="outline" onClick={() => preview.refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  if (!preview.data) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <CardTitle>Invite not found</CardTitle>
            <CardDescription>This invite link isn&apos;t valid.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/"
              className={buttonVariants({ size: "lg", className: "w-full justify-center" })}
            >
              Go home
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { league, joinable, reason } = preview.data;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <CardTitle>{league.name}</CardTitle>
          <CardDescription>{leagueModeLabel(league.mode)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="flex flex-col gap-1 text-sm text-muted-foreground">
            <div className="flex justify-between gap-2">
              <dt>Season</dt>
              <dd>{league.seasonYear}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Members</dt>
              <dd>{league.memberCount}</dd>
            </div>
            {league.startsAt && (
              <div className="flex justify-between gap-2">
                <dt>Starts</dt>
                <dd>{formatDateTime(league.startsAt)}</dd>
              </div>
            )}
          </dl>

          {joinable ? (
            <Button
              size="lg"
              className="w-full justify-center"
              disabled={join.isPending}
              onClick={() => join.mutate()}
            >
              {join.isPending ? "Joining…" : "Join league"}
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              {reason && (
                <p className="text-sm text-muted-foreground">
                  {JOIN_BLOCKED_REASON_MESSAGES[reason]}
                </p>
              )}
              <Link
                to="/"
                className={buttonVariants({ size: "lg", className: "w-full justify-center" })}
              >
                {reason === JOIN_BLOCKED_REASON.ALREADY_MEMBER
                  ? "Open dashboard"
                  : "Go to dashboard"}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
