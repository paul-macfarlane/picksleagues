/**
 * The link-unfurl half of an invite (FB-41, ADR-0038).
 *
 * A link pasted into a text thread is fetched by a preview bot that reads
 * `<title>`/`og:*` out of the returned HTML and never runs the SPA. Every route
 * otherwise falls through to one static `index.html` whose tags are fixed at
 * build time, so an invite unfurled as the generic app pitch. This module
 * rewrites those four tags in that same shell — the document is byte-identical
 * apart from them, so a human following the link boots the very same SPA.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/**
 * Escapes for a double-quoted attribute value. A league name is member-authored
 * text going into `content="…"`, so an unescaped quote would end the attribute
 * and everything after it would be parsed as markup.
 */
function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);
}

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
 * Replaces a whole `<meta>` tag, matched by the attribute that identifies it
 * rather than by the tag's exact text.
 *
 * **Matched across the whole tag on purpose.** The shell this runs against is
 * the *built* `index.html`, and the build reformats long tags onto several
 * lines — a pattern written for the source file's one-line spelling matches
 * nothing there and leaves the tag untouched, which is a failure with no
 * symptom short of pasting a link into a real thread.
 */
function replaceMeta(html: string, attr: "name" | "property", key: string, content: string) {
  return html.replace(
    new RegExp(`<meta\\s[^>]*${attr}="${key}"[^>]*>`),
    `<meta ${attr}="${key}" content="${content}" />`,
  );
}

/**
 * Swaps the shell's four descriptive tags for this invite's. Anchored on the
 * attribute names `apps/web/index.html` uses — renaming one there silently
 * stops its substitution, which is why `invite-og.test.ts` asserts the old text
 * is gone rather than that the function ran.
 */
export function renderInviteShell(shell: string, meta: InviteOgMeta): string {
  const title = escapeAttribute(meta.title);
  const description = escapeAttribute(meta.description);
  const withTitle = shell.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  const withDescription = replaceMeta(withTitle, "name", "description", description);
  const withOgTitle = replaceMeta(withDescription, "property", "og:title", title);
  return replaceMeta(withOgTitle, "property", "og:description", description);
}

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
