import { eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueSeasons, leagues } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import { LEAGUE_MODE, LEAGUE_STATUS, type LeagueMode } from "@picksleagues/schemas";
import { logError } from "../lib/logger";
import { rebuildPickemLeagueSeason, settlePickemPicksForGames } from "./pickem/settlement";
import { rebuildSurvivorLeagueSeason, settleSurvivorPicksForGames } from "./survivor/settlement";

/**
 * The mode-agnostic settlement surface (arch §Settlement & Scoring). Every
 * caller — the nightly sweep, both ingestion jobs, the admin rebuild, and the
 * simulator — comes through here and never through a mode's own module, so
 * adding a mode is a row in the tables below rather than an edit at six call
 * sites.
 *
 * What each mode *does* with a league season is entirely its own (ADR-0016 —
 * per-mode result tables): Pick'em grades pick by pick and rebuilds a ranked
 * board, Survivor replays whole weeks in prefix order against a threaded
 * alive-set (ADR-0025). Nothing about either shape leaks into this file; what
 * is shared is the counters they report and the three questions the product
 * asks of settlement.
 */

/**
 * Counters for the job envelope's `details`. A type alias rather than an
 * interface on purpose — only aliases get the implicit index signature that
 * makes them assignable to the runner's `Record<string, string|number|boolean>`.
 *
 * Mirrored on the wire by `SimSettlementSummarySchema` (packages/schemas), so a
 * field added here is an OpenAPI change.
 */
export type SettlementSummary = {
  leagueSeasons: number;
  weeks: number;
  results: number;
  /** Picks whose game hasn't reached a terminal state, or that can't be graded. */
  unsettled: number;
  /** League seasons whose settlement threw — see the `settle-sweep.season-failed` logs. */
  failed: number;
};

export const EMPTY_SUMMARY: SettlementSummary = {
  leagueSeasons: 0,
  weeks: 0,
  results: 0,
  unsettled: 0,
  failed: 0,
};

export function addSummary(total: SettlementSummary, next: SettlementSummary): SettlementSummary {
  return {
    leagueSeasons: total.leagueSeasons + next.leagueSeasons,
    weeks: total.weeks + next.weeks,
    results: total.results + next.results,
    unsettled: total.unsettled + next.unsettled,
    failed: total.failed + next.failed,
  };
}

type LeagueSeasonRebuild = (
  db: Db,
  clock: Clock,
  leagueSeasonId: string,
  audit?: { adminUserId: string },
) => Promise<SettlementSummary>;

type GameSettler = (db: Db, clock: Clock, gameIds: readonly string[]) => Promise<SettlementSummary>;

/**
 * The dispatch tables. `satisfies Record<LeagueMode, …>` is what makes a new
 * mode a compile error here rather than a league that silently never settles;
 * `null` is the explicit "no settlement module yet", which is not the same
 * claim as a missing key.
 *
 * **Every entry must stay a `function` declaration in its own module.** Each
 * per-mode module imports `EMPTY_SUMMARY`/`addSummary` back from this one, so
 * the two are a cycle: whichever side loads first sees the other half-built.
 * Function declarations are initialized before either body runs, so these
 * bindings are live here; a `const fn = async () => {}` on the other side would
 * be in its temporal dead zone at this line and throw at import time, before a
 * single request.
 */
const REBUILD_BY_MODE = {
  [LEAGUE_MODE.PICKEM]: rebuildPickemLeagueSeason,
  [LEAGUE_MODE.SURVIVOR]: rebuildSurvivorLeagueSeason,
  // MM-6: a bracket scores per entry against a tournament, not per league-week.
  [LEAGUE_MODE.MARCH_MADNESS]: null,
} as const satisfies Record<LeagueMode, LeagueSeasonRebuild | null>;

const SETTLE_GAMES_BY_MODE = {
  [LEAGUE_MODE.PICKEM]: settlePickemPicksForGames,
  [LEAGUE_MODE.SURVIVOR]: settleSurvivorPicksForGames,
  [LEAGUE_MODE.MARCH_MADNESS]: null,
} as const satisfies Record<LeagueMode, GameSettler | null>;

/**
 * Full recompute of one league season — the on-demand rebuild. Pass `audit`
 * when a named admin asked for it, so the recompute and its `admin_audit` row
 * commit or roll back together.
 */
