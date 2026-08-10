import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueInvites, users } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  INVITE_STATUS,
  JOIN_BLOCKED_REASON,
  LEAGUE_ACTION,
  LEAGUE_STATUS,
  leagueActionIsPreStartOnly,
  type Invite,
  type InviteStatus,
  type JoinBlockedReason,
  type JoinPreviewResponse,
  type LeagueResponse,
} from "@picksleagues/schemas";
import {
  authorizeLeagueAction,
  countMembers,
  getLeague,
  getLeagueWithCurrentSeason,
  getMembership,
  isPreStart,
  JoinRefusedError,
  joinLeagueInTx,
  leagueIsPreStart,
  LeagueMissingError,
  leagueStartAt,
} from "./leagues";

type InviteRow = typeof leagueInvites.$inferSelect;

/**
 * Invite state is derived at read time, never stored (same pattern as lock
 * state, arch D11). Revocation is the only lifecycle an invite has (ADR-0032
 * cut expiry and use caps), so the derivation is a single null check — kept
 * as the one named home for the question so a second surface can't answer it
 * from a different field.
 */
export function inviteStatus(invite: InviteRow): InviteStatus {
  return invite.revokedAt !== null ? INVITE_STATUS.REVOKED : INVITE_STATUS.ACTIVE;
}

// MANAGE_INVITES (listing and revoking) is an anytime power — the shared gate
// covers its only axis. Creation is the split-off CREATE_INVITE, which has a
// window and checks it below.
type CommissionerGateFailure = { ok: false; reason: "league_not_found" | "not_commissioner" };

export type CreateInviteResult =
  { ok: true; invite: Invite } | CommissionerGateFailure | { ok: false; reason: "league_started" };

export async function createInvite(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
): Promise<CreateInviteResult> {
  const gate = await authorizeLeagueAction(db, leagueId, userId, LEAGUE_ACTION.CREATE_INVITE);
  if (!gate.ok) return gate;

  // No transaction around check-then-insert: the boundary is a wall-clock
  // instant, so a tx couldn't stop it passing mid-request, and an invite that
  // slipped through is inert anyway — the join endpoint re-derives the same
  // cutoff and refuses with `join_closed` (ADR-0029).
  if (
    leagueActionIsPreStartOnly(LEAGUE_ACTION.CREATE_INVITE) &&
    !(await leagueIsPreStart(db, clock, leagueId))
  ) {
    return { ok: false, reason: "league_started" };
  }

  const now = clock.now();
  // 128 bits of randomness, URL-safe — unguessable and collision-free in
  // practice; the unique constraint is the backstop.
  const code = randomBytes(16).toString("base64url");
  const [created] = await db
    .insert(leagueInvites)
    .values({
      leagueId,
      code,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) {
    throw new Error("Invite insert returned no row.");
  }

  return { ok: true, invite: await serializeInvite(db, created) };
}

export type ListInvitesResult = { ok: true; invites: Invite[] } | CommissionerGateFailure;

export async function listInvites(
  db: Db,
  leagueId: string,
  userId: string,
): Promise<ListInvitesResult> {
  const gate = await authorizeLeagueAction(db, leagueId, userId, LEAGUE_ACTION.MANAGE_INVITES);
  if (!gate.ok) return gate;

  const rows = await db
    .select({ invite: leagueInvites, creator: users })
    .from(leagueInvites)
    .leftJoin(users, eq(leagueInvites.createdBy, users.id))
    // Revoked invites disappear from the commissioner's list — revocation
    // stays idempotent and a revoked code still 409s on join, this only trims
    // stale entries from the management view.
    .where(and(eq(leagueInvites.leagueId, leagueId), isNull(leagueInvites.revokedAt)))
    .orderBy(desc(leagueInvites.createdAt));

  return {
    ok: true,
    invites: rows.map((row) => serializeInviteRow(row.invite, row.creator)),
  };
}

export type RevokeInviteResult =
  { ok: true } | CommissionerGateFailure | { ok: false; reason: "invite_not_found" };

export async function revokeInvite(
  db: Db,
  clock: Clock,
  leagueId: string,
  code: string,
  userId: string,
): Promise<RevokeInviteResult> {
  const gate = await authorizeLeagueAction(db, leagueId, userId, LEAGUE_ACTION.MANAGE_INVITES);
  if (!gate.ok) return gate;

  const [invite] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, code));
  if (!invite || invite.leagueId !== leagueId) {
    return { ok: false, reason: "invite_not_found" };
  }

  // Idempotent: revoking an already-revoked invite keeps the original
  // revocation time — safe to double-submit.
  if (invite.revokedAt === null) {
    const now = clock.now();
    await db
      .update(leagueInvites)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(leagueInvites.id, invite.id));
  }
  return { ok: true };
}

/**
 * Everything the join screen needs: the league card plus whether POSTing the
 * join would succeed, and if not, the exact refusal (precedence documented on
 * JOIN_BLOCKED_REASON). Unknown code → null → 404.
 */
