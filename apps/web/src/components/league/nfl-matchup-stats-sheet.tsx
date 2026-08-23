import { useState } from "react";
import { ChartColumnIcon } from "lucide-react";
import type {
  NflGameStatsTeamContext,
  NflGameStatsTeamRecord,
  NflInjuryReportEntry,
  SlateGame,
  SlateTeam,
} from "@picksleagues/schemas";
import { useNflGameStats } from "@/api/nfl-game-stats";
import { formatDateTime } from "@/lib/format";
import { recordLabel, streakLabel } from "@/lib/nfl-stats";
import {
  advantageOf,
  lastFiveWins,
  StatRow,
  winPct,
  type AdvantageSide,
} from "@/components/league/nfl-matchup-stat-row";
import { cn } from "@/lib/utils";
import { NflMatchupResultsBody } from "@/components/league/nfl-matchup-results";
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
 * anchor every member on ESPN's number. A third segment, **results** (STAT-9),
 * swaps the stat rows for both teams' season game logs. Everything renders
 * from ingested data with its own as-of stamps; whatever ingestion doesn't
 * have is omitted or dashed, never faked.
 */

// Pre-STAT-9 name kept on purpose: renaming the key would silently reset
// every member's stored preference for a label-only cleanup.
const SEGMENT_STORAGE_KEY = "nfl-matchup-stats-tier";

const SEGMENTS = ["basic", "advanced", "results"] as const;

type Segment = (typeof SEGMENTS)[number];

// The stats body renders only the two stat tiers; Results is its own body.
type Tier = Exclude<Segment, "results">;

// localStorage, not server state: which segment a member last used is a device
// preference, and it must survive closing the sheet without a write path.
// Guarded reads/writes — storage access throws in some private modes, and a
// stats sheet must never take the pick screen down with it.
function readStoredSegment(): Segment {
  try {
    const stored = localStorage.getItem(SEGMENT_STORAGE_KEY);
    return SEGMENTS.find((segment) => segment === stored) ?? "basic";
  } catch {
    return "basic";
  }
}

function storeSegment(segment: Segment) {
  try {
    localStorage.setItem(SEGMENT_STORAGE_KEY, segment);
  } catch {
    // Preference simply doesn't persist.
  }
}

function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[rank % 10] ?? "th";
  return `${rank}${suffix}`;
}

