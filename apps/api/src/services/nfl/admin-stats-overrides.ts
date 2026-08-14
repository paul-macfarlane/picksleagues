import { eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { adminAudit, nflGameStatContext, nflTeamSeasonStats } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  ERROR_CODE,
  type AdminNflGameStatContext,
  type AdminNflTeamSeasonStats,
  type NflGameStatContextOverridePayload,
  type NflGameStatContextOverrideRequest,
  type NflTeamGameContextOverride,
  type NflTeamSeasonStatsOverrideRequest,
} from "@picksleagues/schemas";
import { mergeOverrideField as merge } from "../../lib/override-merge";
import { loadAdminNflGameStatContext, loadAdminNflTeamSeasonStats } from "./admin-stats-data";

/**
 * The admin correction path for the NFL stats tables (STAT-7, ADR-0041 —
 * amending ADR-0040's no-overrides decision): admins write the override layer,
 * ingestion keeps owning the provider columns, reads resolve `override_* ??
 * provider_*` (via `game-stats.ts`'s resolvers). Unlike `setGameOverride`,
 * nothing here recomputes settlement and nothing needs a lock-state guard:
 * stats are display data that feed no outcome — which is also why these writes
 * are refusal-light (the only refusal is "no such row"; correction never
 * creates).
 */

export type SetNflTeamSeasonStatsOverrideResult =
  | { ok: true; stats: AdminNflTeamSeasonStats }
  | { ok: false; reason: typeof ERROR_CODE.TEAM_SEASON_STATS_NOT_FOUND };

export async function setNflTeamSeasonStatsOverride(
  db: Db,
  clock: Clock,
  adminUserId: string,
  statsId: string,
  request: NflTeamSeasonStatsOverrideRequest,
): Promise<SetNflTeamSeasonStatsOverrideResult> {
  const now = clock.now();

  const outcome = await db.transaction(async (tx) => {
    // FOR UPDATE for the same reason setGameOverride takes it: two admins
    // correcting the same row must not each capture the other's pre-write
    // state as the audit's "prior value".
    const [row] = await tx
      .select()
      .from(nflTeamSeasonStats)
      .where(eq(nflTeamSeasonStats.id, statsId))
      .for("update");
    if (!row) return { ok: false as const, reason: ERROR_CODE.TEAM_SEASON_STATS_NOT_FOUND };

    const next = {
      overrideWins: merge(request.wins, row.overrideWins),
      overrideLosses: merge(request.losses, row.overrideLosses),
      overrideTies: merge(request.ties, row.overrideTies),
      overrideHomeWins: merge(request.homeWins, row.overrideHomeWins),
      overrideHomeLosses: merge(request.homeLosses, row.overrideHomeLosses),
      overrideHomeTies: merge(request.homeTies, row.overrideHomeTies),
      overrideRoadWins: merge(request.roadWins, row.overrideRoadWins),
      overrideRoadLosses: merge(request.roadLosses, row.overrideRoadLosses),
      overrideRoadTies: merge(request.roadTies, row.overrideRoadTies),
      overrideStreak: merge(request.streak, row.overrideStreak),
      overridePointsFor: merge(request.pointsFor, row.overridePointsFor),
      overridePointsAgainst: merge(request.pointsAgainst, row.overridePointsAgainst),
    };
    const stillOverridden = Object.values(next).some((value) => value !== null);

    await tx
      .update(nflTeamSeasonStats)
      .set({
        ...next,
        // Cleared alongside the last override so a fully-cleared row is
        // indistinguishable from one never corrected (arch D15); the history
        // lives in `admin_audit`.
        overriddenBy: stillOverridden ? adminUserId : null,
        overriddenAt: stillOverridden ? now : null,
        updatedAt: now,
      })
      .where(eq(nflTeamSeasonStats.id, statsId));

    // Same transaction as the write it describes (arch D15): only the override
    // layer, since the provider columns are untouched here.
    await tx.insert(adminAudit).values({
      adminUserId,
      action: ADMIN_AUDIT_ACTION.NFL_TEAM_SEASON_STATS_OVERRIDE,
      targetTable: ADMIN_AUDIT_TARGET_TABLE.NFL_TEAM_SEASON_STATS,
      targetId: statsId,
      priorValue: {
        overrideWins: row.overrideWins,
        overrideLosses: row.overrideLosses,
        overrideTies: row.overrideTies,
        overrideHomeWins: row.overrideHomeWins,
        overrideHomeLosses: row.overrideHomeLosses,
        overrideHomeTies: row.overrideHomeTies,
        overrideRoadWins: row.overrideRoadWins,
        overrideRoadLosses: row.overrideRoadLosses,
        overrideRoadTies: row.overrideRoadTies,
        overrideStreak: row.overrideStreak,
        overridePointsFor: row.overridePointsFor,
        overridePointsAgainst: row.overridePointsAgainst,
        overriddenBy: row.overriddenBy,
        overriddenAt: row.overriddenAt?.toISOString() ?? null,
      },
      createdAt: now,
    });

    return { ok: true as const };
  });

  if (!outcome.ok) return outcome;

  const stats = await loadAdminNflTeamSeasonStats(db, statsId);
  if (!stats) {
    // Locked and updated moments ago; a miss means the row was deleted out
    // from under us, which nothing in the app can do.
    throw new Error(
      `setNflTeamSeasonStatsOverride: stats ${statsId} vanished after a successful write`,
    );
  }
  return { ok: true, stats };
}

