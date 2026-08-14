import { eq, inArray, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "@picksleagues/db";
import {
  games,
  leagueInvites,
  leagueMembers,
  leagueSeasons,
  leagues,
  pickemPickResults,
  pickemPicks,
  pickemStandings,
  setSimClockOffsetMs,
  setSimState,
  simScenarios,
  sportSeasons,
  survivorPicks,
  survivorState,
  nflTeamSeasonStats,
  weeks,
} from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ERROR_CODE,
  SIM_RESET_SCOPE,
  type SimClockState,
  type SimResetRequest,
} from "@picksleagues/schemas";
import { readRealNow, simClockStateFrom } from "./clock";

/**
 * Wipes a test league or the whole environment (spec §Testing & Internal
 * Tooling). The `Clock` is read only to rebase the simulated offset back onto
 * the active scenario's start — see the environment branch below.
 *
 * `users`/`sessions`/`accounts`/`verifications` are never deleted in any scope,
 * and deliberately appear nowhere below: a reset that signed the operator out of
 * the admin session they triggered it from would be unusable.
 */

export type ResetResult =
  // `clock` is the state this reset wrote — the caller's `Clock` was resolved
  // from the previous offset, so it can't describe the result itself.
  | { ok: true; deleted: Record<string, number>; clock: SimClockState }
  | { ok: false; reason: typeof ERROR_CODE.LEAGUE_NOT_FOUND };

/**
 * Deletes matched rows and reports how many, in one place, so every call site
 * counts the same way (row-count-from-`.returning()`, not driver `rowCount`).
 */
async function deleteAndCount(tx: Db, table: PgTable, where?: SQL): Promise<number> {
  const rows = where
    ? await tx.delete(table).where(where).returning()
    : await tx.delete(table).returning();
  return rows.length;
}

/**
 * League-owned rows, deepest FK dependency first: invites and members
 * reference `leagues` directly, seasons reference `leagues`, and `leagues`
 * itself goes last. `leagueId` undefined means "every league" (environment
 * scope); a value scopes to one league.
 *
 * Forward compatibility: every new league-owned table needs listing here for
 * reset to stay complete — `pickem_picks` (PKM-2), `pickem_pick_results` and
 * `pickem_standings` (PKM-4), `survivor_picks` and `survivor_state` (ELM-2),
 * each ahead of `league_members`/`leagues` since they reference both.
 *
 * Settlement output is deleted explicitly rather than left to cascade from
 * members/picks. It would in fact cascade, but the counters this returns are
 * the sim panel's report of what a reset did, and a table that vanishes without
 * being counted reads as a table that was missed.
 */
async function deleteLeagueOwnedData(
  tx: Db,
  leagueId: string | undefined,
): Promise<Record<string, number>> {
  // Picks and settlement output carry no league id of their own, so a
  // league-scoped reset matches them through that league's member rows.
  const memberScope = leagueId
    ? tx
        .select({ id: leagueMembers.id })
        .from(leagueMembers)
        .where(eq(leagueMembers.leagueId, leagueId))
    : undefined;

  return {
    pickem_pick_results: await deleteAndCount(
      tx,
      pickemPickResults,
      memberScope ? inArray(pickemPickResults.leagueMemberId, memberScope) : undefined,
    ),
    pickem_standings: await deleteAndCount(
      tx,
      pickemStandings,
      memberScope ? inArray(pickemStandings.leagueMemberId, memberScope) : undefined,
    ),
    pickem_picks: await deleteAndCount(
      tx,
      pickemPicks,
      memberScope ? inArray(pickemPicks.leagueMemberId, memberScope) : undefined,
    ),
    survivor_state: await deleteAndCount(
      tx,
      survivorState,
      memberScope ? inArray(survivorState.leagueMemberId, memberScope) : undefined,
    ),
    survivor_picks: await deleteAndCount(
      tx,
      survivorPicks,
      memberScope ? inArray(survivorPicks.leagueMemberId, memberScope) : undefined,
    ),
    league_invites: await deleteAndCount(
      tx,
      leagueInvites,
      leagueId ? eq(leagueInvites.leagueId, leagueId) : undefined,
    ),
    league_members: await deleteAndCount(
      tx,
      leagueMembers,
      leagueId ? eq(leagueMembers.leagueId, leagueId) : undefined,
    ),
    league_seasons: await deleteAndCount(
      tx,
      leagueSeasons,
      leagueId ? eq(leagueSeasons.leagueId, leagueId) : undefined,
    ),
    leagues: await deleteAndCount(tx, leagues, leagueId ? eq(leagues.id, leagueId) : undefined),
  };
}