export async function getJoinPreview(
  db: Db,
  clock: Clock,
  code: string,
  userId: string,
): Promise<JoinPreviewResponse | null> {
  const [invite] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, code));
  if (!invite) return null;

  // The invite's league and its current instance (ADR-0009). An invite can't
  // outlive its league (FK cascade), so a missing current season is unexpected.
  const current = await getLeagueWithCurrentSeason(db, invite.leagueId);
  if (!current) return null;
  const { league, season } = current;

  const [memberCount, membership, startsAt] = await Promise.all([
    countMembers(db, league.id),
    getMembership(db, league.id, userId),
    leagueStartAt(db, { mode: league.mode, seasonId: season.seasonId }, season.settings),
  ]);

  let reason: JoinBlockedReason | null = null;
  if (inviteStatus(invite) !== INVITE_STATUS.ACTIVE) {
    reason = JOIN_BLOCKED_REASON.INVITE_REVOKED;
  } else if (membership) {
    reason = JOIN_BLOCKED_REASON.ALREADY_MEMBER;
  } else if (season.status !== LEAGUE_STATUS.ACTIVE) {
    reason = JOIN_BLOCKED_REASON.LEAGUE_CONCLUDED;
  } else if (!isPreStart(startsAt, clock)) {
    reason = JOIN_BLOCKED_REASON.JOIN_CLOSED;
  } else if (memberCount >= league.maxMembers) {
    reason = JOIN_BLOCKED_REASON.LEAGUE_FULL;
  }

  return {
    league: {
      id: league.id,
      name: league.name,
      mode: league.mode,
      visibility: league.visibility,
      memberCount,
      seasonYear: season.seasonYear,
      startsAt: startsAt ? startsAt.toISOString() : null,
    },
    joinable: reason === null,
    reason,
  };
}

export type JoinByCodeResult =
  | { ok: true; league: LeagueResponse }
  | { ok: false; reason: JoinBlockedReason | "invite_invalid" };

/**
 * Join via invite link (spec §Invites, §Membership). The use-count increment
 * is a guarded UPDATE (`revoked_at IS NULL` in the predicate) inside the same
 * transaction as the membership insert: concurrent joins and revocations
 * serialize on the row lock, so a revocation that lands between our status
 * read and the update turns the join away instead of slipping through; any
 * later refusal in the tx rolls the increment back (JoinRefusedError is
 * thrown, not returned, for exactly that). The count itself is informational
 * since ADR-0032 — nothing enforces on it.
 */
export async function joinByCode(
  db: Db,
  clock: Clock,
  code: string,
  userId: string,
): Promise<JoinByCodeResult> {
  try {
    const leagueId = await db.transaction(async (tx) => {
      const [invite] = await tx.select().from(leagueInvites).where(eq(leagueInvites.code, code));
      if (!invite) throw new InviteInvalidError();

      if (inviteStatus(invite) !== INVITE_STATUS.ACTIVE) {
        throw new JoinRefusedError(JOIN_BLOCKED_REASON.INVITE_REVOKED);
      }

      const updated = await tx
        .update(leagueInvites)
        .set({ useCount: sql`${leagueInvites.useCount} + 1`, updatedAt: clock.now() })
        .where(and(eq(leagueInvites.id, invite.id), isNull(leagueInvites.revokedAt)))
        .returning({ id: leagueInvites.id });
      if (updated.length === 0) {
        // Lost a race: a revocation landed between our status read and the
        // guarded update.
        throw new JoinRefusedError(JOIN_BLOCKED_REASON.INVITE_REVOKED);
      }

      // Locks the league row and re-reads league state post-lock (lock order:
      // invite row above, then league — same everywhere, so no cycles).
      await joinLeagueInTx(tx, clock, invite.leagueId, userId);
      return invite.leagueId;
    });

    const league = await getLeague(db, leagueId, userId);
    if (!league) throw new Error("Joined league unreadable immediately after join.");
    return { ok: true, league };
  } catch (error) {
    if (error instanceof InviteInvalidError || error instanceof LeagueMissingError) {
      return { ok: false, reason: "invite_invalid" };
    }
    if (error instanceof JoinRefusedError) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}

class InviteInvalidError extends Error {}

async function serializeInvite(db: Db, invite: InviteRow): Promise<Invite> {
  const creator = invite.createdBy
    ? ((await db.select().from(users).where(eq(users.id, invite.createdBy)))[0] ?? null)
    : null;
  return serializeInviteRow(invite, creator);
}

function serializeInviteRow(invite: InviteRow, creator: typeof users.$inferSelect | null): Invite {
  return {
    id: invite.id,
    code: invite.code,
    status: inviteStatus(invite),
    useCount: invite.useCount,
    revokedAt: invite.revokedAt ? invite.revokedAt.toISOString() : null,
    createdAt: invite.createdAt.toISOString(),
    createdBy: creator
      ? { userId: creator.id, username: creator.username, displayName: creator.display_name }
      : null,
  };
}
