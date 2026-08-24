import { z } from "@hono/zod-openapi";

/**
 * Upper bound on a league's dues amount — a sanity rail like MaxMembersSchema's
 * ceiling, not a product rule. Mirrored as a CHECK on `league_seasons`
 * (packages/db), which can't import this constant; a change here needs a
 * migration moving that literal with it.
 */
export const MAX_DUES_AMOUNT = 10000;

/**
 * Whole US dollars (owner, 2026-08-23 — friends-league dues are round
 * numbers). Deliberately NOT `.openapi()`-registered: the request field below
 * wraps it in `.nullable()` inline, which on a registered schema would fold
 * null into the shared component (engineering rules §Contract & codegen).
 */
export const DuesAmountSchema = z.number().int().min(1).max(MAX_DUES_AMOUNT);

/**
 * Set or clear the league's dues amount (ADR-0045): `amount: null` turns dues
 * tracking off. Clearing keeps the ledger rows — turning dues back on
 * restores who had already paid rather than forgetting it.
 */
export const UpdateLeagueDuesRequestSchema = z
  .object({ amount: DuesAmountSchema.nullable() })
  .openapi("UpdateLeagueDuesRequest");

export type UpdateLeagueDuesRequest = z.infer<typeof UpdateLeagueDuesRequestSchema>;

/**
 * Mark one member paid or unpaid. Idempotent by design — re-marking a paid
 * member is a no-op, so a double-tap can't error or double-record.
 */
export const UpdateMemberDuesRequestSchema = z
  .object({ paid: z.boolean() })
  .openapi("UpdateMemberDuesRequest");

export type UpdateMemberDuesRequest = z.infer<typeof UpdateMemberDuesRequestSchema>;