export type SetNflGameStatContextOverrideResult =
  | { ok: true; game: AdminNflGameStatContext }
  | { ok: false; reason: typeof ERROR_CODE.GAME_STAT_CONTEXT_NOT_FOUND };

/** A side whose every field is absent carries no override — drop it. */
function normalizeSide(
  side: NflTeamGameContextOverride | undefined,
): NflTeamGameContextOverride | undefined {
  if (!side) return undefined;
  return Object.values(side).some((value) => value !== undefined) ? side : undefined;
}

/**
 * PUT-replace of the whole override layer (unlike the column tables'
 * three-state patch — the layer here is one JSONB value, and the form submits
 * the whole correction each save). Normalized so "no overrides left" stores
 * NULL: a cleared row must be indistinguishable from one never corrected
 * (arch D15), and an empty-object payload would read as corrected-with-nothing.
 */
function normalizeOverridePayload(
  request: NflGameStatContextOverrideRequest,
): NflGameStatContextOverridePayload | null {
  const home = normalizeSide(request.home);
  const away = normalizeSide(request.away);
  if (!home && !away) return null;
  return { ...(home ? { home } : {}), ...(away ? { away } : {}) };
}

export async function setNflGameStatContextOverride(
  db: Db,
  clock: Clock,
  adminUserId: string,
  gameId: string,
  request: NflGameStatContextOverrideRequest,
): Promise<SetNflGameStatContextOverrideResult> {
  const now = clock.now();
  const nextOverride = normalizeOverridePayload(request);

  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(nflGameStatContext)
      .where(eq(nflGameStatContext.gameId, gameId))
      .for("update");
    // No context row means the sync hasn't reached this game: nothing to
    // correct yet (correction, never creation — ADR-0041).
    if (!row) return { ok: false as const, reason: ERROR_CODE.GAME_STAT_CONTEXT_NOT_FOUND };

    await tx
      .update(nflGameStatContext)
      .set({
        overridePayload: nextOverride,
        overriddenBy: nextOverride ? adminUserId : null,
        overriddenAt: nextOverride ? now : null,
        updatedAt: now,
      })
      .where(eq(nflGameStatContext.id, row.id));

    await tx.insert(adminAudit).values({
      adminUserId,
      action: ADMIN_AUDIT_ACTION.NFL_GAME_STAT_CONTEXT_OVERRIDE,
      targetTable: ADMIN_AUDIT_TARGET_TABLE.NFL_GAME_STAT_CONTEXT,
      targetId: row.id,
      priorValue: {
        overridePayload: row.overridePayload,
        overriddenBy: row.overriddenBy,
        overriddenAt: row.overriddenAt?.toISOString() ?? null,
      },
      createdAt: now,
    });

    return { ok: true as const };
  });

  if (!outcome.ok) return outcome;

  const game = await loadAdminNflGameStatContext(db, gameId);
  if (!game) {
    throw new Error(
      `setNflGameStatContextOverride: game ${gameId} vanished after a successful write`,
    );
  }
  return { ok: true, game };
}
