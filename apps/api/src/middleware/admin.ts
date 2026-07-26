import type { MiddlewareHandler } from "hono";
import { APP_ROLE, ERROR_CODE, ErrorResponseSchema } from "@picksleagues/schemas";
import type { Db } from "@picksleagues/db";
import { getAppRole } from "../services/users";
import type { SessionVariables } from "./session";

/**
 * Requires the caller's session user to hold the admin role; 403s otherwise.
 * Must run after `sessionMiddleware`/`requireSession` — reads `sessionUser` off
 * the context rather than re-deriving it. `users.app_role` is the sole
 * authorization source (ADR-0013) and is granted by a direct database update,
 * so a role change takes effect on the next request without a redeploy.
 */
export function adminMiddleware(db: Db): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const sessionUser = c.get("sessionUser");
    if ((await getAppRole(db, sessionUser.id)) !== APP_ROLE.ADMIN) {
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
