"use client";

import Image from "next/image";
import { formatInTimeZone } from "date-fns-tz";
import { Check, Lock } from "lucide-react";

import type { OddsWithSportsbookName } from "@/data/events";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PickType } from "@/lib/db/schema/leagues";
import type { PickResult } from "@/lib/db/schema/picks";
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
  selectedTeamId,
  frozenSpread,
  pickResult,
  isLocked,
  onSelect,
}: {
  event: Event;
  homeTeam: Team;
  awayTeam: Team;
  odds: OddsWithSportsbookName | null;
  pickType: PickType;
  selectedTeamId: string | null;
  frozenSpread: number | null;
  pickResult: PickResult | null;
  isLocked: boolean;
  onSelect?: (teamId: string) => void;
}) {
  const showScores = event.status === "in_progress" || event.status === "final";
  const showSpread = pickType === "against_the_spread";
  const interactive = !isLocked && typeof onSelect === "function";

  const spreadFor = (side: "home" | "away"): string | null => {
    if (!showSpread) return null;
    const sideTeamId = side === "home" ? homeTeam.id : awayTeam.id;
    const isPickedSide = selectedTeamId === sideTeamId;
    // Frozen spread only applies to the picked side; other side + unpicked
    // cards show the current live line.
    if (isPickedSide && frozenSpread != null) return formatSpread(frozenSpread);
    const live =
      side === "home" ? (odds?.homeSpread ?? null) : (odds?.awaySpread ?? null);
    if (live == null) return null;
    return formatSpread(live);
  };

  return (
    <Card size="sm" className="gap-0">
      <CardContent className="flex flex-col gap-2 px-3 py-2">
        <TeamRow
          team={awayTeam}
          score={showScores ? event.awayScore : null}
          spread={spreadFor("away")}
          picked={selectedTeamId === awayTeam.id}
          pickResult={selectedTeamId === awayTeam.id ? pickResult : null}
          isLocked={isLocked}
          isWinner={isFinalWinner(event, "away")}
          interactive={interactive}
          onClick={
            interactive && onSelect ? () => onSelect(awayTeam.id) : undefined
          }
        />
        <TeamRow
          team={homeTeam}
          score={showScores ? event.homeScore : null}
          spread={spreadFor("home")}
          picked={selectedTeamId === homeTeam.id}
          pickResult={selectedTeamId === homeTeam.id ? pickResult : null}
          isLocked={isLocked}
          isWinner={isFinalWinner(event, "home")}
          interactive={interactive}
          onClick={
            interactive && onSelect ? () => onSelect(homeTeam.id) : undefined
          }
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
  interactive,
  onClick,
}: {
  team: Team;
  score: number | null;
  spread: string | null;
  picked: boolean;
  pickResult: PickResult | null;
  isLocked: boolean;
  isWinner: boolean;
  interactive: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
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
    </>
  );

  const baseClass = cn(
    "flex items-center justify-between gap-2 rounded-md border px-3 py-2 transition-colors",
    picked ? "border-primary bg-primary/5" : "border-transparent bg-muted/30",
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={picked}
        className={cn(
          baseClass,
          "w-full text-left hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {body}
      </button>
    );
  }

  return <div className={baseClass}>{body}</div>;
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
