import { createFileRoute, Link } from "@tanstack/react-router";
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
import { useAppNow } from "@/lib/app-clock";
import { leagueTimingLine } from "@/lib/league";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CardGridSkeleton } from "@/components/loading";
import { LeagueCardStrip } from "@/components/league/league-card-strip";
import { LeagueStanding } from "@/components/league/league-standing";
import { QueryState } from "@/components/query-state";
import { StatusPill, type StatusPillTone } from "@/components/status-pill";

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
});

/**
 * Both ways into a league sit together (FB-40, owner's call): creating one and
 * finding one are the same job with two answers, and separating them left
 * joining reachable only from a header word most members never read — nearly
 * everyone arrives by invite link, so browsing is the rare path that has to be
 * findable exactly where a member notices they have nowhere to play.
 */
function DashboardHeader() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl text-foreground">Your leagues</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/discovery" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Browse public leagues
        </Link>
        <Link to="/leagues/new" className={buttonVariants({ size: "lg" })}>
          Create league
        </Link>
      </div>
    </div>
  );
}

function Dashboard() {
  const myLeagues = useMyLeagues();
  const leagues = myLeagues.data?.leagues ?? [];

  // The no-leagues state is a designed call-to-action card, not QueryState's
  // one-line emptyMessage — so it lives in children and isEmpty stays unset.
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <QueryState
        isPending={myLeagues.isPending}
        pendingFallback={
          <>
            <DashboardHeader />
            <CardGridSkeleton label="Loading your leagues" />
          </>
        }
        isError={myLeagues.isError}
        onRetry={() => void myLeagues.refetch()}
        errorMessage="Couldn't load your leagues."
      >
        {leagues.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
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
          </div>
        ) : (
          <>
            <DashboardHeader />
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {leagues.map((league) => (
                <li key={league.id}>
                  <LeagueCard league={league} />
                </li>
              ))}
            </ul>
          </>
        )}
      </QueryState>
    </main>
  );
}

/**
 * A league as an object in the member's list: the band strip names it, the
 * body says where the viewer stands and what the week wants of them. The whole
 * card is the link (the name's `after:absolute` overlay), which is why the strip
 * carries no link styling of its own.
 */
function LeagueCard({ league }: { league: LeagueSummary }) {
  const glance = pickStatusGlance(league);
  const now = useAppNow();
  return (
    <Card className="relative h-full pt-0 transition-shadow hover:ring-ring/50">
      <LeagueCardStrip mode={league.mode} seasonYear={league.seasonYear}>
        <Link
          to="/leagues/$leagueId"
          params={{ leagueId: league.id }}
          className="rounded-sm outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {league.name}
        </Link>
      </LeagueCardStrip>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <LeagueStanding league={league} now={now} numeralClassName="text-2xl" />
          <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {glance ? (
            <StatusPill tone={glance.tone} data-testid={glance.testId} data-status={glance.status}>
              {glance.label}
            </StatusPill>
          ) : (
            // Both NFL modes answer now (ELM-6, PKM-10); March Madness lands in a
            // later epic, as does a league whose season holds no week to report on.
            <span className="text-xs text-muted-foreground/70">Pick status coming soon</span>
          )}
          <span>{leagueTimingLine(league, now)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {league.myRole === MEMBER_ROLE.COMMISSIONER && (
            <StatusPill tone="strong">Commissioner</StatusPill>
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
  [SURVIVOR_PICK_STATUS.WON]: { tone: "success", label: "Winner" },
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
