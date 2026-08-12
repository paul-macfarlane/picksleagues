import { readFileSync } from "node:fs";
import { OpenAPIHono } from "@hono/zod-openapi";
import { LEAGUE_MODE, type LeagueMode } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { renderShellMeta } from "@picksleagues/html-shell";
import { fallbackInviteShell, GENERIC_INVITE_OG, type InviteOgMeta } from "../lib/invite-og";
import { requireDbAndClock, type DepsVariables } from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import { getInviteLinkPreview, type InviteLinkPreview } from "../services/invites";

/**
 * HTML, not JSON, and deliberately outside the OpenAPI contract (ADR-0038):
 * nothing in the SPA calls this. It exists for the link-preview bots that fetch
 * an invite URL out of a text thread, and `scripts/build-vercel-output.sh`
 * routes `/join/*` here in a Vercel build. **No session** — a bot has none; see
 * `getInviteLinkPreview` for exactly how much that discloses and why.
 */

const MODE_LABELS: Record<LeagueMode, string> = {
  [LEAGUE_MODE.PICKEM]: "NFL Pick'em",
  [LEAGUE_MODE.SURVIVOR]: "NFL Survivor",
  [LEAGUE_MODE.MARCH_MADNESS]: "March Madness Pool",
};

/**
 * The unfurl's two lines. The title names the league because that is the whole
 * point of the feature — a link that says which league you're being asked into.
 * The description carries the mode and the room left, which is what decides
 * whether someone acts on it now.
 */
function inviteOgMeta(preview: InviteLinkPreview): InviteOgMeta {
  const spotsLeft = preview.maxMembers - preview.memberCount;
  const capacity = preview.open
    ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`
    : "this league is no longer taking members";
  return {
    title: `You're invited to ${preview.leagueName} · Picks Leagues`,
    description: `${MODE_LABELS[preview.mode]} · ${preview.memberCount} of ${preview.maxMembers} members · ${capacity}.`,
  };
}

/**
 * The SPA shell the build script copies in beside this function. Read once per
 * cold start rather than per request; absent in every local run, where Vite
 * serves `/join/*` itself and this route is unreachable.
 */
const shell = ((): string | null => {
  try {
    return readFileSync(new URL("./index.html", import.meta.url), "utf8");
  } catch {
    return null;
  }
})();

export function invitePreviewRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>();

  app.use("/invite-preview/:code", requireDbAndClock(deps));

  // `app.get`, not `app.openapi`: the response is a document, not a DTO, and
  // registering it would put an HTML route in the client the SPA generates from.
  app.get("/invite-preview/:code", async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const preview = await getInviteLinkPreview(db, clock, c.req.param("code"));
    // A dead code still returns the shell, so the SPA behind it can render its
    // own "Invite not found" — the unfurl just can't name a league.
    const meta = preview ? inviteOgMeta(preview) : GENERIC_INVITE_OG;

    return c.html(shell ? renderShellMeta(shell, meta) : fallbackInviteShell(meta), 200, {
      // Short and shared: an unfurl is fetched once per paste, and the capacity
      // line goes stale as members join. Long enough that the ten bots behind
      // one group thread don't each hit the database.
      "cache-control": "public, max-age=60",
    });
  });

  return app;
}
