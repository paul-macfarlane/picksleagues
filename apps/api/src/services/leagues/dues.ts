import { and, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueDuesPayments, leagueMembers, leagueSeasons } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import { ERROR_CODE, LEAGUE_ACTION, type LeagueResponse } from "@picksleagues/schemas";
import { authorizeLeagueAction, type LeagueActionRefusal } from "./authz";
import { lockLeagueRow } from "./locks";
import { getLeagueWithCurrentSeason, readAndSerializeLeague } from "./current-season";

export type UpdateLeagueDuesResult = { ok: true; league: LeagueResponse } | LeagueActionRefusal;

/**
 * Set or clear the current instance's dues amount (ADR-0045). No window check:
 * MANAGE_DUES is deliberately anytime — dues are informational, never
 * competitive. Clearing keeps the ledger rows, so re-enabling restores who had
 * already paid instead of forgetting it.
 */
export async function updateLeagueDues(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
  amount: number | null,
): Promise<UpdateLeagueDuesResult> {
  const refusal = await db.transaction(async (tx): Promise<UpdateLeagueDuesResult | null> => {
    // Serializes against renewal (which takes this lock before minting the next
    // instance) so "the current instance" read below can't be superseded
    // mid-transaction — without it this write can land on an instance renewal
    // just retired, silently dropping the new amount from the new season.
    await lockLeagueRow(tx, leagueId);

    const gate = await authorizeLeagueAction(tx, leagueId, userId, LEAGUE_ACTION.MANAGE_DUES);
    if (!gate.ok) return gate;

    const current = await getLeagueWithCurrentSeason(tx, leagueId);
    if (!current) return { ok: false, reason: ERROR_CODE.LEAGUE_NOT_FOUND };

    await tx
      .update(leagueSeasons)
      .set({ duesAmount: amount, updatedAt: clock.now() })
      .where(eq(leagueSeasons.id, current.season.id));
    return null;
  });
  if (refusal) return refusal;

  const league = await readAndSerializeLeague(db, leagueId, userId);
  if (!league) throw new Error("League unreadable immediately after dues update.");
  return { ok: true, league };
}

export type SetMemberDuesPaidResult =
  | { ok: true }
  | LeagueActionRefusal
  | {
      ok: false;
      reason: typeof ERROR_CODE.MEMBER_NOT_FOUND | typeof ERROR_CODE.DUES_NOT_ENABLED;
    };

/**
 * Mark one member's dues paid or unpaid on the current instance's ledger
 * (ADR-0045). Idempotent in both directions — the unique constraint plus
 * `onConflictDoNothing` make a double mark a no-op, and unmarking the unpaid
 * deletes nothing — so a double-tap or a stale UI can't error or double-record.
 * Refused while dues are off: the mark would be invisible on every surface.
 */
export async function setMemberDuesPaid(
  db: Db,
  clock: Clock,
  leagueId: string,
  callerId: string,
  memberId: string,
  paid: boolean,
): Promise<SetMemberDuesPaidResult> {
  return db.transaction(async (tx): Promise<SetMemberDuesPaidResult> => {
    // Same serialization as the amount write above: the ledger row must attach
    // to the instance that is still current when this commits.
    await lockLeagueRow(tx, leagueId);

    const gate = await authorizeLeagueAction(tx, leagueId, callerId, LEAGUE_ACTION.MANAGE_DUES);
    if (!gate.ok) return gate;

    const current = await getLeagueWithCurrentSeason(tx, leagueId);
    if (!current) return { ok: false, reason: ERROR_CODE.LEAGUE_NOT_FOUND };
    if (current.season.duesAmount === null) {
      return { ok: false, reason: ERROR_CODE.DUES_NOT_ENABLED };
    }

    const [member] = await tx
      .select()
      .from(leagueMembers)
      .where(and(eq(leagueMembers.id, memberId), eq(leagueMembers.leagueId, leagueId)));
    if (!member) return { ok: false, reason: ERROR_CODE.MEMBER_NOT_FOUND };

    if (paid) {
      const now = clock.now();
      await tx
        .insert(leagueDuesPayments)
        .values({
          leagueSeasonId: current.season.id,
          userId: member.userId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(leagueDuesPayments)
        .where(
          and(
            eq(leagueDuesPayments.leagueSeasonId, current.season.id),
            eq(leagueDuesPayments.userId, member.userId),
          ),
        );
    }
    return { ok: true };
  });
}
