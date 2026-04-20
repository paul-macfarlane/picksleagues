import { ChevronDown } from "lucide-react";

import { EventPickCard } from "@/components/picks/event-pick-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { OddsWithSportsbookName } from "@/data/events";
import type { EventWithTeams } from "@/data/events";
import type { LeagueStandingWithProfile } from "@/data/standings";
import type { PickType } from "@/lib/db/schema/leagues";
import type { Pick } from "@/lib/db/schema/picks";
import { formatPoints, type WeeklyStanding } from "@/lib/nfl/scoring";
import { getInitials } from "@/lib/utils";

export function MemberPicksCard({
  standing,
  weekly,
  picks,
  events,
  oddsByEventId,
  pickType,
  isViewer,
  defaultOpen,
}: {
  standing: LeagueStandingWithProfile;
  weekly: WeeklyStanding | null;
  picks: Pick[];
  events: EventWithTeams[];
  oddsByEventId: Map<string, OddsWithSportsbookName>;
  pickType: PickType;
  isViewer: boolean;
  defaultOpen: boolean;
}) {
  const pickByEventId = new Map(picks.map((p) => [p.eventId, p]));
  // Only show games this member actually picked — the other events on the
  // phase are noise once picks are locked. Same rationale as the My Picks
  // filter.
  const pickedEvents = events.filter((e) => pickByEventId.has(e.id));

  return (
    <details
      className="group rounded-lg border border-border bg-card"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <Avatar size="sm">
          {standing.profile.avatarUrl ? (
            <AvatarImage src={standing.profile.avatarUrl} alt="" />
          ) : null}
          <AvatarFallback>{getInitials(standing.profile.name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {standing.profile.name}
            {isViewer ? " (you)" : ""}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            @{standing.profile.username}
          </span>
        </div>
        <div className="flex flex-col items-end text-right">
          {weekly ? (
            <span className="text-base font-semibold tabular-nums">
              {weekly.wins}-{weekly.losses}-{weekly.pushes}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                wk · {formatPoints(weekly.points)}
              </span>
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground tabular-nums">
            {standing.wins}-{standing.losses}-{standing.pushes} overall ·{" "}
            {formatPoints(standing.points)}
          </span>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t p-3">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No games this phase.</p>
        ) : pickedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No picks submitted for this week.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pickedEvents.map((event) => {
              const pick = pickByEventId.get(event.id) ?? null;
              return (
                <li key={event.id}>
                  <EventPickCard
                    event={event}
                    homeTeam={event.homeTeam}
                    awayTeam={event.awayTeam}
                    odds={oddsByEventId.get(event.id) ?? null}
                    pickType={pickType}
                    selectedTeamId={pick?.teamId ?? null}
                    frozenSpread={pick?.spreadAtLock ?? null}
                    pickResult={pick?.pickResult ?? null}
                    isLocked
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
