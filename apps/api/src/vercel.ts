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
const app = handle(createApp(createRuntimeDeps(env)));

// `/join/<code>` is routed to this function so a pasted invite link unfurls
// with the league's name (ADR-0038), but the app is mounted under `/api` and a
// preview bot asks for the public path. Normalised here rather than with a
// `dest` rewrite in the routing config: the platform's contract about which
// path a function is handed on a rewrite is one this repo can't test locally,
// and getting it wrong would serve every invite link a 404 in production only.
// Doing it in our own handler makes the mapping true whichever path arrives.
const INVITE_PATH = /^\/join\/([^/?#]+)\/?$/;

const handler = (request: Request): Response | Promise<Response> => {
  const url = new URL(request.url);
  const code = INVITE_PATH.exec(url.pathname)?.[1];
  if (!code) return app(request);
  url.pathname = `/api/invite-preview/${code}`;
  return app(new Request(url, request));
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
