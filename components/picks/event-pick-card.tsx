"use client";

import Image from "next/image";
import { Check, CircleDot, Lock, Minus, X } from "lucide-react";

import type { OddsWithSportsbookName } from "@/data/events";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PickType } from "@/lib/db/schema/leagues";
import type { PickResult } from "@/lib/db/schema/picks";
import type { Event, Team } from "@/lib/db/schema/sports";
import { formatEasternDateTime } from "@/lib/nfl/scheduling";
import { cn } from "@/lib/utils";

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

// Border + background tint applied to the picked team row once the game
// is scored. Mirrors the result badge colors so the outcome reads at a
// glance without relying on the badge alone.
const RESULT_ROW_CLASSES: Record<PickResult, string> = {
  win: "border-emerald-500/70 bg-emerald-500/10",
  loss: "border-destructive/70 bg-destructive/10",
  push: "border-amber-500/70 bg-amber-500/10",
};

export function EventPickCard({
  event,
  homeTeam,
  awayTeam,
  odds,
  pickType,
  selectedTeamId,
  frozenSpread,
  priorFrozenSpread = null,
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
  priorFrozenSpread?: number | null;
  pickResult: PickResult | null;
  isLocked: boolean;
  onSelect?: (teamId: string) => void;
}) {
  const showScores = event.status === "in_progress" || event.status === "final";
  const showSpread = pickType === "against_the_spread";
  const interactive = !isLocked && typeof onSelect === "function";

  const spreadFor = (
    side: "home" | "away",
  ): { value: string; hint: string | null } | null => {
    if (!showSpread) return null;
    const sideTeamId = side === "home" ? homeTeam.id : awayTeam.id;
    const isPickedSide = selectedTeamId === sideTeamId;
    // When a frozen spread exists (saved pick, clean state or post-lock),
    // show it on BOTH sides — spreads are zero-sum, so the unpicked side's
    // frozen value is the negation. This avoids the visual mismatch where
    // the picked team would show -3.5 and the opponent would show the new
    // live +7 after a line move.
    if (frozenSpread != null && selectedTeamId != null) {
      const signed = isPickedSide ? frozenSpread : -frozenSpread;
      return { value: formatSpread(signed), hint: null };
    }
    const live =
      side === "home" ? (odds?.homeSpread ?? null) : (odds?.awaySpread ?? null);
    if (live == null) return null;
    // When we're rendering live on the picked side and a prior frozen spread
    // exists (user has saved picks but is currently editing), surface the
    // delta so they can see what re-submitting will change.
    const hint =
      isPickedSide && priorFrozenSpread != null && priorFrozenSpread !== live
        ? `was ${formatSpread(priorFrozenSpread)}`
        : null;
    return { value: formatSpread(live), hint };
  };

  // Pre-lock "line moved" indicator: when we're displaying the frozen
  // spread on both sides but the current live line differs, surface the
  // movement on the card itself so the user can see where the line is now.
  // Suppressed post-lock — the live line isn't relevant once the pick is
  // final.
  const pickedLiveSpread =
    !isLocked && frozenSpread != null && selectedTeamId != null
      ? selectedTeamId === homeTeam.id
        ? (odds?.homeSpread ?? null)
        : selectedTeamId === awayTeam.id
          ? (odds?.awaySpread ?? null)
          : null
      : null;
  const lineMoved =
    frozenSpread != null &&
    pickedLiveSpread != null &&
    pickedLiveSpread !== frozenSpread;

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
        {lineMoved && frozenSpread != null && pickedLiveSpread != null ? (
          <div className="px-1 pt-1 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Spread moved · {formatSpread(frozenSpread)} →{" "}
            {formatSpread(pickedLiveSpread)}
          </div>
        ) : null}
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
  spread: { value: string; hint: string | null } | null;
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
          pickResult === "win" ? (
            <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
          ) : pickResult === "loss" ? (
            <X className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          ) : pickResult === "push" ? (
            <Minus
              className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
          ) : isLocked ? (
            <Lock
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : (
            // Unscored + editable — radio-dot glyph rather than a check so
            // "selected" doesn't read as "correct" once other rows show the
            // result-colored Check.
            <CircleDot className="h-4 w-4 shrink-0 text-primary" aria-hidden />
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
          <span className="flex items-baseline gap-1 text-xs tabular-nums">
            <span className="text-muted-foreground">{spread.value}</span>
            {spread.hint ? (
              <span className="text-amber-600 dark:text-amber-400">
                ({spread.hint})
              </span>
            ) : null}
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

  const pickedClasses = pickResult
    ? RESULT_ROW_CLASSES[pickResult]
    : "border-primary bg-primary/5";
  const baseClass = cn(
    "flex items-center justify-between gap-2 rounded-md border px-3 py-2 transition-colors",
    picked ? pickedClasses : "border-transparent bg-muted/30",
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
      </div>
    );
  }
  if (event.status === "in_progress") {
    const periodLabel =
      event.period != null ? formatPeriod(event.period) : null;
    const clockLabel = event.clock || null;
    return (
      <div className="flex items-center gap-2 px-1 pt-1 text-xs uppercase tracking-wide">
        <span className="inline-flex items-center gap-1 font-semibold text-emerald-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          Live
        </span>
        {periodLabel && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-semibold text-foreground">{periodLabel}</span>
          </>
        )}
        {clockLabel && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-semibold text-foreground">{clockLabel}</span>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="px-1 pt-1 text-xs text-muted-foreground">
      {formatEasternDateTime(event.startTime)}
    </div>
  );
}

function formatSpread(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function formatPeriod(period: number): string {
  if (period <= 4) return `Q${period}`;
  if (period === 5) return "OT";
  return `OT${period - 4}`;
}

function isFinalWinner(event: Event, side: "home" | "away"): boolean {
  if (event.status !== "final") return false;
  if (event.homeScore == null || event.awayScore == null) return false;
  if (event.homeScore === event.awayScore) return false;
  return side === "home"
    ? event.homeScore > event.awayScore
    : event.awayScore > event.homeScore;
}
