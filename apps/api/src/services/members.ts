import { and, count, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, leagues, leagueSettings } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  MAX_ACTIVE_COMMISSIONER_LEAGUES,
  MEMBER_ROLE,
  type MemberRole,
} from "@picksleagues/schemas";
import {
  countActiveCommissionerships,
  countMembers,
  getMembership,
  isPreStart,
  leagueStartAt,
  lockLeagueRow,
  lockUserRow,
} from "./leagues";

/**
 * Commissioner powers over memberships (spec §Commissioner Powers, ADR-0004):
 * promote/demote anytime, kick pre-start only, leave (LG-8) pre-start only —
 * every mutation that could strand a league without a commissioner re-checks
 * the ≥1-commissioner invariant inside its transaction and rolls back on
 * violation.
 */

async function countCommissioners(db: Db, leagueId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(leagueMembers)
    .where(
      and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.role, MEMBER_ROLE.COMMISSIONER)),
    );
  return row?.value ?? 0;
}

/** Thrown inside member transactions to roll back and surface the refusal. */
class MemberMutationError extends Error {
  readonly reason: "cap_exceeded" | "last_commissioner";

  constructor(reason: "cap_exceeded" | "last_commissioner") {
    super(`member mutation refused: ${reason}`);
    this.reason = reason;
  }
}

type ActorGateFailure = { ok: false; reason: "league_not_found" | "not_commissioner" };

export type UpdateMemberRoleResult =
  | { ok: true }
  | ActorGateFailure
  | { ok: false; reason: "member_not_found" | "cap_exceeded" | "last_commissioner" };

export async function updateMemberRole(
  db: Db,
  clock: Clock,
  leagueId: string,
  actorId: string,
  memberId: string,
  role: MemberRole,
): Promise<UpdateMemberRoleResult> {
  try {
    return await db.transaction(async (tx) => {
      // Serializes concurrent role mutations on this league — the invariant
      // count below is only meaningful once we hold the league lock.
      await lockLeagueRow(tx, leagueId);

      const actor = await getMembership(tx, leagueId, actorId);
      if (!actor) return { ok: false, reason: "league_not_found" as const };
      if (actor.role !== MEMBER_ROLE.COMMISSIONER) {
        return { ok: false, reason: "not_commissioner" as const };
      }

      const [target] = await tx
        .select()
        .from(leagueMembers)
        .where(and(eq(leagueMembers.id, memberId), eq(leagueMembers.leagueId, leagueId)));
      if (!target) return { ok: false, reason: "member_not_found" as const };
      if (target.role === role) return { ok: true as const };

      if (role === MEMBER_ROLE.COMMISSIONER) {
        // Serializes the recipient's cross-league cap count against their
        // concurrent creates/promotes elsewhere.
        await lockUserRow(tx, target.userId);
      }

      await tx
        .update(leagueMembers)
        .set({ role, updatedAt: clock.now() })
        .where(eq(leagueMembers.id, target.id));

      if (role === MEMBER_ROLE.COMMISSIONER) {
        // Promote: the cap applies to the RECIPIENT (spec §Limits, ADR-0004),
        // counted inside the tx so exceeding it rolls the promotion back. The
        // count only sees active leagues, so a promote in a concluded league
        // can never trip it.
        if (
          (await countActiveCommissionerships(tx, target.userId)) > MAX_ACTIVE_COMMISSIONER_LEAGUES
        ) {
          throw new MemberMutationError("cap_exceeded");
        }
      } else if ((await countCommissioners(tx, leagueId)) === 0) {
        // Demote (incl. stepping down): a league with members must keep ≥1
        // commissioner (ADR-0004).
        throw new MemberMutationError("last_commissioner");
      }

      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof MemberMutationError) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}

export type KickMemberResult =
  | { ok: true }
  | ActorGateFailure
  | {
      ok: false;
      reason: "member_not_found" | "cannot_kick_self" | "league_started" | "last_commissioner";
    };

export async function kickMember(
  db: Db,
  clock: Clock,
  leagueId: string,
  actorId: string,
  memberId: string,
): Promise<KickMemberResult> {
  try {
    return await db.transaction(async (tx) => {
      await lockLeagueRow(tx, leagueId);

      const actor = await getMembership(tx, leagueId, actorId);
      if (!actor) return { ok: false, reason: "league_not_found" as const };
      if (actor.role !== MEMBER_ROLE.COMMISSIONER) {
        return { ok: false, reason: "not_commissioner" as const };
      }
      // Kicking yourself would dodge LG-8's leave rules (sole-member
      // commissioners must delete the league, not empty it) — route them there.
      if (actor.id === memberId) return { ok: false, reason: "cannot_kick_self" as const };

      const [target] = await tx
        .select()
        .from(leagueMembers)
        .where(and(eq(leagueMembers.id, memberId), eq(leagueMembers.leagueId, leagueId)));
      if (!target) return { ok: false, reason: "member_not_found" as const };

      if (!(await leagueIsPreStart(tx, clock, leagueId))) {
        return { ok: false, reason: "league_started" as const };
      }

      await tx.delete(leagueMembers).where(eq(leagueMembers.id, target.id));

      if ((await countCommissioners(tx, leagueId)) === 0) {
        throw new MemberMutationError("last_commissioner");
      }
      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof MemberMutationError && error.reason === "last_commissioner") {
      return { ok: false, reason: "last_commissioner" };
    }
    throw error;
  }
}

export type LeaveLeagueResult =
  | { ok: true }
  | {
      ok: false;
      reason: "league_not_found" | "league_started" | "sole_member" | "last_commissioner";
    };

/**
 * LG-8 (spec §Membership, ADR-0004): leaving is pre-start only. A last
 * commissioner with other members must promote a replacement first; a
 * commissioner who is the only member deletes the league instead of leaving
 * it empty.
 */
export async function leaveLeague(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
): Promise<LeaveLeagueResult> {
  try {
    return await db.transaction(async (tx) => {
      await lockLeagueRow(tx, leagueId);

      const membership = await getMembership(tx, leagueId, userId);
      if (!membership) return { ok: false, reason: "league_not_found" as const };

      if (!(await leagueIsPreStart(tx, clock, leagueId))) {
        return { ok: false, reason: "league_started" as const };
      }

      if (
        membership.role === MEMBER_ROLE.COMMISSIONER &&
        (await countMembers(tx, leagueId)) === 1
      ) {
        return { ok: false, reason: "sole_member" as const };
      }

      await tx.delete(leagueMembers).where(eq(leagueMembers.id, membership.id));

      if ((await countCommissioners(tx, leagueId)) === 0) {
        throw new MemberMutationError("last_commissioner");
      }
      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof MemberMutationError && error.reason === "last_commissioner") {
      return { ok: false, reason: "last_commissioner" };
    }
    throw error;
  }
}

/** Pre-start check against rows read INSIDE the caller's transaction. */
async function leagueIsPreStart(tx: Db, clock: Clock, leagueId: string): Promise<boolean> {
  const [row] = await tx
    .select({ league: leagues, settings: leagueSettings.settings })
    .from(leagues)
    .innerJoin(leagueSettings, eq(leagueSettings.leagueId, leagues.id))
    .where(eq(leagues.id, leagueId));
  if (!row) return false;
  return isPreStart(await leagueStartAt(tx, row.league, row.settings), clock);
}
