import { and, asc, count, eq, gt, sql } from "drizzle-orm";
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
  MEMBER_ROLE,
  type AppRole,
  type DisplayName,
  type ImageUrl,
  type Username,
} from "@picksleagues/schemas";

/**
 * The avatar to show for a user: the member's own URL when they've set one,
 * otherwise the OAuth provider's (ADR-0022) — the same
 * `override_* ?? provider_*` precedence the sports tables use.
 *
 * Every surface that serializes a user's avatar must call this. Both columns
 * are `string | null`, so a serializer that reaches for the wrong one type-checks
 * cleanly and ships the wrong picture — there is no compiler to catch it, which
 * is why the resolution has exactly one home.
 *
 * Structurally typed rather than taking a `users` row: the standings query
 * selects a narrow projection and must be able to pass it.
 */
export function resolveUserImage(user: {
  image: string | null;
  imageOverride: string | null;
}): string | null {
  return user.imageOverride ?? user.image;
}

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
 *
 * `imageOverride` is tri-state (ADR-0022) and the `!== undefined` test is what
 * carries it: an absent key never touches the column, while an explicit `null`
 * writes SQL NULL and reverts the member to their provider avatar. The
 * provider's own `users.image` is never written here.
 */
export async function updateProfile(
  db: Db,
  clock: Clock,
  userId: string,
  fields: { username?: Username; displayName?: DisplayName; imageOverride?: ImageUrl | null },
): Promise<UpdateProfileResult> {
  try {
    const rows = await db
      .update(users)
      .set({
        ...(fields.username !== undefined ? { username: fields.username } : {}),
        ...(fields.displayName !== undefined ? { display_name: fields.displayName } : {}),
        ...(fields.imageOverride !== undefined ? { imageOverride: fields.imageOverride } : {}),
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
 * while the caller is the last commissioner of any non-empty league, concluded
 * ones included — they must promote a replacement first. Membership rows survive
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

    if ((await listAccountDeletionBlockingLeagues(tx, userId)).length > 0) {
      return { ok: false as const, reason: "last_commissioner" as const };
    }

    await tx
      .update(users)
      .set({
        username: null,
        display_name: DELETED_USER_DISPLAY_NAME,
        image: null,
        // The tombstone row keeps rendering on every league surface it has
        // history on, so a member-set URL left here would keep fetching a live
        // third party — and logging the viewer's IP to it — under "Deleted
        // User", indefinitely.
        imageOverride: null,
        email: `deleted-${userId}@deleted.invalid`,
        emailVerified: false,
        // The row survives deletion (FK history), so it must not survive
        // holding a capability — a deleted admin's tombstone is never admin.
        appRole: APP_ROLE.USER,
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
 * The leagues that would be left commissioner-less but not member-less by this
 * user's departure — the ADR-0004 invariant. `deleteAccount` refuses while this
 * is non-empty (evaluated inside its transaction); the profile's Danger Zone
 * reads the same list to disable Delete *before* the click and name the leagues
 * needing a replacement promoted, so both surfaces derive from one query and
 * cannot disagree about what blocks (backlog FB-13).
 *
 * **A concluded league counts** (owner, LG-12). The guard used to filter the
 * current instance to `ACTIVE`, which was vacuous while nothing wrote
 * `concluded`; ADR-0030 gave that column a writer, and the filter would have
 * quietly let the sole commissioner of a finished league delete their account.
 * A finished league is not a disposable one — renewing it into the next season
 * is a commissioner-only action (`LEAGUE_ACTION.RENEW_SEASON`), and no code path
 * grants the role — so the league would sit inert on every remaining member's
 * dashboard with nobody able to act on it ever again.
 */
export async function listAccountDeletionBlockingLeagues(
  db: Db,
  userId: string,
): Promise<Array<{ id: string; name: string }>> {
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
  return db
    .select({ id: leagues.id, name: leagues.name })
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
    .where(and(eq(commissionerCount, 1), gt(memberCount, 1)))
    .orderBy(asc(leagues.name));
}
