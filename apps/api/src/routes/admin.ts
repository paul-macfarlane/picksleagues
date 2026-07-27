import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  AdminGameOddsResponseSchema,
  AdminGamesResponseSchema,
  AdminSeasonsResponseSchema,
  AdminTeamsResponseSchema,
  ERROR_CODE,
  ErrorResponseSchema,
  NflSyncJobSchema,
  SportSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import {
  errorResponse,
  MISCONFIGURED_500,
  NOT_ADMIN_403,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import {
  jobRunResponses,
  misconfiguredJob,
  NFL_SYNC_JOBS,
  resolveNflJobDeps,
  SyncQuerySchema,
} from "../lib/nfl-sync-jobs";
import { runJob } from "../lib/job-runner";
import {
  requireAdmin,
  requireDbAndClock,
  requireSession,
  type DepsVariables,
} from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import { listGameOdds, listSeasons, listTeams, listWeekGames } from "../services/admin-data";
import { REBUILD_JOB_NAME, SETTLE_SWEEP_JOB_NAME } from "../lib/settlement-job";
import { rebuildLeagueSeason, settleSweep } from "../services/settlement/pickem";
import { getLeagueWithCurrentSeason } from "../services/leagues/current-season";

const AdminNflJobParamsSchema = z.object({ job: NflSyncJobSchema });

const runAdminNflJobRoute = createRoute({
  method: "post",
  path: "/admin/jobs/nfl/{job}",
  operationId: "runAdminNflJob",
  summary: "Manually trigger an NFL data sync job",
  request: { params: AdminNflJobParamsSchema, query: SyncQuerySchema },
  responses: {
    200: jobRunResponses[200],
    400: errorResponse(
      "Invalid job slug, or a supplied query param (season/week) fails its format rule",
    ),
    401: UNAUTHENTICATED_401,
    403: NOT_ADMIN_403,
    500: jobRunResponses[500],
  },
});

const runAdminSettleSweepRoute = createRoute({
  method: "post",
  path: "/admin/jobs/settle-sweep",
  operationId: "runAdminSettleSweep",
  summary: "Manually trigger the settlement reconciliation sweep",
  responses: {
    200: jobRunResponses[200],
    401: UNAUTHENTICATED_401,
    403: NOT_ADMIN_403,
    500: jobRunResponses[500],
  },
});

const rebuildLeagueRoute = createRoute({
  method: "post",
  path: "/admin/leagues/{leagueId}/rebuild",
  operationId: "rebuildLeagueStandings",
  summary: "Recompute one league's results and standings from stored picks and game results",
  request: { params: z.object({ leagueId: z.uuid() }) },
  responses: {
    200: jobRunResponses[200],
    400: errorResponse("The league id failed its format rule"),
    401: UNAUTHENTICATED_401,
    403: NOT_ADMIN_403,
    404: errorResponse("No such league (league_not_found)"),
    500: jobRunResponses[500],
  },
});

// Every browser is scoped to one sport rather than defaulting to "all": a
// second sport (NCAAMB) lands with the March Madness epic and would otherwise
// silently double the list.
const SportQuerySchema = z.object({ sport: SportSchema });

const browserResponses = {
  400: errorResponse("A request param failed its format rule"),
  401: UNAUTHENTICATED_401,
  403: NOT_ADMIN_403,
  500: MISCONFIGURED_500,
};

const listAdminTeamsRoute = createRoute({
  method: "get",
  path: "/admin/teams",
  operationId: "listAdminTeams",
  summary: "Browse synced teams for a sport",
  request: { query: SportQuerySchema },
  responses: {
    200: {
      description: "Every team row for the sport, ordered by abbreviation",
      content: { "application/json": { schema: AdminTeamsResponseSchema } },
    },
    ...browserResponses,
  },
});

const listAdminSeasonsRoute = createRoute({
  method: "get",
  path: "/admin/seasons",
  operationId: "listAdminSeasons",
  summary: "Browse synced seasons and their weeks for a sport",
  request: { query: SportQuerySchema },
  responses: {
    200: {
      description: "Seasons newest-first, each with its weeks in chronological order",
      content: { "application/json": { schema: AdminSeasonsResponseSchema } },
    },
    ...browserResponses,
  },
});

const listAdminGamesRoute = createRoute({
  method: "get",
  path: "/admin/games",
  operationId: "listAdminGames",
  summary: "Browse a week's games with provider, override, and resolved values",
  request: { query: z.object({ weekId: z.uuid() }) },
  responses: {
    200: {
      description:
        "The week's games ordered by resolved kickoff — empty for an unknown week id, which is indistinguishable from a week with no games synced yet",
      content: { "application/json": { schema: AdminGamesResponseSchema } },
    },
    ...browserResponses,
  },
});

const listAdminGameOddsRoute = createRoute({
  method: "get",
  path: "/admin/games/{gameId}/odds",
  operationId: "listAdminGameOdds",
  summary: "Browse a game's most recent odds snapshots",
  request: { params: z.object({ gameId: z.uuid() }) },
  responses: {
    200: {
      description: "The game's most recent spread snapshots, newest first",
      content: { "application/json": { schema: AdminGameOddsResponseSchema } },
    },
    ...browserResponses,
    404: errorResponse("No such game"),
  },
});

/**
 * The role-gated admin surface (ADR-0011): manual sync-job triggers plus
 * the read-only reference-data browsers those triggers are verified with (arch
 * §Manual Sports Data Overrides). Mounted unconditionally in app.ts — the admin
 * surface exists in every env and is gated server-side by `users.app_role`
 * (ADR-0013), not by env registration (that is the simulator routes' mechanism).
 *
 * Triggers exist because the SPA can't hold the cron shared secret; they
 * dispatch to the identical service calls as `/api/jobs/nfl/*` via the shared
 * `NFL_SYNC_JOBS` registry.
 */
export function adminRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  app.use("/admin/*", requireSession(deps));
  app.use("/admin/*", requireAdmin(deps));
  // Scoped to the browser routes rather than `/admin/*`: the job route resolves
  // deps itself so its misconfiguration 500 keeps the JobRunResponse shape.
  for (const path of ["/admin/teams", "/admin/seasons", "/admin/games", "/admin/games/*"]) {
    app.use(path, requireDbAndClock(deps));
  }

  app.openapi(runAdminNflJobRoute, async (c) => {
    const { job } = c.req.valid("param");
    const entry = NFL_SYNC_JOBS[job];
    const resolved = await resolveNflJobDeps(deps);
    if (!resolved) {
      return c.json(misconfiguredJob(entry.jobName), 500);
    }
    const { season, week, weekType } = c.req.valid("query");
    return runJob(c, entry.jobName, () =>
      entry.run(resolved.db, resolved.clock, resolved.provider, {
        seasonYear: season,
        weekType,
        weekNumber: week,
      }),
    );
  });

  app.openapi(runAdminSettleSweepRoute, async (c) => {
    const { db, clock: resolveClock } = deps;
    if (!db || !resolveClock) return c.json(misconfiguredJob(SETTLE_SWEEP_JOB_NAME), 500);
    const clock = await resolveClock();
    return runJob(c, SETTLE_SWEEP_JOB_NAME, () => settleSweep(db, clock));
  });

  app.openapi(rebuildLeagueRoute, async (c) => {
    const { db, clock: resolveClock } = deps;
    if (!db || !resolveClock) return c.json(misconfiguredJob(REBUILD_JOB_NAME), 500);
    const clock = await resolveClock();
    const { leagueId } = c.req.valid("param");

    // Rebuild targets the league's current instance (ADR-0009) — the one whose
    // picks and standings are live.
    const current = await getLeagueWithCurrentSeason(db, leagueId);
    if (!current) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.LEAGUE_NOT_FOUND,
          message: "League not found.",
        }),
        404,
      );
    }

    return runJob(c, REBUILD_JOB_NAME, () => rebuildLeagueSeason(db, clock, current.season.id));
  });

  app.openapi(listAdminTeamsRoute, async (c) => {
    const { sport } = c.req.valid("query");
    return c.json({ teams: await listTeams(c.get("db"), sport) }, 200);
  });

  app.openapi(listAdminSeasonsRoute, async (c) => {
    const { sport } = c.req.valid("query");
    return c.json({ seasons: await listSeasons(c.get("db"), sport) }, 200);
  });

  app.openapi(listAdminGamesRoute, async (c) => {
    const { weekId } = c.req.valid("query");
    return c.json({ games: await listWeekGames(c.get("db"), weekId) }, 200);
  });

  app.openapi(listAdminGameOddsRoute, async (c) => {
    const { gameId } = c.req.valid("param");
    const snapshots = await listGameOdds(c.get("db"), gameId);
    if (!snapshots) {
      return c.json(
        ErrorResponseSchema.parse({ error: ERROR_CODE.GAME_NOT_FOUND, message: "Game not found." }),
        404,
      );
    }
    return c.json({ snapshots }, 200);
  });

  return app;
}
