import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, pickemPicks, survivorPicks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ERROR_CODE,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  pickemSettingsInvalidatePicks,
  survivorSettingsInvalidatePicks,
  type LeagueMode,
  type LeagueSettings,
} from "@picksleagues/schemas";
import { effectiveKickoffAtSql } from "../games";

/**
 * Settings are editable pre-start (spec §Commissioner Powers), but picks are
 * *also* open pre-start — a member can pick week 1 before week 1 begins. That
 * overlap lets a rule change strand picks that were legal when made — see each
 * mode's `*SettingsInvalidatePicks` predicate (packages/schemas) for exactly
 * which changes qualify and why; they're shared with the web settings editor's
 * pre-save warning so the two surfaces can't disagree about what a save
 * destroys.
 *
 * Rather than let any of those reach settlement, an invalidating change clears
 * the instance's picks and members re-pick (ADR-0015 decision 3).
 *
 * Every mode keeps its picks in its own table (arch D9), so this module is
 * mode-dispatched rather than shaped around one table — but the *locked-pick*
 * question is one question, and both modes ask it through the same predicate
 * below: two copies of a kickoff join is exactly the drift that would let one
 * mode delete a pick the other would have refused.
 */

export type SettingsPickResetResult =
  { ok: true; cleared: number } | { ok: false; reason: typeof ERROR_CODE.PICKS_LOCKED };

/**
 * The per-mode pick tables this module clears. They agree on the three columns
 * it needs — the instance, the game, and the row id — which is what lets one
 * locked-pick predicate and one clear serve both.
 */
type ResettablePicks = typeof pickemPicks | typeof survivorPicks;

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
async function hasLockedPick(
  tx: Db,
  picks: ResettablePicks,
  leagueSeasonId: string,
  clock: Clock,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: picks.id })
    .from(picks)
    .innerJoin(games, eq(games.id, picks.gameId))
    .where(
      and(
        eq(picks.leagueSeasonId, leagueSeasonId),
        lte(effectiveKickoffAtSql, sql`${clock.now()}`),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The refuse-or-delete half both modes share once their predicate has said yes. */
async function clearPicks(
  tx: Db,
  picks: ResettablePicks,
  leagueSeasonId: string,
  clock: Clock,
): Promise<SettingsPickResetResult> {
  if (await hasLockedPick(tx, picks, leagueSeasonId, clock)) {
    return { ok: false, reason: ERROR_CODE.PICKS_LOCKED };
  }

  const deleted = await tx
    .delete(picks)
    .where(eq(picks.leagueSeasonId, leagueSeasonId))
    .returning({ id: picks.id });
  return { ok: true, cleared: deleted.length };
}

/**
 * Clears the league season's picks when a settings edit invalidates them, or
 * refuses when any pick has already locked. Runs inside the caller's
 * transaction — the settings write and the reset must commit together.
 *
 * Both settings blobs are parsed, never cast: a stored row that predates a
 * field carrying a `.default()` would read `undefined` and silently decide the
 * change was harmless (engineering rules §Data — read paths feeding
 * scoring/settlement parse through LEAGUE_SETTINGS_SCHEMAS).
 *
 * The switch is exhaustive, so a fourth mode is a compile error here rather
 * than a mode whose picks nobody invalidates.
 */
export async function resetPicksInvalidatedBySettings(
  tx: Db,
  clock: Clock,
  mode: LeagueMode,
  leagueSeasonId: string,
  previous: LeagueSettings,
  next: LeagueSettings,
): Promise<SettingsPickResetResult> {
  switch (mode) {
    case LEAGUE_MODE.PICKEM: {
      const schema = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM];
      if (!pickemSettingsInvalidatePicks(schema.parse(previous), schema.parse(next))) {
        return { ok: true, cleared: 0 };
      }
      return clearPicks(tx, pickemPicks, leagueSeasonId, clock);
    }
    case LEAGUE_MODE.SURVIVOR: {
      const schema = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.SURVIVOR];
      if (!survivorSettingsInvalidatePicks(schema.parse(previous), schema.parse(next))) {
        return { ok: true, cleared: 0 };
      }
      return clearPicks(tx, survivorPicks, leagueSeasonId, clock);
    }
    // A bracket is not a pick and nothing invalidates one mid-edit; when
    // brackets land they get their own branch rather than a shared shape.
    case LEAGUE_MODE.MARCH_MADNESS:
      return { ok: true, cleared: 0 };
  }
}
