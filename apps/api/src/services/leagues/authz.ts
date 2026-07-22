import { and, count, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, leagues } from "@picksleagues/db";
import {
  LEAGUE_STATUS,
  MEMBER_ROLE,
  leagueActionRequiresCommissioner,
  type LeagueAction,
} from "@picksleagues/schemas";

/**
 * Counts the caller's commissioner roles across active leagues — the
 * spec §Limits cap. Shared by create (above) and promote (LG-6), both of
 * which run it inside their mutating transaction.
 */
export async function countActiveCommissionerships(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagueMembers.leagueId, leagues.id))
    .where(
      and(
        eq(leagueMembers.userId, userId),
        eq(leagueMembers.role, MEMBER_ROLE.COMMISSIONER),
        eq(leagues.status, LEAGUE_STATUS.ACTIVE),
      ),
    );
  return row?.value ?? 0;
}

/** The caller's membership row in a league, or null — the shared authz probe. */
export async function getMembership(
  db: Db,
  leagueId: string,
  userId: string,
): Promise<typeof leagueMembers.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId)));
  return row ?? null;
}

export type LeagueActionGate =
  | { ok: true; membership: typeof leagueMembers.$inferSelect }
  | { ok: false; reason: "league_not_found" | "not_commissioner" };

/**
 * The one role-axis gate for league actions, consulting the LEAGUE_ACTION
 * matrix (spec §Commissioner Powers): non-members get league_not_found
 * (404 — private leagues stay hidden), members lacking the required role get
 * not_commissioner (403). The window axis is deliberately NOT checked here —
 * it needs the Clock + leagueStartAt inside each mutation's transaction and
 * maps to a different refusal (409 league_started); callers consult
 * leagueActionIsPreStartOnly there so the matrix stays the source of truth
 * for both axes.
 */
export async function authorizeLeagueAction(
  db: Db,
  leagueId: string,
  userId: string,
  action: LeagueAction,
): Promise<LeagueActionGate> {
  const membership = await getMembership(db, leagueId, userId);
  if (!membership) return { ok: false, reason: "league_not_found" };
  if (leagueActionRequiresCommissioner(action) && membership.role !== MEMBER_ROLE.COMMISSIONER) {
    return { ok: false, reason: "not_commissioner" };
  }
  return { ok: true, membership };
}

export async function countMembers(db: Db, leagueId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, leagueId));
  return row?.value ?? 0;
}
