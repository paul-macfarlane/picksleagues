import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  CreateLeagueRequestSchema,
  ERROR_CODE,
  ErrorResponseSchema,
  JOIN_BLOCKED_REASON_MESSAGES,
  LeagueResponseSchema,
  MyLeaguesResponseSchema,
  UpdateLeagueRequestSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import {
  errorResponse,
  LEAGUE_NOT_FOUND_404,
  MISCONFIGURED_500,
  NOT_COMMISSIONER_403,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import {
  createLeague,
  deleteLeague,
  getLeague,
  joinPublicLeague,
  listMyLeagues,
  renewLeagueSeason,
  updateLeague,
} from "../services/leagues";

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
    400: errorResponse("Invalid name, mode, visibility, maxMembers, or mode settings"),
    401: UNAUTHENTICATED_401,
    409: errorResponse(
      "Creator is already commissioner of 10 active leagues (cap_exceeded), the mode's sport has no ingested season to bind to (no_active_season), or the chosen start week has already begun (start_week_passed — a league must be born pre-start)",
    ),
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
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

const patchLeague = createRoute({
  method: "patch",
  path: "/leagues/{leagueId}",
  operationId: "updateLeague",
  summary:
    "Edit a league: name anytime; visibility, maxMembers, and settings pre-start only (commissioner)",
  request: {
    params: LeagueIdParamsSchema,
    body: { content: { "application/json": { schema: UpdateLeagueRequestSchema } } },
  },
  responses: {
    200: {
      description: "The updated league",
      content: { "application/json": { schema: LeagueResponseSchema } },
    },
    400: errorResponse("Empty update, or settings that fail the league's mode schema"),
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: LEAGUE_NOT_FOUND_404,
    409: errorResponse(
      "Visibility/settings/maxMembers edit after league start (league_started), new settings whose start week has already begun (start_week_passed), or a maxMembers below the league's current member count (max_members_below_member_count)",
    ),
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
    409: errorResponse("The league has started (league_started)"),
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
    404: errorResponse("No such public league — private leagues require an invite and stay hidden"),
    409: errorResponse(
      "Join refused: already a member, league concluded, join cutoff passed, or league full — `error` carries the exact reason",
    ),
    500: MISCONFIGURED_500,
  },
});

const postRenewSeason = createRoute({
  method: "post",
  path: "/leagues/{leagueId}/seasons",
  operationId: "renewLeagueSeason",
  summary: "Start the league's next season, copying the current settings (commissioner)",
  request: { params: LeagueIdParamsSchema },
  responses: {
    201: {
      description: "The league on its new current season instance",
      content: { "application/json": { schema: LeagueResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: LEAGUE_NOT_FOUND_404,
    409: errorResponse(
      "No newer season exists to renew into — the league is already on the latest season (no_newer_season)",
    ),
    500: MISCONFIGURED_500,
  },
});

export function leagueRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  app.use("/leagues/*", requireSession(deps));
  app.use("/leagues", requireSession(deps));
  app.use("/leagues/*", requireDbAndClock(deps));
  app.use("/leagues", requireDbAndClock(deps));

  app.openapi(postLeagues, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const input = c.req.valid("json");

    const result = await createLeague(db, clock, sessionUser.id, input);
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
    const db = c.get("db");
    const sessionUser = c.get("sessionUser");
    const leagues = await listMyLeagues(db, sessionUser.id);
    return c.json({ leagues }, 200);
  });

  app.openapi(getLeagueById, async (c) => {
    const db = c.get("db");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");
    const league = await getLeague(db, leagueId, sessionUser.id);
    if (!league) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.LEAGUE_NOT_FOUND,
          message: "League not found.",
        }),
        404,
      );
    }

    return c.json(league, 200);
  });

  app.openapi(patchLeague, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");
    const input = c.req.valid("json");

    const result = await updateLeague(db, clock, leagueId, sessionUser.id, input);
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.LEAGUE_NOT_FOUND,
              message: "League not found.",
            }),
            404,
          );
        case "not_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.NOT_COMMISSIONER,
              message: "Only a commissioner can edit the league.",
            }),
            403,
          );
        case "league_started":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.LEAGUE_STARTED,
              message: "Visibility and settings are locked once the league starts.",
            }),
            409,
          );
        case "start_week_passed":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.START_WEEK_PASSED,
              message: "That start week has already begun — choose a later start.",
            }),
            409,
          );
        case "invalid_settings":
          return c.json(
            ErrorResponseSchema.parse({ error: ERROR_CODE.VALIDATION, message: result.message }),
            400,
          );
        case "max_members_below_member_count":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.MAX_MEMBERS_BELOW_MEMBER_COUNT,
              message: "maxMembers can't be lower than the league's current member count.",
            }),
            409,
          );
      }
    }

    return c.json(result.league, 200);
  });

  app.openapi(deleteLeagueRoute, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");

    const result = await deleteLeague(db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.LEAGUE_NOT_FOUND,
              message: "League not found.",
            }),
            404,
          );
        case "not_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.NOT_COMMISSIONER,
              message: "Only a commissioner can delete the league.",
            }),
            403,
          );
        case "league_started":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.LEAGUE_STARTED,
              message: "A league can't be deleted after it has started.",
            }),
            409,
          );
      }
    }

    return c.body(null, 204);
  });

  app.openapi(postPublicJoin, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");

    const result = await joinPublicLeague(db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      if (result.reason === "league_not_found") {
        return c.json(
          ErrorResponseSchema.parse({
            error: ERROR_CODE.LEAGUE_NOT_FOUND,
            message: "League not found.",
          }),
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

  app.openapi(postRenewSeason, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");

    const result = await renewLeagueSeason(db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.LEAGUE_NOT_FOUND,
              message: "League not found.",
            }),
            404,
          );
        case "not_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.NOT_COMMISSIONER,
              message: "Only a commissioner can start the next season.",
            }),
            403,
          );
        case "no_newer_season":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.NO_NEWER_SEASON,
              message: "This league is already on the latest season.",
            }),
            409,
          );
      }
    }

    return c.json(result.league, 201);
  });

  return app;
}
