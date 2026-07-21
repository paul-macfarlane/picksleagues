import { eq } from "drizzle-orm";
import { DatabaseError } from "pg";
import type { Db } from "@picksleagues/db";
import { users } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import type { Username } from "@picksleagues/schemas";

export type ClaimUsernameResult =
  { ok: true; user: typeof users.$inferSelect } | { ok: false; reason: "username_taken" };

const USERNAME_UNIQUE_CONSTRAINT = "users_username_unique";

/**
 * Claims or changes the caller's username (mvp-spec §Users & Identity: the
 * same operation covers first-sign-in claim and later renames — the old name
 * is released the instant this write commits, no separate release step). The
 * `citext` unique constraint on `users.username` is the race-proof uniqueness
 * check (engineering rules §Data & database) — no pre-check SELECT.
 */
export async function claimUsername(
  db: Db,
  clock: Clock,
  userId: string,
  username: Username,
): Promise<ClaimUsernameResult> {
  try {
    const rows = await db
      .update(users)
      .set({ username, updatedAt: clock.now() })
      .where(eq(users.id, userId))
      .returning();
    const user = rows[0];
    if (!user) {
      // The caller only ever passes an authenticated session's own userId, so
      // the row always exists — this guards the type, not a real code path.
      throw new Error(`claimUsername: no user row for id ${userId}`);
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
