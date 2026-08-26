import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AdminAuditAction, AdminAuditTargetTable } from "@picksleagues/schemas";
import { users } from "./auth";

/**
 * Operator action log (arch §Domain Model: "admin_audit — admin, action,
 * target, prior value, at"; engineering rules §Data: a rebuild writes
 * `admin_audit` in the recompute's transaction). Cross-cutting admin
 * infrastructure rather than a mode surface, so it keeps a generic name
 * (ADR-0016). Append-only: nothing in the app updates or deletes a row here,
 * hence no `updatedAt`.
 */
export const adminAudit = pgTable("admin_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Restrict, matching `league_members.user_id`: accounts are anonymized in
  // place and never deleted (spec §Account deletion / ID-3), and an audit row
  // whose actor vanished is worthless — this is the FK that must refuse rather
  // than null out if a hard-delete path is ever introduced.
  adminUserId: text("admin_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  action: text("action").$type<AdminAuditAction>().notNull(),
  targetTable: text("target_table").$type<AdminAuditTargetTable>().notNull(),
  targetId: text("target_id").notNull(),
  // JSONB, because "prior value" has a different shape per action (a rebuild's
  // pre-wipe summary today, the next action's own shape tomorrow) and the audit
  // trail must not need a migration each time an action is added. Only the
  // prior value is stored — the new value is the target row's current state,
  // and duplicating it here would let the two disagree.
  priorValue: jsonb("prior_value").$type<Record<string, unknown>>().notNull(),
  // The action's instant, from the injected Clock (arch D13) — never a DB
  // default, so a simulated run's audit trail lines up with its simulated time.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
