import Image from "next/image";
import { formatInTimeZone } from "date-fns-tz";
import { Check, Lock } from "lucide-react";

import type { OddsWithSportsbookName } from "@/data/events";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PickType } from "@/lib/db/schema/leagues";
import type { Pick as UserPick, PickResult } from "@/lib/db/schema/picks";
import type { Event, Team } from "@/lib/db/schema/sports";
import { cn } from "@/lib/utils";

const DISPLAY_TIME_ZONE = "America/New_York";

const RESULT_LABELS: Record<PickResult, string> = {
  win: "Win",
  loss: "Loss",
  push: "Push",
};

const RESULT_CLASSES: Record<PickResult, string> = {
  win: "bg-emerald-500/15 text-emerald-500",
  loss: "bg-destructive/15 text-destructive",
  push: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

export function EventPickCard({
  event,
  homeTeam,
  awayTeam,
  odds,
  pickType,
  pick,
  isLocked,
}: {
  event: Event;
  homeTeam: Team;
  awayTeam: Team;
  odds: OddsWithSportsbookName | null;
  pickType: PickType;
  pick: UserPick | null;
  isLocked: boolean;
}) {
  const showScores = event.status === "in_progress" || event.status === "final";
  const showSpread = pickType === "against_the_spread";
  const displaySpread = (side: "home" | "away"): string | null => {
    if (!showSpread) return null;
    // Prefer the spread frozen on the pick for the picked side, otherwise
    // show the current live spread.
    const picked =
      pick && pick.teamId === (side === "home" ? homeTeam.id : awayTeam.id);
    const frozen =
      picked && pick?.spreadAtLock != null ? pick.spreadAtLock : null;
    const live =
      side === "home" ? (odds?.homeSpread ?? null) : (odds?.awaySpread ?? null);
    const value = frozen ?? live;
    if (value == null) return null;
    return formatSpread(value);
  };

  return (
    <Card size="sm" className="gap-0">
      <CardContent className="flex flex-col gap-2 px-3 py-2">
        <TeamRow
          team={awayTeam}
          score={showScores ? event.awayScore : null}
          spread={displaySpread("away")}
          picked={pick?.teamId === awayTeam.id}
          pickResult={
            pick?.teamId === awayTeam.id ? (pick?.pickResult ?? null) : null
          }
          isLocked={isLocked}
          isWinner={isFinalWinner(event, "away")}
        />
        <TeamRow
          team={homeTeam}
          score={showScores ? event.homeScore : null}
          spread={displaySpread("home")}
          picked={pick?.teamId === homeTeam.id}
          pickResult={
            pick?.teamId === homeTeam.id ? (pick?.pickResult ?? null) : null
          }
          isLocked={isLocked}
          isWinner={isFinalWinner(event, "home")}
        />
        <EventStatusLine event={event} />
        {showSpread && odds ? (
          <div className="px-1 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Odds by {odds.sportsbookName}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TeamRow({
  team,
  score,
  spread,
  picked,
  pickResult,
  isLocked,
  isWinner,
}: {
  team: Team;
  score: number | null;
  spread: string | null;
  picked: boolean;
  pickResult: PickResult | null;
  isLocked: boolean;
  isWinner: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border px-3 py-2 transition-colors",
        picked
          ? "border-primary bg-primary/5"
          : "border-transparent bg-muted/30",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {picked ? (
          isLocked ? (
            <Lock
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : (
            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          )
        ) : null}
        <TeamLogo team={team} />
        <span
          className={cn(
            "truncate text-sm font-medium",
            !isWinner && score != null && score > 0 && "text-muted-foreground",
          )}
        >
          {team.location} {team.name}
        </span>
        {spread ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {spread}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {pickResult ? (
          <Badge
            variant="secondary"
            className={cn("px-2 py-0 text-xs", RESULT_CLASSES[pickResult])}
          >
            {RESULT_LABELS[pickResult]}
          </Badge>
        ) : null}
        {score != null ? (
          <span className="w-8 text-right text-base font-semibold tabular-nums">
            {score}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TeamLogo({ team }: { team: Team }) {
  if (!team.logoUrl) {
    return (
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
        {team.abbreviation}
      </span>
    );
  }
  return (
    <Image
      src={team.logoUrl}
      alt=""
      width={24}
      height={24}
      className="h-6 w-6 shrink-0 object-contain"
      unoptimized
    />
  );
}

function EventStatusLine({ event }: { event: Event }) {
  if (event.status === "final") {
    return (
      <div className="flex items-center gap-2 px-1 pt-1 text-xs uppercase tracking-wide text-muted-foreground">
        <span className="font-semibold text-foreground">Final</span>
        <span>·</span>
        <span>{formatDateTime(event.startTime)}</span>
      </div>
    );
  }
  if (event.status === "in_progress") {
    return (
      <div className="flex items-center gap-2 px-1 pt-1 text-xs uppercase tracking-wide">
        <span className="inline-flex items-center gap-1 font-semibold text-emerald-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          Live
        </span>
      </div>
    );
  }
  return (
    <div className="px-1 pt-1 text-xs text-muted-foreground">
      {formatDateTime(event.startTime)}
    </div>
  );
}

function formatSpread(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function formatDateTime(date: Date): string {
  return formatInTimeZone(date, DISPLAY_TIME_ZONE, "EEE MMM d, h:mm a 'ET'");
}

function isFinalWinner(event: Event, side: "home" | "away"): boolean {
  if (event.status !== "final") return false;
  if (event.homeScore == null || event.awayScore == null) return false;
  if (event.homeScore === event.awayScore) return false;
  return side === "home"
    ? event.homeScore > event.awayScore
    : event.awayScore > event.homeScore;
}
