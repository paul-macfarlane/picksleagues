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
  /**
   * The sports-data source sync jobs ingest from (arch §External Data), resolved
   * per request like `clock`: ESPN by default in every environment, the
   * `SimulatedProvider` when a scenario is loaded in non-prod (ADR-0012).
   *
   * Takes the caller's already-resolved `Clock` so the simulated provider
   * projects fixtures at the exact instant the rest of the request uses — a
   * second independently-resolved clock could straddle a kickoff boundary.
   */
  provider?: (clock: Clock) => Promise<GameDataProvider>;
  /**
   * The real provider, never the simulated one. Only the replay importer needs
   * it: it reaches ESPN for a past season *while* a scenario is loaded, which is
   * exactly when `provider` would hand back fixtures instead.
   */
  espnProvider?: GameDataProvider;
};