function differentialLabel(record: NflGameStatsTeamRecord): string | null {
  // Null at zero games like the per-game averages — a differential of "0" for
  // a team that has played nothing states a fact the data doesn't hold
  // (ADR-0040: omit, never fabricate).
  if (record.gamesPlayed === 0) return null;
  const diff = record.pointsFor - record.pointsAgainst;
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function lastFiveLabel(context: NflGameStatsTeamContext): string {
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
function isKeyInjury(entry: NflInjuryReportEntry): boolean {
  return entry.status.toLowerCase() !== "questionable";
}

function injuryLine(entry: NflInjuryReportEntry): string {
  const position = entry.position ? ` (${entry.position})` : "";
  const type = entry.injuryType ? ` — ${entry.injuryType}` : "";
  return `${entry.athleteName}${position} · ${entry.status}${type}`;
}

// "—" wherever a block or value is absent: a dash states "nothing ingested"
// where a fabricated 0 would state a fact (ADR-0040).
function stat(
  record: NflGameStatsTeamRecord | null,
  read: (record: NflGameStatsTeamRecord) => string | null,
): string {
  if (!record) return "—";
  return read(record) ?? "—";
}

function contextStat(
  context: NflGameStatsTeamContext | undefined,
  read: (context: NflGameStatsTeamContext) => string | null,
): string {
  if (!context) return "—";
  return read(context) ?? "—";
}

function InjuryList({ team, entries }: { team: SlateTeam; entries: NflInjuryReportEntry[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-foreground">{team.abbreviation}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">None reported.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {/* Index keys are safe here — the list is a served snapshot, never
              reordered client-side — where a name+status key collides the
              moment one athlete carries two same-status injuries and React
              silently drops a line from the report. */}
          {entries.map((entry, index) => (
            <li key={index} className="text-xs text-muted-foreground">
              {injuryLine(entry)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NflMatchupStatsBody({ game, tier }: { game: SlateGame; tier: Tier }) {
  const statsQuery = useNflGameStats(game.id);
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
          const columnLabel = (team: SlateTeam, record: NflGameStatsTeamRecord | null) =>
            record && !sharedSeasonYear
              ? `${team.abbreviation} (${record.seasonYear})`
              : team.abbreviation;
          // The OLDER of the two blocks' stamps: one caption dates both
          // columns, and when the per-team fallback serves different seasons
          // their rows can have been written at different instants — claiming
          // the newer one would overstate the staler column's freshness.
          const statsStamps = [home?.updatedAt, away?.updatedAt].filter(
            (stamp): stamp is string => stamp !== undefined,
          );
          const statsUpdatedAt = statsStamps.length > 0 ? statsStamps.sort()[0]! : null;
          const injuriesFor = (side: NflGameStatsTeamContext) =>
            advanced ? side.injuries : side.injuries.filter(isKeyInjury);
          // Edge marks on record-derived rows compare only within one season:
          // when the week-1 fallback serves different seasons per side, a
          // cross-season "edge" states more than the data holds — and ranks
          // are each computed against their own season's pool besides
          // (STAT-10).
          const recordEdge = (
            read: (record: NflGameStatsTeamRecord) => number | null,
            direction: "higher" | "lower" = "higher",
          ): AdvantageSide =>
            sharedSeasonYear
              ? advantageOf(away ? read(away) : null, home ? read(home) : null, direction)
              : null;

          if (!home && !away && !context) {
            return (
              <p className="py-4 text-sm text-muted-foreground">
                No stats for this matchup yet — they arrive with the next daily sync.
              </p>
            );
          }

          return (
            <div className="flex flex-col gap-4" data-testid="nfl-matchup-stats-body">
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
                    advantage={recordEdge((r) => winPct(r.wins, r.losses, r.ties))}
                  />
                  <StatRow
                    label="Streak"
                    away={stat(away, (r) => streakLabel(r.streak))}
                    home={stat(home, (r) => streakLabel(r.streak))}
                    // Zero-games guard like every other record row: streak 0
                    // means *no games*, and a dot beside a "—" would claim an
                    // edge derived from absent data (STAT-10).
                    advantage={recordEdge((r) => (r.gamesPlayed === 0 ? null : r.streak))}
                  />
                  <StatRow
                    label="Points per game"
                    away={stat(away, (r) => r.avgPointsFor?.toFixed(1) ?? null)}
                    home={stat(home, (r) => r.avgPointsFor?.toFixed(1) ?? null)}
                    advantage={recordEdge((r) => r.avgPointsFor)}
                  />
                  <StatRow
                    label="Points allowed per game"
                    away={stat(away, (r) => r.avgPointsAgainst?.toFixed(1) ?? null)}
                    home={stat(home, (r) => r.avgPointsAgainst?.toFixed(1) ?? null)}
                    advantage={recordEdge((r) => r.avgPointsAgainst, "lower")}
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
                        advantage={recordEdge((r) => r.scoringOffenseRank, "lower")}
                      />
                      <StatRow
                        label="Scoring defense"
                        away={stat(away, (r) =>
                          r.scoringDefenseRank ? ordinal(r.scoringDefenseRank) : null,
                        )}
                        home={stat(home, (r) =>
                          r.scoringDefenseRank ? ordinal(r.scoringDefenseRank) : null,
                        )}
                        advantage={recordEdge((r) => r.scoringDefenseRank, "lower")}
                      />
                      <StatRow
                        label="Home record"
                        away={stat(away, (r) => recordLabel(r.homeWins, r.homeLosses, r.homeTies))}
                        home={stat(home, (r) => recordLabel(r.homeWins, r.homeLosses, r.homeTies))}
                        advantage={recordEdge((r) => winPct(r.homeWins, r.homeLosses, r.homeTies))}
                      />
                      <StatRow
                        label="Road record"
                        away={stat(away, (r) => recordLabel(r.roadWins, r.roadLosses, r.roadTies))}
                        home={stat(home, (r) => recordLabel(r.roadWins, r.roadLosses, r.roadTies))}
                        advantage={recordEdge((r) => winPct(r.roadWins, r.roadLosses, r.roadTies))}
                      />
                      <StatRow
                        label="Point differential"
                        away={stat(away, differentialLabel)}
                        home={stat(home, differentialLabel)}
                        advantage={recordEdge((r) =>
                          r.gamesPlayed === 0 ? null : r.pointsFor - r.pointsAgainst,
                        )}
                      />
                      <StatRow
                        label="Last 5"
                        subLabel="most recent first"
                        away={contextStat(context?.away, lastFiveLabel)}
                        home={contextStat(context?.home, lastFiveLabel)}
                        // Comparable only at equal list lengths: 2-0 from two
                        // games isn't beaten by 3-2 from five, so unequal
                        // samples get no mark rather than a win-count race.
                        advantage={
                          context && context.away.lastFive.length === context.home.lastFive.length
                            ? advantageOf(lastFiveWins(context.away), lastFiveWins(context.home))
                            : null
                        }
                      />
                      {/* ATS stays unmarked on purpose: it's a provider string
                          we don't parse, and "better against the spread" is a
                          judgment the sheet shouldn't render as fact (STAT-10). */}
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
                        advantage={advantageOf(context?.away.fpiWinPct, context?.home.fpiWinPct)}
                      />
                    </>
                  )}
                </div>

                {(home || away) && (
                  <p className="text-[10px] text-muted-foreground/70">
                    <span
                      aria-hidden="true"
                      className="mr-1 inline-block size-1.5 rounded-full bg-foreground"
                    />
                    marks the side with the edge in a category.
                  </p>
                )}
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
export function NflMatchupStats({ game }: { game: SlateGame }) {
  const [open, setOpen] = useState(false);
  const [segment, setSegment] = useState<Segment>(readStoredSegment);
  const matchupName = `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`;

  const selectSegment = (next: Segment) => {
    setSegment(next);
    storeSegment(next);
  };

  const onOpenChange = (nextOpen: boolean) => {
    // Re-seed from storage on every open: each game row mounts its own
    // instance at page render, so without this a toggle in one game's sheet
    // wouldn't reach its siblings until a full remount — a persisted
    // preference that randomly doesn't stick.
    if (nextOpen) setSegment(readStoredSegment());
    setOpen(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Visible "Stats" label, not an icon alone (owner, 2026-08-13): the
          sheet is a feature nobody has seen yet, and an unlabelled glyph asks
          members to guess it exists. The aria-label still carries the matchup
          so screen readers hear which game's stats this opens. */}
      <SheetTrigger
        render={
          <Button
            type="button"
            // `outline`, the league surfaces' small-secondary-action idiom
            // (members-section, invite-panel) — the one ghost Button here was
            // the inconsistency, and a border is the tap affordance hover
            // can't provide on touch (owner, 2026-08-13).
            variant="outline"
            size="sm"
            aria-label={`Matchup stats: ${matchupName}`}
            data-testid="nfl-matchup-stats-trigger"
            className="text-muted-foreground hover:text-foreground"
          />
        }
      >
        <ChartColumnIcon aria-hidden="true" className="size-3.5" />
        Stats
      </SheetTrigger>
      <SheetContent
        side="bottom"
        closeLabel="Close matchup stats"
        data-testid="nfl-matchup-stats-sheet"
      >
        <SheetHeader>
          <SheetTitle>{matchupName}</SheetTitle>
        </SheetHeader>

        {/* Segmented control — aria-pressed carries the state, and the
            label never changes width (engineering rules §async buttons apply
            the same cursor-stability logic to any toggle set). */}
        <div
          className="flex gap-1 self-start rounded-lg bg-muted p-1"
          role="group"
          aria-label="Matchup view"
        >
          {SEGMENTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={segment === option}
              onClick={() => selectSegment(option)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                segment === option
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option}
            </button>
          ))}
        </div>

        {/* The scroll region lives here, not on the popup, so the close
            button and the header/toggle stay visible however long the
            advanced tier gets (see SHEET_SIDE_CLASS_NAME's bottom entry). */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {open &&
            (segment === "results" ? (
              <NflMatchupResultsBody game={game} />
            ) : (
              <NflMatchupStatsBody game={game} tier={segment} />
            ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
