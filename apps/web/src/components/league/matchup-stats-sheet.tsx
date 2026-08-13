import { useState } from "react";
import { ChartColumnIcon } from "lucide-react";
import type {
  GameStatsTeamContext,
  GameStatsTeamRecord,
  InjuryReportEntry,
  SlateGame,
  SlateTeam,
} from "@picksleagues/schemas";
import { useGameStats } from "@/api/game-stats";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LoadingRegion } from "@/components/loading";
import { QueryState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The matchup stats sheet (STAT-6, ADR-0040; spec §Screens "Matchup stats
 * sheet"): every NFL game row opens it, both modes and the read-only slate
 * preview alike. Two tiers, and the tier is the product contract, not polish:
 * **basic** (default) is record, streak, points per game, and key injuries;
 * **advanced** — one explicit toggle away — adds ranks, splits, differential,
 * form, ATS, the full injury report, and ESPN FPI, the sheet's one
 * *prediction*, which stays out of the default surface so the app doesn't
 * anchor every member on ESPN's number. Everything renders from ingested
 * data with its own as-of stamps; whatever ingestion doesn't have is omitted
 * or dashed, never faked.
 */

const TIER_STORAGE_KEY = "matchup-stats-tier";

type Tier = "basic" | "advanced";

// localStorage, not server state: which tier a member last used is a device
// preference, and it must survive closing the sheet without a write path.
// Guarded reads/writes — storage access throws in some private modes, and a
// stats sheet must never take the pick screen down with it.
function readStoredTier(): Tier {
  try {
    return localStorage.getItem(TIER_STORAGE_KEY) === "advanced" ? "advanced" : "basic";
  } catch {
    return "basic";
  }
}

function storeTier(tier: Tier) {
  try {
    localStorage.setItem(TIER_STORAGE_KEY, tier);
  } catch {
    // Preference simply doesn't persist.
  }
}

function recordLabel(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function streakLabel(streak: number): string {
  if (streak === 0) return "—";
  return streak > 0 ? `W${streak}` : `L${-streak}`;
}

function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[rank % 10] ?? "th";
  return `${rank}${suffix}`;
}

function differentialLabel(record: GameStatsTeamRecord): string {
  const diff = record.pointsFor - record.pointsAgainst;
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function lastFiveLabel(context: GameStatsTeamContext): string {
  if (context.lastFive.length === 0) return "—";
  // Newest first, as served — "W-W-L" reads left-to-right as "most recent
  // game first", matching how streaks are talked about.
  return context.lastFive.map((game) => game.result).join("-");
}

/**
 * The basic tier's injury filter: anything that isn't "Questionable" is a key
 * injury. Deliberately inverted from a status allowlist so an unknown status
 * ESPN mints tomorrow over-warns (shows in basic) rather than hiding an Out.
 */
function isKeyInjury(entry: InjuryReportEntry): boolean {
  return entry.status.toLowerCase() !== "questionable";
}

function injuryLine(entry: InjuryReportEntry): string {
  const position = entry.position ? ` (${entry.position})` : "";
  const type = entry.injuryType ? ` — ${entry.injuryType}` : "";
  return `${entry.athleteName}${position} · ${entry.status}${type}`;
}

/** One "away value | label | home value" line of the stat grid. */
function StatRow({
  label,
  away,
  home,
  subLabel,
}: {
  label: string;
  away: string;
  home: string;
  subLabel?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5">
      <span className="text-sm font-medium tabular-nums">{away}</span>
      <span className="text-center text-xs text-muted-foreground">
        {label}
        {subLabel && <span className="block text-[10px] text-muted-foreground/70">{subLabel}</span>}
      </span>
      <span className="text-right text-sm font-medium tabular-nums">{home}</span>
    </div>
  );
}

// "—" wherever a block or value is absent: a dash states "nothing ingested"
// where a fabricated 0 would state a fact (ADR-0040).
function stat(
  record: GameStatsTeamRecord | null,
  read: (record: GameStatsTeamRecord) => string | null,
): string {
  if (!record) return "—";
  return read(record) ?? "—";
}

function contextStat(
  context: GameStatsTeamContext | undefined,
  read: (context: GameStatsTeamContext) => string | null,
): string {
  if (!context) return "—";
  return read(context) ?? "—";
}

function InjuryList({ team, entries }: { team: SlateTeam; entries: InjuryReportEntry[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-foreground">{team.abbreviation}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">None reported.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {entries.map((entry) => (
            <li
              key={`${entry.athleteName}-${entry.status}`}
              className="text-xs text-muted-foreground"
            >
              {injuryLine(entry)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MatchupStatsBody({ game, tier }: { game: SlateGame; tier: Tier }) {
  const statsQuery = useGameStats(game.id);
  const advanced = tier === "advanced";

  return (
    <QueryState
      isPending={statsQuery.isPending}
      pendingFallback={
        <LoadingRegion label="Loading matchup stats" className="flex flex-col gap-2">
          {Array.from({ length: advanced ? 8 : 5 }, (_unused, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </LoadingRegion>
      }
      isError={statsQuery.isError}
      onRetry={() => void statsQuery.refetch()}
      errorMessage="Couldn't load matchup stats."
    >
      {statsQuery.data &&
        (() => {
          const { home, away, context } = statsQuery.data;
          // Each block names the season its numbers describe (the week-1
          // fallback serves last season's, ADR-0040) — one caption when the
          // sides agree, per-column years in the header when they don't.
          const sharedSeasonYear = home && away && home.seasonYear === away.seasonYear;
          const columnLabel = (team: SlateTeam, record: GameStatsTeamRecord | null) =>
            record && !sharedSeasonYear
              ? `${team.abbreviation} (${record.seasonYear})`
              : team.abbreviation;
          const statsUpdatedAt = home?.updatedAt ?? away?.updatedAt ?? null;
          const injuriesFor = (side: GameStatsTeamContext) =>
            advanced ? side.injuries : side.injuries.filter(isKeyInjury);

          if (!home && !away && !context) {
            return (
              <p className="py-4 text-sm text-muted-foreground">
                No stats for this matchup yet — they arrive with the next daily sync.
              </p>
            );
          }

          return (
            <div className="flex flex-col gap-4" data-testid="matchup-stats-body">
              <div className="flex flex-col gap-1">
                {(home || away) && (
                  <p className="text-xs text-muted-foreground">
                    {sharedSeasonYear && home ? `${home.seasonYear} season stats` : "Season stats"}
                    {statsUpdatedAt && ` · updated ${formatDateTime(statsUpdatedAt)}`}
                  </p>
                )}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border pb-2">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <TeamLogo
                      logoLightUrl={game.awayTeam.logoLightUrl}
                      logoDarkUrl={game.awayTeam.logoDarkUrl}
                      size="sm"
                    />
                    {columnLabel(game.awayTeam, away)}
                  </span>
                  <span className="text-xs text-muted-foreground">@</span>
                  <span className="flex items-center justify-end gap-1.5 text-right text-sm font-semibold">
                    {columnLabel(game.homeTeam, home)}
                    <TeamLogo
                      logoLightUrl={game.homeTeam.logoLightUrl}
                      logoDarkUrl={game.homeTeam.logoDarkUrl}
                      size="sm"
                    />
                  </span>
                </div>

                <div className="flex flex-col divide-y divide-border/60">
                  <StatRow
                    label="Record"
                    away={stat(away, (r) => recordLabel(r.wins, r.losses, r.ties))}
                    home={stat(home, (r) => recordLabel(r.wins, r.losses, r.ties))}
                  />
                  <StatRow
                    label="Streak"
                    away={stat(away, (r) => streakLabel(r.streak))}
                    home={stat(home, (r) => streakLabel(r.streak))}
                  />
                  <StatRow
                    label="Points per game"
                    away={stat(away, (r) => r.avgPointsFor?.toFixed(1) ?? null)}
                    home={stat(home, (r) => r.avgPointsFor?.toFixed(1) ?? null)}
                  />
                  <StatRow
                    label="Points allowed per game"
                    away={stat(away, (r) => r.avgPointsAgainst?.toFixed(1) ?? null)}
                    home={stat(home, (r) => r.avgPointsAgainst?.toFixed(1) ?? null)}
                  />
                  {advanced && (
                    <>
                      <StatRow
                        label="Scoring offense"
                        away={stat(away, (r) =>
                          r.scoringOffenseRank ? ordinal(r.scoringOffenseRank) : null,
                        )}
                        home={stat(home, (r) =>
                          r.scoringOffenseRank ? ordinal(r.scoringOffenseRank) : null,
                        )}
                      />
                      <StatRow
                        label="Scoring defense"
                        away={stat(away, (r) =>
                          r.scoringDefenseRank ? ordinal(r.scoringDefenseRank) : null,
                        )}
                        home={stat(home, (r) =>
                          r.scoringDefenseRank ? ordinal(r.scoringDefenseRank) : null,
                        )}
                      />
                      <StatRow
                        label="Home record"
                        away={stat(away, (r) => recordLabel(r.homeWins, r.homeLosses, r.homeTies))}
                        home={stat(home, (r) => recordLabel(r.homeWins, r.homeLosses, r.homeTies))}
                      />
                      <StatRow
                        label="Road record"
                        away={stat(away, (r) => recordLabel(r.roadWins, r.roadLosses, r.roadTies))}
                        home={stat(home, (r) => recordLabel(r.roadWins, r.roadLosses, r.roadTies))}
                      />
                      <StatRow
                        label="Point differential"
                        away={stat(away, differentialLabel)}
                        home={stat(home, differentialLabel)}
                      />
                      <StatRow
                        label="Last 5"
                        subLabel="most recent first"
                        away={contextStat(context?.away, lastFiveLabel)}
                        home={contextStat(context?.home, lastFiveLabel)}
                      />
                      <StatRow
                        label="Against the spread"
                        away={contextStat(context?.away, (c) => c.atsSummary)}
                        home={contextStat(context?.home, (c) => c.atsSummary)}
                      />
                      <StatRow
                        label="Win probability"
                        subLabel="ESPN FPI"
                        away={contextStat(context?.away, (c) =>
                          c.fpiWinPct !== null ? `${c.fpiWinPct.toFixed(1)}%` : null,
                        )}
                        home={contextStat(context?.home, (c) =>
                          c.fpiWinPct !== null ? `${c.fpiWinPct.toFixed(1)}%` : null,
                        )}
                      />
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-foreground">
                  {advanced ? "Injury report" : "Key injuries"}
                </p>
                {context ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <InjuryList team={game.awayTeam} entries={injuriesFor(context.away)} />
                      <InjuryList team={game.homeTeam} entries={injuriesFor(context.home)} />
                    </div>
                    <p className="text-[10px] text-muted-foreground/70">
                      Injury and matchup data updated {formatDateTime(context.updatedAt)}.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Injury and matchup data haven't synced for this game yet.
                  </p>
                )}
              </div>
            </div>
          );
        })()}
    </QueryState>
  );
}

/**
 * Trigger + sheet, self-contained so a game row adds matchup stats with one
 * element. The query is keyed off `open`, so a 16-game slate fetches only the
 * matchups a member actually opens.
 */
export function MatchupStats({ game }: { game: SlateGame }) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<Tier>(readStoredTier);
  const matchupName = `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`;

  const selectTier = (next: Tier) => {
    setTier(next);
    storeTier(next);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Matchup stats: ${matchupName}`}
            data-testid="matchup-stats-trigger"
            className="size-7 text-muted-foreground hover:text-foreground"
          />
        }
      >
        <ChartColumnIcon aria-hidden="true" className="size-4" />
      </SheetTrigger>
      <SheetContent
        side="bottom"
        closeLabel="Close matchup stats"
        data-testid="matchup-stats-sheet"
      >
        <SheetHeader>
          <SheetTitle>{matchupName}</SheetTitle>
        </SheetHeader>

        {/* Segmented tier toggle — aria-pressed carries the state, and the
            label never changes width (engineering rules §async buttons apply
            the same cursor-stability logic to any toggle pair). */}
        <div
          className="flex gap-1 self-start rounded-lg bg-muted p-1"
          role="group"
          aria-label="Stats detail level"
        >
          {(["basic", "advanced"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={tier === option}
              onClick={() => selectTier(option)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                tier === option
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option}
            </button>
          ))}
        </div>

        {open && <MatchupStatsBody game={game} tier={tier} />}
      </SheetContent>
    </Sheet>
  );
}
