import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  canPerformLeagueAction,
  LEAGUE_ACTION,
  MEMBER_ROLE,
  type LeagueAction,
  type LeagueResponse,
} from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { LeagueHeader } from "@/components/league/league-header";
import { MembersSection } from "@/components/league/members-section";
import { InvitePanel } from "@/components/league/invite-panel";
import { LeagueSettingsSection } from "@/components/league/settings-section";
import { DangerZoneSection } from "@/components/league/danger-zone";
import { leagueQueryKey } from "@/components/league/query-key";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authed/leagues/$leagueId")({
  component: LeagueHome,
});

function LeagueHome() {
  const { leagueId } = Route.useParams();

  const league = useQuery({
    queryKey: leagueQueryKey(leagueId),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/leagues/{leagueId}", {
        params: { path: { leagueId } },
      });
      if (error) {
        // 404 covers both "doesn't exist" and "not a member" — represent it
        // as "no league" rather than an error state (private leagues stay
        // hidden, mirrors join preview).
        if (response.status === 404) return null;
        throw error;
      }
      // The generated openapi types mark defaulted settings fields (e.g.
      // pushTieResolution) as optional even though the server always
      // serializes them — LeagueResponseSchema (packages/schemas) is the
      // real source of truth for the response shape.
      return data as LeagueResponse;
    },
  });

  useEffect(() => {
    if (league.isError) {
      toast.error("Couldn't load this league — please try again.");
    }
  }, [league.isError]);

  if (league.isPending) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Loading league…</p>
      </main>
    );
  }

  if (league.isError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this league.</p>
        <Button variant="outline" onClick={() => league.refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  if (!league.data) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4 sm:p-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <CardTitle>League not found</CardTitle>
            <CardDescription>
              This league doesn&apos;t exist, or you&apos;re not a member.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/"
              className={buttonVariants({ size: "lg", className: "w-full justify-center" })}
            >
              Back to dashboard
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <LeagueHomeContent league={league.data} />;
}

function LeagueHomeContent({ league }: { league: LeagueResponse }) {
  const isCommissioner = league.myRole === MEMBER_ROLE.COMMISSIONER;
  // Section visibility runs on the LEAGUE_ACTION matrix's role axis only:
  // `preStart: true` renders controls optimistically, and the server's 409
  // (league_started) enforces the window — the client never computes "now"
  // (arch D11).
  const canAct = (action: LeagueAction) =>
    canPerformLeagueAction(action, { role: league.myRole, preStart: true });

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <LeagueHeader league={league} isCommissioner={isCommissioner} />

      <Card>
        <CardHeader>
          <CardTitle>Standings</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filled per mode once picks/scoring ship (later epics) — nothing
              to compute yet. */}
          <p className="text-sm text-muted-foreground">
            Standings will appear here once picks ship.
          </p>
        </CardContent>
      </Card>

      <MembersSection league={league} isCommissioner={canAct(LEAGUE_ACTION.KICK_MEMBER)} />

      {canAct(LEAGUE_ACTION.MANAGE_INVITES) && (
        <InvitePanel leagueId={league.id} isCommissioner={isCommissioner} />
      )}

      {canAct(LEAGUE_ACTION.EDIT_SETTINGS) && <LeagueSettingsSection league={league} />}

      <DangerZoneSection league={league} isCommissioner={canAct(LEAGUE_ACTION.DELETE_LEAGUE)} />
    </main>
  );
}
