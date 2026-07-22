import type { Db } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import type { Auth } from "./auth";

/**
 * Dependencies threaded into `createApp` and the route factories it mounts.
 * All optional: `generate-openapi.ts` calls `createApp()` with none so the
 * committed spec still reflects every route (handlers never execute during
 * generation), and each real entrypoint (dev.ts, vercel.ts) supplies all three.
 */
export type AppDeps = {
  auth?: Auth;
  db?: Db;
  clock?: () => Promise<Clock>;
};
