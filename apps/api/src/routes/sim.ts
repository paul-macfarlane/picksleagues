import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ERROR_CODE,
  ErrorResponseSchema,
  SimClockAdjustmentSchema,
  SimFixtureGameSchema,
  SimFixtureGamesResponseSchema,
  SimReplayRequestSchema,
  SimResetRequestSchema,
  SimResetResponseSchema,
  SimSettleRequestSchema,
  SimSettleResponseSchema,
  SimStateResponseSchema,
  UpdateSimFixtureGameRequestSchema,
  WeekTypeSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { runJob } from "../lib/job-runner";
import { jobRunResponses, misconfiguredJob, resolveJobDeps } from "../lib/nfl-sync-jobs";
import {
  errorResponse,
  MISCONFIGURED_500,
  NOT_ADMIN_403,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import {
  requireAdmin,
  requireDbAndClock,
  requireSession,
  type DepsVariables,
} from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import { adjustSimClock, readRealNow } from "../services/sim/clock";
import { listFixtureGames, updateFixtureGame } from "../services/sim/fixtures";
import { importReplaySeason, isReplayableSeasonYear } from "../services/sim/replay";
import { resetSimEnvironment } from "../services/sim/reset";
import { settleForSim } from "../services/sim/settle";
import { loadScenario, readSimState } from "../services/sim/state";

const REPLAY_JOB_NAME = "sim-import-replay";

// Every sim route sits behind the same session + admin-role pair, so they share
// one descriptor set rather than restating it per route (ADR-0011: these are
// admin-session gated, not shared-secret gated).
const simResponses = {
  400: errorResponse("A request param or body field fails its format rule"),
  401: UNAUTHENTICATED_401,
  403: NOT_ADMIN_403,
  500: MISCONFIGURED_500,
};

const stateResponse = {
  description: "The simulator's current clock, active scenario, and everything loadable",
  content: { "application/json": { schema: SimStateResponseSchema } },
};

const getSimStateRoute = createRoute({
  method: "get",
  path: "/sim/state",
  operationId: "getSimState",
  summary: "Read the simulated clock, the active scenario, and the scenario library",
  responses: { 200: stateResponse, ...simResponses },
});

const setSimClockRoute = createRoute({
  method: "post",
  path: "/sim/clock",
  operationId: "setSimClock",
  summary: "Set, advance, or reset the simulated clock",
  request: {
    body: { content: { "application/json": { schema: SimClockAdjustmentSchema } } },
  },
  responses: {
    200: {
      description:
        "Simulator state with the clock as adjusted; the stored offset governs every request from this one onward. Fixture projections are not part of this response — read GET /sim/fixtures/games to see how the new instant projects them",
      content: { "application/json": { schema: SimStateResponseSchema } },
    },
    ...simResponses,
    404: errorResponse("No such week, or the week has no games to anchor a jump to"),
  },
});

const loadSimScenarioRoute = createRoute({
  method: "post",
  path: "/sim/scenarios/{slug}/load",
  operationId: "loadSimScenario",
  summary: "Load a scenario's fixtures and make it the active data source",
  request: { params: z.object({ slug: z.string().min(1).max(100) }) },
  responses: {
    200: stateResponse,
    ...simResponses,
    404: errorResponse("No library definition and no stored scenario with that slug"),
  },
});

const importSimReplayRoute = createRoute({
  method: "post",
  path: "/sim/scenarios/replay",
  operationId: "importSimReplay",
  summary: "Import a real past ESPN season into fixtures for replay",
  request: {
    body: { content: { "application/json": { schema: SimReplayRequestSchema } } },
  },
  // Shares the job envelope: it is a long provider-driven ingest with counters,
  // idempotent by slug, and the admin page already renders this shape.
  responses: {
    200: jobRunResponses[200],
    400: errorResponse(
      "Malformed body, or the requested season isn't finished — only past seasons can be replayed",
    ),
    401: UNAUTHENTICATED_401,
    403: NOT_ADMIN_403,
    500: jobRunResponses[500],
  },
});

const listSimFixtureGamesRoute = createRoute({
  method: "get",
  path: "/sim/fixtures/games",
  operationId: "listSimFixtureGames",
  summary: "Browse a scenario's fixture games with their projection at the simulated now",
  request: {
    query: z.object({
      scenarioId: z.uuid(),
      weekType: WeekTypeSchema.optional(),
      weekNumber: z.coerce.number().int().min(1).max(18).optional(),
    }),
  },
  responses: {
    200: {
      description:
        "The scenario's fixtures ordered by kickoff — empty for an unknown scenario id, indistinguishable from a scenario with no fixtures written",
      content: { "application/json": { schema: SimFixtureGamesResponseSchema } },
    },
    ...simResponses,
  },
});

const updateSimFixtureGameRoute = createRoute({
  method: "patch",
  path: "/sim/fixtures/games/{gameId}",
  operationId: "updateSimFixtureGame",
  summary: "Hand-edit one fixture game's kickoff, week, spread, or result",
  request: {
    params: z.object({ gameId: z.uuid() }),
    body: { content: { "application/json": { schema: UpdateSimFixtureGameRequestSchema } } },
  },
  responses: {
    200: {
      description: "The updated fixture — re-run the sync jobs to ingest the change",
      content: { "application/json": { schema: SimFixtureGameSchema } },
    },
    ...simResponses,
    400: errorResponse(
      "No fields supplied, a field fails its format rule, or the edit would leave the fixture final without both scores",
    ),
    404: errorResponse("No such fixture game"),
  },
});

const resetSimRoute = createRoute({
  method: "post",
  path: "/sim/reset",
  operationId: "resetSim",
  summary: "Wipe a test league, or the whole environment, back to a known state",
  request: {
    body: { content: { "application/json": { schema: SimResetRequestSchema } } },
  },
  responses: {
    200: {
      description: "Per-table deleted row counts and the simulator state afterwards",
      content: { "application/json": { schema: SimResetResponseSchema } },
    },
    ...simResponses,
    404: errorResponse("League scope: no such league"),
  },
});

const settleSimRoute = createRoute({
  method: "post",
  path: "/sim/settle",
  operationId: "settleSim",
  summary:
    "Rebuild one league season (or every active one) at the simulated now, and inspect the result",
  request: {
    body: { content: { "application/json": { schema: SimSettleRequestSchema } } },
  },
  responses: {
    200: {
      description:
        "The rebuilt pickem_pick_results/pickem_standings, read back from the tables — leagues ordered by name, weeks by start, standings by rank then display name",
      content: { "application/json": { schema: SimSettleResponseSchema } },
    },
    ...simResponses,
    404: errorResponse("`leagueId` supplied but no such league"),
  },
});

/**
 * The simulator's control surface (SIM-2/3/6; spec §Testing & Internal Tooling).
 *
 * Registered by app.ts **only outside production** — non-registration is the
 * load-bearing gate (ADR-0011), and the session + admin-role guards below are
 * the second line, not the first.
 *
 * These routes *are* in the committed OpenAPI contract (ADR-0012 decision 5):
 * `generate-openapi.ts` builds the app with no env, which is not production, so
 * the SPA can reach them through the generated client like any other endpoint.
 * The contract documenting them is not the same thing as production serving
 * them — production registers no handler at all.
 */
export function simRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  app.use("/sim/*", requireSession(deps));
  app.use("/sim/*", requireAdmin(deps));
  // Scoped past the replay route, which resolves deps itself so its
  // misconfiguration 500 keeps the JobRunResponse shape (the admin job route
  // makes the same trade for the same reason).
  for (const path of ["/sim/state", "/sim/clock", "/sim/reset", "/sim/settle", "/sim/fixtures/*"]) {
    app.use(path, requireDbAndClock(deps));
  }
  app.use("/sim/scenarios/:slug/load", requireDbAndClock(deps));

  app.openapi(getSimStateRoute, async (c) => {
    return c.json(await readSimState(c.get("db"), c.get("clock")), 200);
  });

  app.openapi(setSimClockRoute, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const result = await adjustSimClock(db, clock, c.req.valid("json"));
    if (!result.ok) {
      // Exhaustive: a third refusal reason must not silently inherit another's copy.
      let message: string;
      switch (result.reason) {
        case ERROR_CODE.WEEK_NOT_FOUND:
          message = "No such week.";
          break;
        case ERROR_CODE.WEEK_HAS_NO_GAMES:
          message = "That week has no games to anchor the clock to.";
          break;
      }
      return c.json(ErrorResponseSchema.parse({ error: result.reason, message }), 404);
    }
    // Re-read rather than returning only the clock: moving time changes what
    // every fixture projects to, and the panel renders both together. The
    // adjustment's own clock state is passed through because this request's
    // `Clock` still carries the pre-write offset.
    return c.json(await readSimState(db, clock, result.state), 200);
  });

  app.openapi(loadSimScenarioRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const result = await loadScenario(c.get("db"), c.get("clock"), slug);
    if (!result.ok) {
      return c.json(
        ErrorResponseSchema.parse({ error: result.reason, message: "No such scenario." }),
        404,
      );
    }
    return c.json(result.state, 200);
  });

  app.openapi(importSimReplayRoute, async (c) => {
    const resolved = await resolveJobDeps(deps);
    const { espnProvider } = deps;
    if (!resolved || !espnProvider) {
      return c.json(misconfiguredJob(REPLAY_JOB_NAME), 500);
    }
    const { db, clock } = resolved;
    const { seasonYear } = c.req.valid("json");

    // Real time, not simulated: a loaded replay parks the clock inside the very
    // season an operator would want to re-import.
    const { realNowMs } = await readRealNow(db, clock);
    const realNow = new Date(realNowMs);

    // Asking for a season that hasn't finished is a client mistake, so it is a
    // typed 400 like every other refusal on this router — not a thrown error
    // dressed up as a job failure, which would log at error level and read as
    // an outage.
    if (!isReplayableSeasonYear(realNow, seasonYear)) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.SEASON_NOT_AVAILABLE,
          message: `The ${seasonYear} season isn't finished — only past seasons can be replayed.`,
        }),
        400,
      );
    }

    return runJob(c, REPLAY_JOB_NAME, async () => {
      // Deliberately the ESPN provider, never the resolved one: importing a past
      // season while a scenario is loaded must reach the real provider, not the
      // fixtures it would otherwise be handed (ADR-0012).
      const result = await importReplaySeason(db, clock, espnProvider, seasonYear, realNow);
      if (!result.ok) {
        // Reachable only when the provider has no data for a season that passed
        // the guard above — an upstream data problem, not a client error. That
        // is a genuine job failure: it logs with context and returns non-2xx so
        // the failure is visible (ADR-0007).
        throw new Error(`The provider published no schedule for ${seasonYear}.`);
      }
      return result.details;
    });
  });

  app.openapi(listSimFixtureGamesRoute, async (c) => {
    const { scenarioId, weekType, weekNumber } = c.req.valid("query");
    const games = await listFixtureGames(c.get("db"), c.get("clock"), {
      scenarioId,
      weekType,
      weekNumber,
    });
    return c.json({ games }, 200);
  });

  app.openapi(updateSimFixtureGameRoute, async (c) => {
    const { gameId } = c.req.valid("param");
    const result = await updateFixtureGame(
      c.get("db"),
      c.get("clock"),
      gameId,
      c.req.valid("json"),
    );
    if (!result.ok) {
      // Two distinct refusals, so the mapping is exhaustive rather than a
      // catch-all 404: an incoherent edit is the caller's mistake, not a
      // missing row.
      switch (result.reason) {
        case ERROR_CODE.FIXTURE_NOT_FOUND:
          return c.json(
            ErrorResponseSchema.parse({ error: result.reason, message: "No such fixture game." }),
            404,
          );
        case ERROR_CODE.VALIDATION:
          return c.json(
            ErrorResponseSchema.parse({ error: result.reason, message: result.message }),
            400,
          );
      }
    }
    return c.json(result.game, 200);
  });

  app.openapi(resetSimRoute, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const request = c.req.valid("json");
    const result = await resetSimEnvironment(db, clock, request);
    if (!result.ok) {
      return c.json(
        ErrorResponseSchema.parse({ error: result.reason, message: "No such league." }),
        404,
      );
    }
    return c.json(
      {
        scope: request.scope,
        deleted: result.deleted,
        state: await readSimState(db, clock, result.clock),
      },
      200,
    );
  });

  app.openapi(settleSimRoute, async (c) => {
    const result = await settleForSim(c.get("db"), c.get("clock"), c.req.valid("json"));
    if (!result.ok) {
      return c.json(
        ErrorResponseSchema.parse({ error: result.reason, message: "No such league." }),
        404,
      );
    }
    return c.json(result.response, 200);
  });

  return app;
}
