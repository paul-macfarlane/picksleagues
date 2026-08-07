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
} as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTION)[keyof typeof ADMIN_AUDIT_ACTION];

/**
 * Which table a recorded action targeted. Stored alongside the row id rather
 * than folded into one opaque "target" string so the audit trail for a given
 * row is a plain equality lookup.
 */
export const ADMIN_AUDIT_TARGET_TABLE = {
  GAMES: "games",
} as const;

export type AdminAuditTargetTable =
  (typeof ADMIN_AUDIT_TARGET_TABLE)[keyof typeof ADMIN_AUDIT_TARGET_TABLE];
