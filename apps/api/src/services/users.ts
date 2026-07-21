import { eq } from "drizzle-orm";
import { DatabaseError } from "pg";
import type { Db } from "@picksleagues/db";
import { users } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import type { DisplayName, Username } from "@picksleagues/schemas";

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
    // drizzle-orm wraps the driver error in a DrizzleQueryError; the pg
    // DatabaseError we care about is its `.cause`.
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      cause instanceof DatabaseError &&
      cause.code === "23505" &&
      cause.constraint === USERNAME_UNIQUE_CONSTRAINT
    ) {
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
