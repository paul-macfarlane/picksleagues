/**
 * The link-unfurl half of an invite (FB-41, ADR-0038).
 *
 * A link pasted into a text thread is fetched by a preview bot that reads
 * `<title>`/`og:*` out of the returned HTML and never runs the SPA. Every route
 * otherwise falls through to one static `index.html` whose tags are fixed at
 * build time, so an invite unfurled as the generic app pitch. This module
 * rewrites those four tags in that same shell — the document is byte-identical
 * apart from them, so a human following the link boots the very same SPA.
 *
 * No `canonical`: an invite URL names a private league and must stay out of
 * every index, so these documents deliberately keep the shell's `og:url`.
 */

import { escapeAttribute } from "@picksleagues/html-shell";

export interface InviteOgMeta {
  title: string;
  description: string;
}

/**
 * The generic invite tags, used when a code names no league — revoked, deleted,
 * or never real. Deliberately identical for all three: the unfurl is fetched by
 * whoever holds the link, and distinguishing "revoked" from "never existed"
 * there would answer a question about someone else's league.
 */
export const GENERIC_INVITE_OG: InviteOgMeta = {
  title: "You're invited to a league · Picks Leagues",
  description: "Join your friends' NFL pick'em or survivor league on Picks Leagues.",
};

/**
 * The minimal document served when the built shell isn't on disk beside the
 * function — which is every local run, since Vite serves `/join/*` itself in
 * dev and this path is only ever reached in a Vercel build. An unfurl still
 * works; a human would get a blank page, which no human can reach here.
 */
export function fallbackInviteShell(meta: InviteOgMeta): string {
  const title = escapeAttribute(meta.title);
  const description = escapeAttribute(meta.description);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
  </head>
  <body></body>
</html>
`;
}