/**
 * All ingested sports data, deepest FK dependency first, so the next sync
 * re-ingests cleanly from fixtures. `teams` is deliberately excluded: it is
 * reference data the schedule sync upserts and re-links by
 * (sport, providerTeamId) rather than per-season data, and deleting it would
 * only complicate the `games` FK ordering (RESTRICT) for no benefit — the next
 * sync re-links the same rows it always would.
 */
async function deleteIngestedSportsData(tx: Db): Promise<Record<string, number>> {
  return {
    // nfl_game_stat_context cascades from games; nfl_team_season_stats does not (it
    // FKs the *kept* teams reference rows), so it is deleted explicitly —
    // records that survived a reset would defeat the prior-season fallback
    // (gamesPlayed > 0 on a stale row reads as current-season fact) and, on a
    // different-season re-import, could serve a wrong world's numbers no sync
    // ever heals (ADR-0040).
    nfl_team_season_stats: await deleteAndCount(tx, nflTeamSeasonStats),
    games: await deleteAndCount(tx, games),
    weeks: await deleteAndCount(tx, weeks),
    sport_seasons: await deleteAndCount(tx, sportSeasons),
  };
}

export async function resetSimEnvironment(
  db: Db,
  clock: Clock,
  request: SimResetRequest,
): Promise<ResetResult> {
  if (request.scope === SIM_RESET_SCOPE.LEAGUE) {
    return db.transaction(async (tx) => {
      const [league] = await tx
        .select({ id: leagues.id })
        .from(leagues)
        .where(eq(leagues.id, request.leagueId));
      if (!league) {
        return { ok: false, reason: ERROR_CODE.LEAGUE_NOT_FOUND };
      }

      const deleted = await deleteLeagueOwnedData(tx, request.leagueId);
      // League scope never touches the clock — report it unchanged.
      const { realNowMs, offsetMs } = await readRealNow(tx, clock);
      return { ok: true, deleted, clock: simClockStateFrom(realNowMs, offsetMs) };
    });
  }

  return db.transaction(async (tx) => {
    const deleted: Record<string, number> = {
      ...(await deleteLeagueOwnedData(tx, undefined)),
      ...(await deleteIngestedSportsData(tx)),
    };

    const { realNowMs, offsetMs, activeScenarioId } = await readRealNow(tx, clock);

    if (request.dropScenario) {
      if (activeScenarioId) {
        // Only the loaded scenario — an imported past season costs a full ESPN
        // crawl, and resetting one scenario must not destroy the others.
        // Fixture children cascade on `scenario_id`, but a cascaded delete
        // isn't reflected in this table's `.returning()`, so only the scenario
        // count is reportable accurately.
        deleted.sim_scenarios = await deleteAndCount(
          tx,
          simScenarios,
          eq(simScenarios.id, activeScenarioId),
        );
      }
      await setSimState(tx, { activeScenarioId: null, offsetMs: 0 });
      return { ok: true, deleted, clock: simClockStateFrom(realNowMs, 0) };
    }

    // Keeping the scenario but leaving the clock where it is would be a broken
    // "known state": the wiped season re-ingests with every game already past
    // kickoff, and `sync-odds` only prices unstarted games — so the spreads
    // ATS scoring needs would be gone for good. Rewinding to the scenario's own
    // start is what makes the reset actually reproducible.
    let nextOffsetMs = offsetMs;
    if (activeScenarioId) {
      const [scenario] = await tx
        .select({ startsAt: simScenarios.startsAt })
        .from(simScenarios)
        .where(eq(simScenarios.id, activeScenarioId));
      if (scenario) {
        nextOffsetMs = Math.trunc(scenario.startsAt.getTime() - realNowMs);
        await setSimClockOffsetMs(tx, nextOffsetMs);
      }
    }

    return { ok: true, deleted, clock: simClockStateFrom(realNowMs, nextOffsetMs) };
  });
}
