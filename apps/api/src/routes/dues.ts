import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ERROR_CODE,
  LeagueResponseSchema,
  UpdateLeagueDuesRequestSchema,
  UpdateMemberDuesRequestSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { leagueRefusal } from "../lib/league-refusals";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import {
  errorResponse,
  LEAGUE_NOT_FOUND_404,
  MISCONFIGURED_500,
  NOT_COMMISSIONER_403,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import type { SessionVariables } from "../middleware/session";
import { setMemberDuesPaid, updateLeagueDues } from "../services/leagues";

const LeagueIdParamsSchema = z.object({ leagueId: z.uuid() });
const MemberParamsSchema = z.object({ leagueId: z.uuid(), memberId: z.uuid() });

const putDues = createRoute({
  method: "put",
  path: "/leagues/{leagueId}/dues",
  operationId: "updateLeagueDues",
  summary: "Set or clear the league's dues amount, anytime (commissioner; ADR-0045)",
  request: {
    params: LeagueIdParamsSchema,
    body: { content: { "application/json": { schema: UpdateLeagueDuesRequestSchema } } },
  },
  responses: {
    200: {
      description: "The updated league (null amount = dues tracking off)",
      content: { "application/json": { schema: LeagueResponseSchema } },
    },
    400: errorResponse("A dues amount outside 1–10000"),
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

const putMemberDues = createRoute({
  method: "put",
  path: "/leagues/{leagueId}/dues/members/{memberId}",
  operationId: "updateMemberDues",
  summary: "Mark a member's dues paid or unpaid (commissioner; ADR-0045)",
  request: {
    params: MemberParamsSchema,
    body: { content: { "application/json": { schema: UpdateMemberDuesRequestSchema } } },
  },
  responses: {
    204: { description: "Ledger updated (no-op if it already matched)" },
    400: errorResponse("Malformed body or non-uuid path param"),
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: errorResponse("League or member not found (or caller not a member of the league)"),
    409: errorResponse("The league isn't tracking dues (dues_not_enabled)"),
    500: MISCONFIGURED_500,
  },
});

export function duesRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  app.use("/leagues/:leagueId/dues", requireSession(deps));
  app.use("/leagues/:leagueId/dues", requireDbAndClock(deps));
  app.use("/leagues/:leagueId/dues/*", requireSession(deps));
  app.use("/leagues/:leagueId/dues/*", requireDbAndClock(deps));

  app.openapi(putDues, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");
    const { amount } = c.req.valid("json");

    const result = await updateLeagueDues(db, clock, leagueId, sessionUser.id, amount);
    if (!result.ok) {
      const messages = {
        [ERROR_CODE.LEAGUE_NOT_FOUND]: "League not found.",
        [ERROR_CODE.NOT_COMMISSIONER]: "Only a commissioner can manage dues.",
      } as const satisfies Record<typeof result.reason, string>;
      const { body, status } = leagueRefusal(result.reason, messages[result.reason]);
      return c.json(body, status);
    }

    return c.json(result.league, 200);
  });

  app.openapi(putMemberDues, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId, memberId } = c.req.valid("param");
    const { paid } = c.req.valid("json");

    const result = await setMemberDuesPaid(db, clock, leagueId, sessionUser.id, memberId, paid);
    if (!result.ok) {
      const messages = {
        [ERROR_CODE.LEAGUE_NOT_FOUND]: "League not found.",
        [ERROR_CODE.MEMBER_NOT_FOUND]: "Member not found.",
        [ERROR_CODE.NOT_COMMISSIONER]: "Only a commissioner can manage dues.",
        [ERROR_CODE.DUES_NOT_ENABLED]: "Set a dues amount before marking members paid.",
      } as const satisfies Record<typeof result.reason, string>;
      const { body, status } = leagueRefusal(result.reason, messages[result.reason]);
      return c.json(body, status);
    }

    return c.body(null, 204);
  });

  return app;
}
