import type { MiddlewareHandler } from "hono";
import { ERROR_CODE, ErrorResponseSchema } from "@picksleagues/schemas";
import type { Auth } from "../auth";

/** The authenticated caller, typed from Better Auth's own inference — never hand-restated. */
export type SessionUser = Auth["$Infer"]["Session"]["user"];

export type SessionVariables = {
  sessionUser: SessionUser;
};

/**
 * Requires a valid Better Auth session cookie; 401s otherwise. Cheap to run
 * per-request since it delegates to Better Auth's own session lookup rather
 * than re-deriving anything from the cookie ourselves.
 */
export function sessionMiddleware(auth: Auth): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.UNAUTHENTICATED,
          message: "Sign in to continue.",
        }),
        401,
      );
    }
    c.set("sessionUser", session.user);
    await next();
  };
}
