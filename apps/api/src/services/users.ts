import { and, count, eq, gt, ne, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import {
  accounts,
  isUniqueViolation,
  leagueMembers,
  leagues,
  sessions,
  users,
} from "@picksleagues/db";
import { currentLeagueSeason, lockUserRow } from "./leagues";
import type { Clock } from "@picksleagues/core";
import {
  APP_ROLE,
  DELETED_USER_DISPLAY_NAME,
  LEAGUE_STATUS,
  MEMBER_ROLE,
  type AppRole,
  type DisplayName,
  type Username,
} from "@picksleagues/schemas";

export type UpdateProfileResult =
  { ok: true; user: typeof users.$inferSelect } | { ok: false; reason: "username_taken" };

const USERNAME_UNIQUE_CONSTRAINT = "users_username_unique";

/**
 * Updates the caller's profile fields (mvp-spec §Users & Identity): claiming
 * a username (first sign-in), changing it later (the old name is released
 * the instant this write commits, no separate release step), and editing the
 * freely-editable display name are all the same partial update. Only the
 * fields the caller supplied are set, so a display-name-only edit never
 * touches the username column. The `citext` unique constraint on
 * `users.username` is the race-proof uniqueness check (engineering rules
 * §Data & database) — no pre-check SELECT.
 */
export async function updateProfile(
  db: Db,
  clock: Clock,
  userId: string,
  fields: { username?: Username; displayName?: DisplayName },
): Promise<UpdateProfileResult> {
  try {
    const rows = await db
      .update(users)
      .set({
        ...(fields.username !== undefined ? { username: fields.username } : {}),
        ...(fields.displayName !== undefined ? { display_name: fields.displayName } : {}),
        updatedAt: clock.now(),
      })
      .where(eq(users.id, userId))
      .returning();
    const user = rows[0];
    if (!user) {
      // The caller only ever passes an authenticated session's own userId, so
      // the row always exists — this guards the type, not a real code path.
      throw new Error(`updateProfile: no user row for id ${userId}`);
    }
    return { ok: true, user };
  } catch (error) {
    if (isUniqueViolation(error, USERNAME_UNIQUE_CONSTRAINT)) {
      return { ok: false, reason: "username_taken" };
    }
    throw error;
  }
}

/** Plain lookup of the caller's own profile row for `GET /me`. */
export async function getUser(db: Db, userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  return rows[0] ?? null;
}

/**
 * The caller's app-wide role — the sole authorization source for admin
 * surfaces (ADR-0013). `null` means the user row is gone (session outlived it),
 * which is never admin.
 */
export async function getAppRole(db: Db, userId: string): Promise<AppRole | null> {
  const rows = await db.select({ appRole: users.appRole }).from(users).where(eq(users.id, userId));
  return rows[0]?.appRole ?? null;
}

/**
 * Grants the admin role to a user whose id is in the bootstrap seed list
 * (`ADMIN_USER_IDS`), so a fresh environment reaches its first admin with no
 * manual SQL (ADR-0013). Authorization itself never consults the seed list —
 * it reads `users.app_role`, which is what this writes.
 *
 * Runs on every session resolution, so it is deliberately free when the seed
 * list is empty (the normal case: no query at all) and a single primary-key
 * UPDATE that matches no rows once the grant has happened. One-way by design:
 * nothing here demotes, so dropping an id from the seed list leaves an existing
 * admin alone — revocation is a deliberate database change.
 *
 * `updated_at` is deliberately not stamped: it tracks profile edits (Better
 * Auth's adapter and `updateProfile` own it), and taking a `Clock` here would
 * mean resolving one a second time per request, which require-deps.ts keeps to
 * exactly once (arch D13).
 */
export async function seedAdminRole(
  db: Db,
  userId: string,
  seedUserIds: readonly string[],
): Promise<void> {
  if (!seedUserIds.includes(userId)) return;
  await db
    .update(users)
    .set({ appRole: APP_ROLE.ADMIN })
    .where(and(eq(users.id, userId), ne(users.appRole, APP_ROLE.ADMIN)));
}

/**
 * Deletes the caller's account (mvp-spec §Users & Identity, ID-3): the
 * `users` row is anonymized in place, never removed — future picks/results/
 * standings FK to it and that history must survive. `username` is released
 * immediately (NULL, same as a rename), `display_name` becomes the shared
 * deleted-user placeholder, `image` is cleared, and `email` is replaced with
 * a per-user `.invalid`-TLD placeholder (RFC 2606 reserved, and required
 * because the column is NOT NULL UNIQUE). All `accounts` (OAuth identities)
 * and `sessions` rows for the user are deleted, signing them out everywhere;
 * a later sign-in with the same provider creates a brand-new user.
 *
 * `verifications` is deliberately not swept: it has no userId FK, and
 * social-only OAuth (our only sign-in method) never mints rows there. If
 * email/OTP flows are ever added, revisit — its `identifier` can hold an email.
 *
 * Deletion is blocked (ADR-0004, same invariant as leaving a league, LG-6)
 * while the caller is the last commissioner of any non-empty active league —
 * they must promote a replacement first. Membership rows themselves survive
 * deletion (the anonymized user remains a member everywhere), so this is the
 * only league-side check deletion needs.
 */
export async function deleteAccount(
  db: Db,
  clock: Clock,
  userId: string,
): Promise<DeleteAccountResult> {
  return db.transaction(async (tx) => {
    // Serializes the invariant check against concurrent role mutations: lock
    // the user row (create/promote take it for cap counts) and every league
    // the user commissions (demote/kick/leave take the league row lock) —
    // without these, a concurrent demote could invalidate the guard's
    // snapshot between check and commit.
    await lockUserRow(tx, userId);
    await tx.execute(sql`
      select l.id from ${leagues} l
      join ${leagueMembers} m on m.league_id = l.id
      where m.user_id = ${userId} and m.role = ${MEMBER_ROLE.COMMISSIONER}
      for update of l
    `);

    if (await isLastCommissionerOfNonEmptyActiveLeague(tx, userId)) {
      return { ok: false as const, reason: "last_commissioner" as const };
    }

    await tx
      .update(users)
      .set({
        username: null,
        display_name: DELETED_USER_DISPLAY_NAME,
        image: null,
        email: `deleted-${userId}@deleted.invalid`,
        emailVerified: false,
        updatedAt: clock.now(),
      })
      .where(eq(users.id, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    return { ok: true as const };
  });
}

export type DeleteAccountResult = { ok: true } | { ok: false; reason: "last_commissioner" };

/**
 * True when any active league would be left commissioner-less but not
 * member-less by this user's departure — the ADR-0004 invariant, evaluated
 * inside the deletion transaction. "Active" is the league's CURRENT instance
 * being ACTIVE (ADR-0009): join the current season and filter status, so a
 * league with a concluded past instance never counts.
 */
async function isLastCommissionerOfNonEmptyActiveLeague(db: Db, userId: string): Promise<boolean> {
  const commissionerCount = db
    .select({ value: count() })
    .from(leagueMembers)
    .where(
      and(eq(leagueMembers.leagueId, leagues.id), eq(leagueMembers.role, MEMBER_ROLE.COMMISSIONER)),
    );
  const memberCount = db
    .select({ value: count() })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, leagues.id));

  const current = currentLeagueSeason(db);
  const rows = await db
    .select({ id: leagues.id })
    .from(leagues)
    .innerJoin(
      leagueMembers,
      and(
        eq(leagueMembers.leagueId, leagues.id),
        eq(leagueMembers.userId, userId),
        eq(leagueMembers.role, MEMBER_ROLE.COMMISSIONER),
      ),
    )
    .innerJoin(current, and(eq(current.leagueId, leagues.id), eq(current.rank, 1)))
    .where(
      and(eq(current.status, LEAGUE_STATUS.ACTIVE), eq(commissionerCount, 1), gt(memberCount, 1)),
    )
    .limit(1);
  return rows.length > 0;
}
