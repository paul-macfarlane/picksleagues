import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ERROR_CODE, UpdateMemberRoleRequestSchema } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { leagueRefusal } from "../lib/league-refusals";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import {
  errorResponse,
  MISCONFIGURED_500,
  NOT_COMMISSIONER_403,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import type { SessionVariables } from "../middleware/session";
import { kickMember, leaveLeague, updateMemberRole } from "../services/members";

const LeagueIdParamsSchema = z.object({ leagueId: z.uuid() });
const MemberParamsSchema = z.object({ leagueId: z.uuid(), memberId: z.uuid() });

const patchMember = createRoute({
  method: "patch",
  path: "/leagues/{leagueId}/members/{memberId}",
  operationId: "updateMemberRole",
  summary: "Promote or demote a member (commissioner, anytime; ADR-0004)",
  request: {
    params: MemberParamsSchema,
    body: { content: { "application/json": { schema: UpdateMemberRoleRequestSchema } } },
  },
  responses: {
    204: { description: "Role updated (no-op if it already matched)" },
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: errorResponse("League or member not found (or caller not a member of the league)"),
    409: errorResponse(
      "Promotion past the recipient's 10-active-league cap (cap_exceeded), or a demotion that would leave zero commissioners (last_commissioner)",
    ),
    500: MISCONFIGURED_500,
  },
});

const deleteMember = createRoute({
  method: "delete",
  path: "/leagues/{leagueId}/members/{memberId}",
  operationId: "kickMember",
  summary: "Kick a member, pre-start only (commissioner)",
  request: { params: MemberParamsSchema },
  responses: {
    204: { description: "Member removed" },
    400: errorResponse(
      "A commissioner can't kick themselves — leave (or delete the league) instead",
    ),
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: errorResponse("League or member not found (or caller not a member of the league)"),
    409: errorResponse(
      "The league has started (league_started), or the kick would leave zero commissioners (last_commissioner)",
    ),
    500: MISCONFIGURED_500,
  },
});

const deleteSelf = createRoute({
  method: "delete",
  path: "/leagues/{leagueId}/members/me",
  operationId: "leaveLeague",
  summary: "Leave a league, pre-start only (spec §Membership, ADR-0004)",
  request: { params: LeagueIdParamsSchema },
  responses: {
    204: { description: "Left the league" },
    401: UNAUTHENTICATED_401,
    404: errorResponse("No such league, or the caller is not a member"),
    409: errorResponse(
      "The league has started (league_started), the caller is the last commissioner of a league with other members (last_commissioner), or the sole member — delete the league instead (sole_member)",
    ),
    500: MISCONFIGURED_500,
  },
});

export function memberRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  app.use("/leagues/:leagueId/members/*", requireSession(deps));
  app.use("/leagues/:leagueId/members/*", requireDbAndClock(deps));

  // Registered before the {memberId} routes so the literal "me" segment wins
  // instead of failing the uuid param validation.
  app.openapi(deleteSelf, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");

    const result = await leaveLeague(db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      const messages = {
        [ERROR_CODE.LEAGUE_NOT_FOUND]: "League not found.",
        [ERROR_CODE.LEAGUE_STARTED]: "Membership is frozen once the league starts.",
        [ERROR_CODE.SOLE_MEMBER]:
          "You're the only member — delete the league instead of leaving it.",
        [ERROR_CODE.LAST_COMMISSIONER]: "Promote another commissioner before leaving.",
      } as const satisfies Record<typeof result.reason, string>;
      const { body, status } = leagueRefusal(result.reason, messages[result.reason]);
      return c.json(body, status);
    }

    return c.body(null, 204);
  });

  app.openapi(patchMember, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId, memberId } = c.req.valid("param");
    const { role } = c.req.valid("json");

    const result = await updateMemberRole(db, clock, leagueId, sessionUser.id, memberId, role);
    if (!result.ok) {
      const messages = {
        [ERROR_CODE.LEAGUE_NOT_FOUND]: "League not found.",
        [ERROR_CODE.MEMBER_NOT_FOUND]: "Member not found.",
        [ERROR_CODE.NOT_COMMISSIONER]: "Only a commissioner can promote or demote members.",
        [ERROR_CODE.CAP_EXCEEDED]: "That member already runs 10 active leagues.",
        [ERROR_CODE.LAST_COMMISSIONER]: "A league must keep at least one commissioner.",
      } as const satisfies Record<typeof result.reason, string>;
      const { body, status } = leagueRefusal(result.reason, messages[result.reason]);
      return c.json(body, status);
    }

    return c.body(null, 204);
  });

  app.openapi(deleteMember, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId, memberId } = c.req.valid("param");

    const result = await kickMember(db, clock, leagueId, sessionUser.id, memberId);
    if (!result.ok) {
      const messages = {
        [ERROR_CODE.LEAGUE_NOT_FOUND]: "League not found.",
        [ERROR_CODE.MEMBER_NOT_FOUND]: "Member not found.",
        [ERROR_CODE.NOT_COMMISSIONER]: "Only a commissioner can kick members.",
        [ERROR_CODE.CANNOT_KICK_SELF]: "You can't kick yourself — leave the league instead.",
        [ERROR_CODE.LEAGUE_STARTED]: "Membership is frozen once the league starts.",
        [ERROR_CODE.LAST_COMMISSIONER]: "A league must keep at least one commissioner.",
      } as const satisfies Record<typeof result.reason, string>;
      const { body, status } = leagueRefusal(result.reason, messages[result.reason]);
      return c.json(body, status);
    }

    return c.body(null, 204);
  });

  return app;
}
