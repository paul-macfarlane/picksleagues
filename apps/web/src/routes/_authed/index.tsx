import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronRightIcon } from "lucide-react";
import {
  MEMBER_ROLE,
  PICKEM_PICK_STATUS,
  SURVIVOR_PICK_STATUS,
  type LeagueSummary,
  type PickemPickStatus,
  type SurvivorPickStatus,
} from "@picksleagues/schemas";
import { useMyLeagues } from "@/api/leagues";
import { formatDateTime } from "@/lib/format";
import { leagueModeLabel } from "@/lib/league";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, type StatusPillTone } from "@/components/status-pill";

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
});

function Dashboard() {
  const myLeagues = useMyLeagues();

  useEffect(() => {
    if (myLeagues.isError) {
      toast.error("Couldn't load your leagues — please try again.");
    }
  }, [myLeagues.isError]);

  if (myLeagues.isPending) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Loading your leagues…</p>
      </main>
    );
  }

  if (myLeagues.isError || !myLeagues.data) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your leagues.</p>
        <Button variant="outline" onClick={() => myLeagues.refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  const { leagues } = myLeagues.data;

  if (leagues.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4 sm:p-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <CardTitle>No leagues yet</CardTitle>
            <CardDescription>
              Create a league to start picking, or find a public one to join.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Link
              to="/leagues/new"
              className={buttonVariants({ size: "lg", className: "w-full justify-center" })}
            >
              Create a league
            </Link>
            <Link
              to="/discovery"
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "w-full justify-center",
              })}
            >
              Browse public leagues
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Your leagues</h1>
        <Link to="/leagues/new" className={buttonVariants({ size: "lg" })}>
          Create league
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {leagues.map((league) => (
          <li key={league.id}>
            <LeagueCard league={league} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function LeagueCard({ league }: { league: LeagueSummary }) {
  const glance = pickStatusGlance(league);
  return (
    <Card className="relative h-full transition-colors hover:ring-ring/50">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <Link
            to="/leagues/$leagueId"
            params={{ leagueId: league.id }}
            className="rounded-sm outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {league.name}
          </Link>
          <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </CardTitle>
        <CardDescription>{leagueModeLabel(league.mode)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {league.memberCount} member{league.memberCount === 1 ? "" : "s"}
          </span>
          {league.myRole === MEMBER_ROLE.COMMISSIONER && (
            <StatusPill tone="accent">Commissioner</StatusPill>
          )}
          {/* Renewing is commissioner-only, so the pill says whose move it is:
              an opportunity to those who can take it, status to everyone else.
              A league may have several commissioners with identical powers
              (spec §Commissioner Powers), so the member variant names the role
              rather than a person. Either way no inline action — the card
              already links into the league, where a commissioner gets the
              "Start next season" control (ADR-0009). */}
          {league.renewable &&
            (league.myRole === MEMBER_ROLE.COMMISSIONER ? (
              <StatusPill tone="highlight">New season available</StatusPill>
            ) : (
              <StatusPill tone="neutral">New season — waiting on a commissioner</StatusPill>
            ))}
        </div>
        <p>{league.startsAt ? `Starts ${formatDateTime(league.startsAt)}` : "Start date TBD"}</p>
        {glance ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={glance.tone} data-testid={glance.testId} data-status={glance.status}>
              {glance.label}
            </StatusPill>
          </div>
        ) : (
          // Both NFL modes answer now (ELM-6, PKM-10); March Madness lands in a
          // later epic, as does a league whose season holds no week to report on.
          <p className="text-xs text-muted-foreground/70">Pick status coming soon</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Which glance a card shows, if any: one per mode, so the two state sets never
 * have to be told apart by a shared label — both name a closed week, and only
 * Survivor's can say a member is out of it for good. A league of a mode with no
 * glance yet, or one whose season holds no week to report on, gets none.
 */
function pickStatusGlance(league: LeagueSummary): {
  tone: StatusPillTone;
  label: string;
  testId: string;
  // The union, not `string`: this is the one place the two state sets meet, so
  // a mode wired to the wrong label table has to be a compile error here or
  // nowhere.
  status: SurvivorPickStatus | PickemPickStatus;
} | null {
  if (league.survivorPickStatus) {
    return {
      ...SURVIVOR_GLANCE[league.survivorPickStatus],
      testId: "survivor-pick-status",
      status: league.survivorPickStatus,
    };
  }
  if (league.pickemPickStatus) {
    return {
      ...PICKEM_GLANCE[league.pickemPickStatus],
      testId: "pickem-pick-status",
      status: league.pickemPickStatus,
    };
  }
  return null;
}

/**
 * The glance's words, which are presentation and free to change; the state
 * behind each is not, and the card carries it as `data-status` so a test binds
 * to that rather than to the copy.
 *
 * "Week closed" rather than a missed-pick accusation on purpose: the state also
 * covers a week a member sat out knowingly, and only settlement gets to say
 * someone is out.
 *
 * "Winner" covers the co-winner case too. The card has no room to say how many
 * shared it and the board beside it does, so a label that hedged would cost
 * every sole winner their moment to spare a plural that is one click away.
 */
const SURVIVOR_GLANCE = {
  [SURVIVOR_PICK_STATUS.ELIMINATED]: { tone: "danger", label: "Eliminated" },
  [SURVIVOR_PICK_STATUS.WON]: { tone: "accent", label: "Winner" },
  [SURVIVOR_PICK_STATUS.PICK_IN]: { tone: "success", label: "Pick in" },
  [SURVIVOR_PICK_STATUS.PICK_NEEDED]: { tone: "highlight", label: "Pick needed" },
  [SURVIVOR_PICK_STATUS.LOCKED]: { tone: "neutral", label: "Week closed" },
} as const satisfies Record<SurvivorPickStatus, { tone: StatusPillTone; label: string }>;

/**
 * Plural throughout, because a Pick'em week is N picks in one submission
 * (ADR-0018) — "Picks in" is the whole week landing, not a pick among several
 * still to make, which is a distinction the card would otherwise leave a member
 * to guess at.
 *
 * "Season complete" is stated rather than left to the last week's state: the
 * league is over, and a card still reporting on a week nobody can act on reads
 * as a prompt.
 */
const PICKEM_GLANCE = {
  [PICKEM_PICK_STATUS.SEASON_COMPLETE]: { tone: "neutral", label: "Season complete" },
  [PICKEM_PICK_STATUS.PICKS_IN]: { tone: "success", label: "Picks in" },
  [PICKEM_PICK_STATUS.PICKS_NEEDED]: { tone: "highlight", label: "Picks needed" },
  [PICKEM_PICK_STATUS.LOCKED]: { tone: "neutral", label: "Week closed" },
} as const satisfies Record<PickemPickStatus, { tone: StatusPillTone; label: string }>;
