import { handle } from "hono/vercel";
import { loadEnv } from "@picksleagues/core";
import { createApp } from "./app";
import { createRuntimeDeps } from "./runtime";

// Module scope runs once per cold start; Fluid Compute reuses the instance
// (and its pg pool) across requests. A bad env config fails the cold start
// loudly instead of limping per-request.
const env = loadEnv();

// Vercel's Node launcher only dispatches Web-signature handlers via named
// HTTP-method exports; a default export gets the legacy (req, res) calling
// convention and its returned Response is silently dropped — every API call
// hangs and the SPA white-screens on its session fetch.
const handler = handle(createApp(createRuntimeDeps(env)));

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
