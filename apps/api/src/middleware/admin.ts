import type { MiddlewareHandler } from "hono";
import { ERROR_CODE, ErrorResponseSchema } from "@picksleagues/schemas";
import type { SessionVariables } from "./session";

/**
 * Requires the caller's session user to be in the admin allowlist; 403s
 * otherwise. Must run after `sessionMiddleware`/`requireSession` — reads
 * `sessionUser` off the context rather than re-deriving it. Admin capability
 * is the env-var user-ID allowlist (`ADMIN_USER_IDS`), not a role column
 * (arch §Overrides).
 */
export function adminMiddleware(
  adminUserIds: string[],
): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const sessionUser = c.get("sessionUser");
    if (!adminUserIds.includes(sessionUser.id)) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.NOT_ADMIN,
          message: "Admin access required.",
        }),
        403,
      );
    }
    await next();
  };
}
