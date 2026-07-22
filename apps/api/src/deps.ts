import type { Db } from "@picksleagues/db";
import type { Clock, Env, GameDataProvider } from "@picksleagues/core";
import type { Auth } from "./auth";

/**
 * Dependencies threaded into `createApp` and the route factories it mounts.
 * All optional: `generate-openapi.ts` calls `createApp()` with none so the
 * committed spec still reflects every route (handlers never execute during
 * generation), and each real entrypoint (dev.ts, vercel.ts) supplies them all.
 */
export type AppDeps = {
  auth?: Auth;
  db?: Db;
  clock?: () => Promise<Clock>;
  env?: Env;
  // The sports-data source sync jobs ingest from (arch §External Data). ESPN in
  // every environment today; the future SimulatedProvider swaps in here.
  provider?: GameDataProvider;
};
