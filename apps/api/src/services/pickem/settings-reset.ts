import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, pickemPicks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  nflSeasonOrdinal,
  type LeagueMode,
  type LeagueSettings,
  type PickemSettings,
} from "@picksleagues/schemas";
import { effectiveKickoffAtSql } from "../games";

/**
 * Settings are editable pre-start (spec §Commissioner Powers), but picks are
 * *also* open pre-start — a member can pick week 1 before week 1 begins. That
 * overlap lets a rule change strand picks that were legal when made:
 *
 * - switching Pick Type to ATS leaves picks with no spread, which settlement
 *   cannot grade at all (it throws by design rather than guess);
 * - lowering Picks Per Week leaves members over the cap;
 * - narrowing the week range orphans picks in weeks no longer in the league.
 *
 * Rather than let any of those reach settlement, an invalidating change clears
 * the instance's picks and members re-pick. A change that cannot strand a pick
 * (Push/Tie Resolution, which scoring reads at settlement time; Picks Per Week
 * *raised*) clears nothing.
 */

export type SettingsPickResetResult =
  { ok: true; cleared: number } | { ok: false; reason: "picks_locked" };

export function pickemSettingsInvalidatePicks(
  previous: PickemSettings,
  next: PickemSettings,
): boolean {
  return (
    previous.pickType !== next.pickType ||
    next.picksPerWeek < previous.picksPerWeek ||
    nflSeasonOrdinal(next.startWeek) > nflSeasonOrdinal(previous.startWeek) ||
    nflSeasonOrdinal(next.endWeek) < nflSeasonOrdinal(previous.endWeek)
  );
}

/**
 * Whether any pick on this instance has locked. Clearing picks is only safe
 * while none has — a locked pick has been revealed to the league (spec §Pick
 * Visibility) and may already be settled, so deleting it destroys real history.
 *
 * The caller's pre-start gate is NOT sufficient to establish this: `isPreStart`
 * treats a null start (a start week holding no games) as pre-start, and the
 * schedule sync deliberately preserves emptied weeks that still hold picks, so
 * a league can re-enter "pre-start" mid-season. This asks the picks directly.
 */
async function hasLockedPick(tx: Db, leagueSeasonId: string, clock: Clock): Promise<boolean> {
  const [row] = await tx
    .select({ id: pickemPicks.id })
    .from(pickemPicks)
    .innerJoin(games, eq(games.id, pickemPicks.gameId))
    .where(
      and(
        eq(pickemPicks.leagueSeasonId, leagueSeasonId),
        lte(effectiveKickoffAtSql, sql`${clock.now()}`),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Clears the league season's picks when a settings edit invalidates them, or
 * refuses when any pick has already locked. Runs inside the caller's
 * transaction — the settings write and the reset must commit together.
 */
export async function resetPicksInvalidatedBySettings(
  tx: Db,
  clock: Clock,
  mode: LeagueMode,
  leagueSeasonId: string,
  previous: LeagueSettings,
  next: LeagueSettings,
): Promise<SettingsPickResetResult> {
  // Only Pick'em stores picks today; ELM-2 adds its own table and its own
  // invalidation rule, which is why this dispatches on mode rather than
  // assuming one shape.
  if (mode !== LEAGUE_MODE.PICKEM) return { ok: true, cleared: 0 };

  // Parsed, not cast: `picksPerWeek` carries a `.default()`, and comparing
  // against a stored row that predates the field would read `undefined` and
  // silently decide the change was harmless (engineering rules §Data — read
  // paths feeding scoring parse through LEAGUE_SETTINGS_SCHEMAS).
  const schema = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM];
  if (!pickemSettingsInvalidatePicks(schema.parse(previous), schema.parse(next))) {
    return { ok: true, cleared: 0 };
  }

  if (await hasLockedPick(tx, leagueSeasonId, clock)) {
    return { ok: false, reason: "picks_locked" };
  }

  const deleted = await tx
    .delete(pickemPicks)
    .where(eq(pickemPicks.leagueSeasonId, leagueSeasonId))
    .returning({ id: pickemPicks.id });
  return { ok: true, cleared: deleted.length };
}
