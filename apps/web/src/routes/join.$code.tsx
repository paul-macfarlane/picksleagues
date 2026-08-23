import type { ReactNode } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { JOIN_BLOCKED_REASON, JOIN_BLOCKED_REASON_MESSAGES } from "@picksleagues/schemas";
import { useJoinPreview } from "@/api/invites";
import { useJoinByCode } from "@/api/members";
import { authClient } from "@/lib/auth";
import { useAppNow } from "@/lib/app-clock";
import { leagueTimingLine } from "@/lib/league";
import { AppHeader } from "@/components/app-header";
import { Figures } from "@/components/figures";
import { LeagueCardStrip } from "@/components/league/league-card-strip";
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

/**
 * The page's shell (FB-44). It wears the real `AppHeader` because `beforeLoad`
 * above guarantees exactly the case `StaticPage` already gives one to: a
 * signed-in member with a claimed username. Without it the invite card was the
 * only page in the app with no way out of it but its own button.
 *
 * The card still centres in what the header leaves — this page's three states
 * are full-viewport centred cards, which is the stated deviation from the
 * QueryState rule below, and `flex-1` is what keeps that true under a header
 * instead of pushing the card off the bottom.
 */
function InvitePage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader />
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">{children}</main>
    </div>
  );
}

function JoinByCode() {
  const { code } = Route.useParams();
  const now = useAppNow();

  const preview = useJoinPreview(code);

  // A blocked join can mean the preview is stale (e.g. someone else just took
  // the last spot) — refetch so the card reflects reality.
  const join = useJoinByCode(code, async () => {
    await preview.refetch();
  });

  // Stated deviation from the QueryState rule: this page's three states are
  // centred cards rather than a page column (the invite is the whole page, not
  // a section of one), and QueryState's section-shaped pending/error/empty
  // would uncentre them — each state returns its own `InvitePage` instead.
  if (preview.isPending) {
    return (
      <InvitePage>
        <LoadingRegion label="Loading invite" className="w-full max-w-sm">
          <Skeleton className="h-56 w-full" />
        </LoadingRegion>
      </InvitePage>
    );
  }

  // Inline message + Retry, no toast: a failed view belongs in the space the
  // content would have occupied (engineering rules §Quality).

  if (preview.isError) {
    return (
      <InvitePage>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this invite.</p>
        <Button variant="outline" onClick={() => preview.refetch()}>
          Retry
        </Button>
      </InvitePage>
    );
  }

  if (!preview.data) {
    return (
      <InvitePage>
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
      </InvitePage>
    );
  }

  const { league, joinable, reason } = preview.data;

  return (
    <InvitePage>
      {/* The same league object the hub and discovery show — strip on top,
          numerals beneath — so the invite reads as the league it is for, not
          as a form about one. */}
      <Card className="w-full max-w-sm pt-0">
        <LeagueCardStrip mode={league.mode} seasonYear={league.seasonYear}>
          {league.name}
        </LeagueCardStrip>
        <CardContent className="flex flex-col gap-4">
          <Figures figures={[{ label: "Members", value: league.memberCount }]} />
          <p className="text-sm text-muted-foreground">{leagueTimingLine(league, now)}</p>

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
              {/* Already-member is good news and stays quiet; every other block
                  (full, closed, revoked, concluded) is a refusal the member
                  came here to act on, so it gets alert weight instead of
                  reading like one more detail line (FB-19). role="status" so
                  the outcome is announced, not just painted. */}
              {reason &&
                (reason === JOIN_BLOCKED_REASON.ALREADY_MEMBER ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {JOIN_BLOCKED_REASON_MESSAGES[reason]}
                  </p>
                ) : (
                  <p
                    role="status"
                    className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-center text-sm font-medium text-destructive"
                  >
                    {JOIN_BLOCKED_REASON_MESSAGES[reason]}
                  </p>
                ))}
              {/* An existing member's destination is the league the link was
                  for, not a dashboard detour (FB-8) — the join success path
                  already lands there. */}
              {reason === JOIN_BLOCKED_REASON.ALREADY_MEMBER ? (
                <Link
                  to="/leagues/$leagueId"
                  params={{ leagueId: league.id }}
                  className={buttonVariants({ size: "lg", className: "w-full justify-center" })}
                >
                  Open league
                </Link>
              ) : (
                <Link
                  to="/"
                  className={buttonVariants({ size: "lg", className: "w-full justify-center" })}
                >
                  Go to dashboard
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </InvitePage>
  );
}
