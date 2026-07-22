import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  CreateLeagueRequestSchema,
  ErrorResponseSchema,
  JOIN_BLOCKED_REASON_MESSAGES,
  LeagueResponseSchema,
  MyLeaguesResponseSchema,
  UpdateLeagueRequestSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { sessionMiddleware, type SessionVariables } from "../middleware/session";
import {
  createLeague,
  deleteLeague,
  getLeague,
  joinPublicLeague,
  listMyLeagues,
  updateLeague,
} from "../services/leagues";

const MISCONFIGURED_500 = {
  description:
    "Server misconfiguration — structurally unreachable outside generate-openapi.ts, which builds the app with no deps and only ever requests the spec document, never invoking this handler.",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

const UNAUTHENTICATED_401 = {
  description: "No valid session",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

const LeagueIdParamsSchema = z.object({ leagueId: z.uuid() });

const postLeagues = createRoute({
  method: "post",
  path: "/leagues",
  operationId: "createLeague",
  summary: "Create a league; the creator becomes a commissioner",
  request: {
    body: { content: { "application/json": { schema: CreateLeagueRequestSchema } } },
  },
  responses: {
    201: {
      description: "League created in a pre-start state",
      content: { "application/json": { schema: LeagueResponseSchema } },
    },
    400: {
      description: "Invalid name, mode, visibility, or mode settings",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    409: {
      description:
        "Creator is already commissioner of 10 active leagues (cap_exceeded), the mode's sport has no ingested season to bind to (no_active_season), or the chosen start week has already begun (start_week_passed — a league must be born pre-start)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

const getMyLeagues = createRoute({
  method: "get",
  path: "/leagues",
  operationId: "listMyLeagues",
  summary: "List the caller's leagues (dashboard)",
  responses: {
    200: {
      description: "The caller's leagues, oldest first",
      content: { "application/json": { schema: MyLeaguesResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    500: MISCONFIGURED_500,
  },
});

const getLeagueById = createRoute({
  method: "get",
  path: "/leagues/{leagueId}",
  operationId: "getLeague",
  summary: "Get a league with settings and members (members only)",
  request: { params: LeagueIdParamsSchema },
  responses: {
    200: {
      description: "The league, its settings, and its members",
      content: { "application/json": { schema: LeagueResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    404: {
      description:
        "No such league, or the caller is not a member — indistinguishable so private leagues stay hidden",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

const NOT_COMMISSIONER_403 = {
  description: "The caller is a member but not a commissioner",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

const LEAGUE_NOT_FOUND_404 = {
  description:
    "No such league, or the caller is not a member — indistinguishable so private leagues stay hidden",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

const patchLeague = createRoute({
  method: "patch",
  path: "/leagues/{leagueId}",
  operationId: "updateLeague",
  summary: "Edit a league: name anytime; visibility and settings pre-start only (commissioner)",
  request: {
    params: LeagueIdParamsSchema,
    body: { content: { "application/json": { schema: UpdateLeagueRequestSchema } } },
  },
  responses: {
    200: {
      description: "The updated league",
      content: { "application/json": { schema: LeagueResponseSchema } },
    },
    400: {
      description: "Empty update, or settings that fail the league's mode schema",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: LEAGUE_NOT_FOUND_404,
    409: {
      description:
        "Visibility/settings edit after league start (league_started), or new settings whose start week has already begun (start_week_passed)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

const deleteLeagueRoute = createRoute({
  method: "delete",
  path: "/leagues/{leagueId}",
  operationId: "deleteLeague",
  summary: "Delete a league, pre-start only (commissioner)",
  request: { params: LeagueIdParamsSchema },
  responses: {
    204: { description: "League deleted (settings, members, invites cascade)" },
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: LEAGUE_NOT_FOUND_404,
    409: {
      description: "The league has started (league_started)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

const postPublicJoin = createRoute({
  method: "post",
  path: "/leagues/{leagueId}/join",
  operationId: "joinPublicLeague",
  summary: "Join a public league directly (discovery path)",
  request: { params: LeagueIdParamsSchema },
  responses: {
    201: {
      description: "Joined — the league as the new member sees it",
      content: { "application/json": { schema: LeagueResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    404: {
      description: "No such public league — private leagues require an invite and stay hidden",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description:
        "Join refused: already a member, league concluded, join cutoff passed, or league full — `error` carries the exact reason",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

export function leagueRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables }>({ defaultHook: zodValidationHook });

  app.use("/leagues/*", async (c, next) => {
    if (!deps.auth) {
      return c.json(
        ErrorResponseSchema.parse({ error: "misconfigured", message: "Auth is not configured." }),
        500,
      );
    }
    return sessionMiddleware(deps.auth)(c, next);
  });
  app.use("/leagues", async (c, next) => {
    if (!deps.auth) {
      return c.json(
        ErrorResponseSchema.parse({ error: "misconfigured", message: "Auth is not configured." }),
        500,
      );
    }
    return sessionMiddleware(deps.auth)(c, next);
  });

  app.openapi(postLeagues, async (c) => {
    if (!deps.db || !deps.clock) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "misconfigured",
          message: "Database/clock are not configured.",
        }),
        500,
      );
    }

    const sessionUser = c.get("sessionUser");
    const clock = await deps.clock();
    const input = c.req.valid("json");

    const result = await createLeague(deps.db, clock, sessionUser.id, input);
    if (!result.ok) {
      const messages = {
        cap_exceeded: "You already run 10 active leagues — conclude or delete one first.",
        no_active_season: "That game mode has no season available yet.",
        start_week_passed: "That start week has already begun — choose a later start.",
      } as const;
      return c.json(
        ErrorResponseSchema.parse({ error: result.reason, message: messages[result.reason] }),
        409,
      );
    }

    return c.json(result.league, 201);
  });

  app.openapi(getMyLeagues, async (c) => {
    if (!deps.db) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "misconfigured",
          message: "Database is not configured.",
        }),
        500,
      );
    }

    const sessionUser = c.get("sessionUser");
    const leagues = await listMyLeagues(deps.db, sessionUser.id);
    return c.json({ leagues }, 200);
  });

  app.openapi(getLeagueById, async (c) => {
    if (!deps.db) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "misconfigured",
          message: "Database is not configured.",
        }),
        500,
      );
    }

    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");
    const league = await getLeague(deps.db, leagueId, sessionUser.id);
    if (!league) {
      return c.json(
        ErrorResponseSchema.parse({ error: "league_not_found", message: "League not found." }),
        404,
      );
    }

    return c.json(league, 200);
  });

  app.openapi(patchLeague, async (c) => {
    if (!deps.db || !deps.clock) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "misconfigured",
          message: "Database/clock are not configured.",
        }),
        500,
      );
    }

    const sessionUser = c.get("sessionUser");
    const clock = await deps.clock();
    const { leagueId } = c.req.valid("param");
    const input = c.req.valid("json");

    const result = await updateLeague(deps.db, clock, leagueId, sessionUser.id, input);
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
          return c.json(
            ErrorResponseSchema.parse({ error: "league_not_found", message: "League not found." }),
            404,
          );
        case "not_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: "not_commissioner",
              message: "Only a commissioner can edit the league.",
            }),
            403,
          );
        case "league_started":
          return c.json(
            ErrorResponseSchema.parse({
              error: "league_started",
              message: "Visibility and settings are locked once the league starts.",
            }),
            409,
          );
        case "start_week_passed":
          return c.json(
            ErrorResponseSchema.parse({
              error: "start_week_passed",
              message: "That start week has already begun — choose a later start.",
            }),
            409,
          );
        case "invalid_settings":
          return c.json(
            ErrorResponseSchema.parse({ error: "validation", message: result.message }),
            400,
          );
      }
    }

    return c.json(result.league, 200);
  });

  app.openapi(deleteLeagueRoute, async (c) => {
    if (!deps.db || !deps.clock) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "misconfigured",
          message: "Database/clock are not configured.",
        }),
        500,
      );
    }

    const sessionUser = c.get("sessionUser");
    const clock = await deps.clock();
    const { leagueId } = c.req.valid("param");

    const result = await deleteLeague(deps.db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
          return c.json(
            ErrorResponseSchema.parse({ error: "league_not_found", message: "League not found." }),
            404,
          );
        case "not_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: "not_commissioner",
              message: "Only a commissioner can delete the league.",
            }),
            403,
          );
        case "league_started":
          return c.json(
            ErrorResponseSchema.parse({
              error: "league_started",
              message: "A league can't be deleted after it has started.",
            }),
            409,
          );
      }
    }

    return c.body(null, 204);
  });

  app.openapi(postPublicJoin, async (c) => {
    if (!deps.db || !deps.clock) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "misconfigured",
          message: "Database/clock are not configured.",
        }),
        500,
      );
    }

    const sessionUser = c.get("sessionUser");
    const clock = await deps.clock();
    const { leagueId } = c.req.valid("param");

    const result = await joinPublicLeague(deps.db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      if (result.reason === "league_not_found") {
        return c.json(
          ErrorResponseSchema.parse({ error: "league_not_found", message: "League not found." }),
          404,
        );
      }
      return c.json(
        ErrorResponseSchema.parse({
          error: result.reason,
          message: JOIN_BLOCKED_REASON_MESSAGES[result.reason],
        }),
        409,
      );
    }

    return c.json(result.league, 201);
  });

  return app;
}
