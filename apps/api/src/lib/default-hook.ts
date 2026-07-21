import type { Hook } from "@hono/zod-openapi";
import { ErrorResponseSchema, type ErrorResponse } from "@picksleagues/schemas";

/**
 * Every `OpenAPIHono` sub-app (the top-level app and each route module it
 * mounts) needs its own `defaultHook` — Hono has no way to inherit a parent's
 * — so this lives here once and gets imported everywhere instead of being
 * restated per file. Zod validation failures (body/query/params) get the
 * shared error envelope instead of `@hono/zod-openapi`'s default shape.
 */
// `any` here mirrors @hono/zod-openapi's own `OpenAPIHonoOptions.defaultHook`
// type (`Hook<any, E, any, any>`) — a validation hook is deliberately generic
// over every route's input/env/path, so there's no narrower type to give it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const zodValidationHook: Hook<any, any, any, any> = (result, c) => {
  if (result.success) return;
  const [issue] = result.error.issues;
  const body: ErrorResponse = {
    error: "validation",
    message: issue?.message ?? "Invalid request.",
  };
  return c.json(ErrorResponseSchema.parse(body), 400);
};
