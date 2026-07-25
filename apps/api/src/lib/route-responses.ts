import { ErrorResponseSchema } from "@picksleagues/schemas";

/**
 * Response descriptors shared across every route file that needs them — kept
 * as one source so the committed OpenAPI spec's description strings can't
 * drift between routes that mean the same thing.
 */
export const MISCONFIGURED_500 = {
  description:
    "Server misconfiguration — structurally unreachable outside generate-openapi.ts, which builds the app with no deps and only ever requests the spec document, never invoking this handler.",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

export const UNAUTHENTICATED_401 = {
  description: "No valid session",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

export const NOT_COMMISSIONER_403 = {
  description: "The caller is a member but not a commissioner",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

export const NOT_ADMIN_403 = {
  description: "The caller is signed in but does not hold the admin role",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

export const LEAGUE_NOT_FOUND_404 = {
  description:
    "No such league, or the caller is not a member — indistinguishable so private leagues stay hidden",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

/** Builder for the one-off response descriptions each route still owns (400/404/409 specifics). */
export function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: ErrorResponseSchema } },
  };
}