export async function rebuildLeagueSeason(
  db: Db,
  clock: Clock,
  leagueSeasonId: string,
  audit?: { adminUserId: string },
): Promise<SettlementSummary> {
  const [row] = await db
    .select({ mode: leagues.mode })
    .from(leagueSeasons)
    .innerJoin(leagues, eq(leagues.id, leagueSeasons.leagueId))
    .where(eq(leagueSeasons.id, leagueSeasonId));
  if (!row) return EMPTY_SUMMARY;

  const rebuild = REBUILD_BY_MODE[row.mode];
  // Nothing was wiped and nothing was recomputed, so there is no prior value to
  // record honestly — an audited no-op would claim a recompute that never ran.
  return rebuild ? rebuild(db, clock, leagueSeasonId, audit) : EMPTY_SUMMARY;
}

/**
 * Settles every league season holding a pick on one of the named games. Both
 * ingestion jobs call it: `sync-scores` when a game goes final, `sync-schedule`
 * when one is cancelled — both change how existing picks resolve.
 *
 * Fanned out across modes rather than dispatched on one league's `mode`,
 * because a single game is picked by leagues of every mode at once and each
 * mode's "which of my league seasons does this game touch" answer lives in its
 * own picks table.
 */
export async function settlePicksForGames(
  db: Db,
  clock: Clock,
  gameIds: readonly string[],
): Promise<SettlementSummary> {
  if (gameIds.length === 0) return EMPTY_SUMMARY;

  let total = EMPTY_SUMMARY;
  for (const settle of Object.values(SETTLE_GAMES_BY_MODE)) {
    if (settle) total = addSummary(total, await settle(db, clock, gameIds));
  }
  return total;
}

/**
 * Nightly reconciliation (arch §Background Jobs, D10): recompute every active
 * league season from stored results, catching late stat corrections, admin
 * overrides, and any tick the incremental path missed.
 *
 * **The `active` filter is what bounds this job's cost over years** (ADR-0030).
 * Settlement retires a season by writing `concluded`, and Survivor's replay is
 * whole-season by construction (ADR-0025), so without that filter doing anything
 * the nightly bill would grow with seasons × weeks and never fall.
 *
 * **A concluded season therefore has no automatic recompute, and that is a real
 * gap rather than a free win.** `settlePicksForGames` finds a league season only
 * through *picks on the changed game*, so a correction to a game the league
 * holds a pick on still reaches it — but a correction to one nobody there picked
 * does not, and this job will not pick it up either. In Survivor that is most of
 * a week's slate. The remedy is the admin rebuild
 * (`POST /admin/leagues/:id/rebuild`), which is status-blind; until someone runs
 * it, a concluded season can hold derived state a full recompute would not
 * reproduce. Widening the sweep to concluded seasons whose games have moved is
 * the fix if this ever bites.
 *
 * Per-season transactions rather than one global one — a single league's bad
 * data must not roll back everyone else's reconciliation, and nothing here
 * depends on cross-league atomicity.
 */
export async function settleSweep(db: Db, clock: Clock): Promise<SettlementSummary> {
  const active = await db
    .select({ id: leagueSeasons.id, mode: leagues.mode })
    .from(leagueSeasons)
    .innerJoin(leagues, eq(leagues.id, leagueSeasons.leagueId))
    .where(eq(leagueSeasons.status, LEAGUE_STATUS.ACTIVE));

  let total = EMPTY_SUMMARY;
  const failures: string[] = [];

  for (const season of active) {
    const rebuild = REBUILD_BY_MODE[season.mode];
    if (!rebuild) continue;
    try {
      total = addSummary(total, await rebuild(db, clock, season.id));
    } catch (error) {
      // One league's bad data must not cost every other league its nightly
      // reconciliation. Without this catch the first throw ends the sweep and
      // every season after it — in unspecified order — goes unreconciled, every
      // night, until someone finds the bad row. The league id is the thing an
      // operator needs and the thrown message never carries it.
      failures.push(season.id);
      total = addSummary(total, { ...EMPTY_SUMMARY, failed: 1 });
      logError("settle-sweep.season-failed", { leagueSeasonId: season.id, error });
    }
  }

  // Non-2xx only after every season has been attempted: the job must still
  // alert (ADR-0007 — cron-job.org emails on a failed request), but alerting
  // by aborting would be the bug this catch exists to prevent.
  if (failures.length > 0) {
    throw new Error(
      `settle-sweep: ${failures.length} of ${active.length} league seasons failed to settle (${failures.join(", ")})`,
    );
  }

  return total;
}
