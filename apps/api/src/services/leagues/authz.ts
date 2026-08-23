import { and, count, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers } from "@picksleagues/db";
import {
  ERROR_CODE,
  LEAGUE_STATUS,
  MEMBER_ROLE,
  leagueActionRequiresCommissioner,
  type LeagueAction,
} from "@picksleagues/schemas";
import { currentLeagueSeason } from "./current-season";

/**
 * Counts the caller's commissioner roles across active leagues — the
 * spec §Limits cap. Shared by create (above) and promote (LG-6), both of
 * which run it inside their mutating transaction.
 *
 * "Active" is the league's CURRENT instance being ACTIVE (ADR-0009): join each
 * league to its current season and filter status, so a league with a concluded
 * past instance and an active current one counts exactly once — never
 * exists-any-active, which would over-count multi-season leagues.
 */
export async function countActiveCommissionerships(db: Db, userId: string): Promise<number> {
  const current = currentLeagueSeason(db);
  const [row] = await db
    .select({ value: count() })
    .from(leagueMembers)
    .innerJoin(current, and(eq(current.leagueId, leagueMembers.leagueId), eq(current.rank, 1)))
    .where(
      and(
        eq(leagueMembers.userId, userId),
        eq(leagueMembers.role, MEMBER_ROLE.COMMISSIONER),
        eq(current.status, LEAGUE_STATUS.ACTIVE),
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

/**
 * The refusal half of every commissioner-gated result: non-members get
 * league_not_found (404 — private leagues stay hidden), members lacking the
 * role get not_commissioner (403). One type, so a service that composes it
 * can't drift from the gate that produces it.
 */
export type LeagueActionRefusal = {
  ok: false;
  reason: typeof ERROR_CODE.LEAGUE_NOT_FOUND | typeof ERROR_CODE.NOT_COMMISSIONER;
};

export type LeagueActionGate =
  { ok: true; membership: typeof leagueMembers.$inferSelect } | LeagueActionRefusal;

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
  if (!membership) return { ok: false, reason: ERROR_CODE.LEAGUE_NOT_FOUND };
  if (leagueActionRequiresCommissioner(action) && membership.role !== MEMBER_ROLE.COMMISSIONER) {
    return { ok: false, reason: ERROR_CODE.NOT_COMMISSIONER };
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
