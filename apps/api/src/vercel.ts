import { handle } from "hono/vercel";
import { loadEnv, resolveClock } from "@picksleagues/core";
import { createDb, getSimClockOffsetMs } from "@picksleagues/db";
import { createApp } from "./app";
import { createAuth } from "./auth";

// Module scope runs once per cold start; Fluid Compute reuses the instance
// (and its pg pool) across requests. A bad env config fails the cold start
// loudly instead of limping per-request.
const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const auth = createAuth({ env, db });

// Vercel's Node launcher only dispatches Web-signature handlers via named
// HTTP-method exports; a default export gets the legacy (req, res) calling
// convention and its returned Response is silently dropped — every API call
// hangs and the SPA white-screens on its session fetch.
const handler = handle(
  createApp({
    auth,
    db,
    clock: () => resolveClock(env.APP_ENV, () => getSimClockOffsetMs(db)),
  }),
);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
