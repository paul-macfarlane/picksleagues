import type { Db } from "@picksleagues/db";
import { isUniqueViolation, leagueMembers } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ERROR_CODE,
  JOIN_BLOCKED_REASON,
  LEAGUE_STATUS,
  LEAGUE_VISIBILITY,
  MEMBER_ROLE,
  type JoinBlockedReason,
  type LeagueResponse,
} from "@picksleagues/schemas";
import { lockLeagueRow } from "./locks";
import { countMembers, getMembership } from "./authz";
import { getLeagueWithCurrentSeason } from "./current-season";
import { isPreStart, leagueStartAt } from "./start";
import { getLeague } from "./crud";

/**
 * Aborts a join transaction with the exact refusal — thrown (not returned) so
 * any writes already made inside the tx (e.g. an invite use-count increment)
 * roll back with the refused join.
 */
export class JoinRefusedError extends Error {
  readonly reason: JoinBlockedReason;

  constructor(reason: JoinBlockedReason) {
    super(`join refused: ${reason}`);
    this.reason = reason;
  }
}

/** Thrown by joinLeagueInTx when the league is absent (or not public when required). */
export class LeagueMissingError extends Error {}

/**
 * Membership-rule core shared by invite joins and public joins (spec
 * §Membership), run INSIDE the caller's transaction. Locks the league row
 * FIRST, then reads league state and runs every check post-lock, so
 * concurrent joins serialize (the size-cap count sees prior commits) and a
 * conclusion/visibility flip can't slip through a stale snapshot:
 * 1. already a member → refuse (the unique constraint is the race backstop);
 * 2. league concluded → refuse;
 * 3. clock-derived join cutoff — the league has started (arch §Locking
 *    Model: same boundary as pre-start windows) → refuse;
 * 4. insert, then re-count: over the league's maxMembers cap → refuse (rolls
 *    back the insert, so the check-then-act is collapsed into the tx).
 */
export async function joinLeagueInTx(
  tx: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
  { mustBePublic = false }: { mustBePublic?: boolean } = {},
): Promise<void> {
  await lockLeagueRow(tx, leagueId);

  // Read the current instance INSIDE the tx after the lock (ADR-0009): the
  // concluded/cutoff checks and the size-cap count below must see the same
  // serialized snapshot the lock guarantees.
  const current = await getLeagueWithCurrentSeason(tx, leagueId);
  if (!current || (mustBePublic && current.league.visibility !== LEAGUE_VISIBILITY.PUBLIC)) {
    throw new LeagueMissingError();
  }
  const { league, season } = current;

  if (await getMembership(tx, leagueId, userId)) {
    throw new JoinRefusedError(JOIN_BLOCKED_REASON.ALREADY_MEMBER);
  }
  if (season.status !== LEAGUE_STATUS.ACTIVE) {
    throw new JoinRefusedError(JOIN_BLOCKED_REASON.LEAGUE_CONCLUDED);
  }
  const startsAt = await leagueStartAt(
    tx,
    { mode: league.mode, seasonId: season.seasonId },
    season.settings,
  );
  if (!isPreStart(startsAt, clock)) {
    throw new JoinRefusedError(JOIN_BLOCKED_REASON.JOIN_CLOSED);
  }

  const now = clock.now();
  try {
    await tx.insert(leagueMembers).values({
      leagueId,
      userId,
      role: MEMBER_ROLE.MEMBER,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error, "league_members_league_user_unique")) {
      throw new JoinRefusedError(JOIN_BLOCKED_REASON.ALREADY_MEMBER);
    }
    throw error;
  }

  if ((await countMembers(tx, leagueId)) > league.maxMembers) {
    throw new JoinRefusedError(JOIN_BLOCKED_REASON.LEAGUE_FULL);
  }
}

export type JoinResult =
  | { ok: true; league: LeagueResponse }
  | { ok: false; reason: JoinBlockedReason | typeof ERROR_CODE.LEAGUE_NOT_FOUND };

/**
 * Direct join for discoverable leagues (spec §Visibility: public leagues are
 * joinable without a code). Private leagues 404 — joining them requires an
 * invite, and their existence stays hidden.
 */
export async function joinPublicLeague(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
): Promise<JoinResult> {
  try {
    await db.transaction(async (tx) => {
      await joinLeagueInTx(tx, clock, leagueId, userId, { mustBePublic: true });
    });
  } catch (error) {
    if (error instanceof LeagueMissingError) {
      return { ok: false, reason: ERROR_CODE.LEAGUE_NOT_FOUND };
    }
    if (error instanceof JoinRefusedError) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }

  const league = await getLeague(db, leagueId, userId);
  if (!league) throw new Error("Joined league unreadable immediately after join.");
  return { ok: true, league };
}
