/**
 * The actions recorded in `admin_audit` — who, what, when, previous value. Only
 * the rebuild remains (ADR-0046 retired the override actions), and the value
 * set stays because a second recorded action gets a slot here rather than a
 * raw slug.
 *
 * Lives here rather than in `packages/db` because a value set gets one
 * definition (engineering rules §Quality) and the writer is a service, not the
 * schema: `packages/db` types the column from it and settlement writes it.
 * Nothing serves the trail on the wire — the audit view went with the override
 * layer it mostly recorded (ADR-0046); the table is read with SQL.
 */
export const ADMIN_AUDIT_ACTION = {
  LEAGUE_REBUILD: "league_rebuild",
} as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTION)[keyof typeof ADMIN_AUDIT_ACTION];

/**
 * Which table a recorded action targeted. Stored alongside the row id rather
 * than folded into one opaque "target" string so the audit trail for a given
 * row is a plain equality lookup.
 */
export const ADMIN_AUDIT_TARGET_TABLE = {
  // A rebuild's target is the league *season* whose derived state it wipes and
  // recomputes, not the league: per-mode sibling tables (survivor, March
  // Madness) hang off the same row without a second vocabulary.
  LEAGUE_SEASONS: "league_seasons",
} as const;

export type AdminAuditTargetTable =
  (typeof ADMIN_AUDIT_TARGET_TABLE)[keyof typeof ADMIN_AUDIT_TARGET_TABLE];
