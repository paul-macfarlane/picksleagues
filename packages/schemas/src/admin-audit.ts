import { z } from "@hono/zod-openapi";

/**
 * The actions recorded in `admin_audit` (arch §Manual Sports Data Overrides:
 * "every override is recorded in an `admin_audit` table — who, what, when,
 * previous value"; engineering rules §Data: "every override/rebuild writes
 * `admin_audit`").
 *
 * Lives here rather than in `packages/db` because the audit view (ADM-3)
 * serializes it on the wire, and a value set gets one definition (engineering
 * rules §Quality).
 */
export const ADMIN_AUDIT_ACTION = {
  GAME_OVERRIDE: "game_override",
  LEAGUE_REBUILD: "league_rebuild",
  NFL_TEAM_SEASON_STATS_OVERRIDE: "nfl_team_season_stats_override",
  NFL_GAME_STAT_CONTEXT_OVERRIDE: "nfl_game_stat_context_override",
} as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTION)[keyof typeof ADMIN_AUDIT_ACTION];

/**
 * Which table a recorded action targeted. Stored alongside the row id rather
 * than folded into one opaque "target" string so the audit trail for a given
 * row is a plain equality lookup.
 */
export const ADMIN_AUDIT_TARGET_TABLE = {
  GAMES: "games",
  // A rebuild's target is the league *season* whose derived state it wipes and
  // recomputes, not the league: per-mode sibling tables (survivor, March
  // Madness) hang off the same row without a second vocabulary.
  LEAGUE_SEASONS: "league_seasons",
  NFL_TEAM_SEASON_STATS: "nfl_team_season_stats",
  NFL_GAME_STAT_CONTEXT: "nfl_game_stat_context",
} as const;

export type AdminAuditTargetTable =
  (typeof ADMIN_AUDIT_TARGET_TABLE)[keyof typeof ADMIN_AUDIT_TARGET_TABLE];

export const AdminAuditActionSchema = z.enum(ADMIN_AUDIT_ACTION).openapi("AdminAuditAction");

export const AdminAuditTargetTableSchema = z
  .enum(ADMIN_AUDIT_TARGET_TABLE)
  .openapi("AdminAuditTargetTable");

/**
 * One row of the admin action log as the audit view reads it (arch §Manual
 * Sports Data Overrides: "who, what, when, previous value").
 *
 * The actor and the target arrive resolved rather than as bare ids, because a
 * page of UUIDs answers "what happened" for nobody. `username` is a plain
 * nullable string rather than the registered `Username` component — every read
 * surface in the repo (`LeagueMember`, the standings rows) does the same: the
 * format rule governs the write, a read echoes what is stored, and wrapping the
 * registered node in `.nullable()` here would fold `null` into the shared
 * component and widen every other reference to it (engineering rules §Contract
 * & codegen).
 *
 * `targetLabel` is null when the target row is gone. Audit rows outlive their
 * targets by design — the restrict FK is on the actor, not the target — so a
 * deleted league's rebuild rows still render, unlabelled.
 *
 * `priorValue` stays untyped JSON: its shape is per-action (a game override's
 * override block, a rebuild's pre-wipe summary), which is the same reason the
 * column is JSONB, and the view renders it as formatted JSON rather than
 * pretending to type it.
 */
export const AdminAuditEntrySchema = z
  .object({
    id: z.string(),
    admin: z.object({
      displayName: z.string(),
      username: z.string().nullable(),
    }),
    action: AdminAuditActionSchema,
    targetTable: AdminAuditTargetTableSchema,
    targetId: z.string(),
    targetLabel: z.string().nullable(),
    priorValue: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
  })
  .openapi("AdminAuditEntry");

export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>;

/**
 * A page of the trail. `total` is the whole table's count, so the view can say
 * how much there is and know when it has reached the end; `limit` and `offset`
 * are echoed back because they are the page the server actually served — a
 * clamped or defaulted value would otherwise leave the view labelling its range
 * from what it *asked* for.
 */
export const AdminAuditResponseSchema = z
  .object({
    entries: z.array(AdminAuditEntrySchema),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .openapi("AdminAuditResponse");

export type AdminAuditResponse = z.infer<typeof AdminAuditResponseSchema>;
