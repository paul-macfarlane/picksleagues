/**
 * Rewrites of the built `apps/web/index.html` shell, shared by the two things
 * that serve a document other than the generic SPA fallback: the invite unfurl
 * (`apps/api/src/lib/invite-og.ts`, ADR-0038) and the build-time prerender of
 * the public routes (`apps/web/prerender`, LNCH-13).
 *
 * The whole module is anchored on the tag spellings in `apps/web/index.html`.
 * That coupling is why it is one module rather than a copy in each consumer:
 * a rename there must fail in one place, not silently stop substituting in a
 * second one nobody remembered to look at.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/**
 * Escapes for a double-quoted attribute value. Callers pass member-authored
 * text (a league name) into `content="…"`, so an unescaped quote would end the
 * attribute and everything after it would be parsed as markup.
 */
export function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);
}

/**
 * Replaces a whole `<meta>` tag, matched by the attribute that identifies it
 * rather than by the tag's exact text.
 *
 * **Matched across the whole tag on purpose.** This runs against the *built*
 * `index.html`, and the build reformats long tags onto several lines — a
 * pattern written for the source file's one-line spelling matches nothing
 * there and leaves the tag untouched, which is a failure with no symptom short
 * of pasting a link into a real thread.
 */
export function replaceMeta(
  html: string,
  attr: "name" | "property",
  key: string,
  content: string,
): string {
  return html.replace(
    new RegExp(`<meta\\s[^>]*${attr}="${key}"[^>]*>`),
    `<meta ${attr}="${key}" content="${escapeAttribute(content)}" />`,
  );
}

export interface ShellMeta {
  title: string;
  description: string;
  /**
   * Absolute URL this document should be indexed as. Omitted by the invite
   * unfurl, whose per-code URLs are private links that must never be indexed.
   */
  canonical?: string;
}

/**
 * Swaps the shell's descriptive tags for this document's.
 *
 * `canonical` additionally rewrites `og:url` and appends a `<link rel=canonical>`,
 * since a set of prerendered pages that all claim the shell's single `og:url`
 * would unfurl every one of them as the splash.
 */
export function renderShellMeta(shell: string, meta: ShellMeta): string {
  const title = escapeAttribute(meta.title);
  let html = shell.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  html = replaceMeta(html, "name", "description", meta.description);
  html = replaceMeta(html, "property", "og:title", meta.title);
  html = replaceMeta(html, "property", "og:description", meta.description);

  if (meta.canonical) {
    html = replaceMeta(html, "property", "og:url", meta.canonical);
    html = html.replace(
      "</head>",
      `  <link rel="canonical" href="${escapeAttribute(meta.canonical)}" />\n  </head>`,
    );
  }

  return html;
}

/**
 * Fills the shell's empty mount point with prerendered markup.
 *
 * React replaces the container's children on mount rather than hydrating them
 * (`createRoot`, not `hydrateRoot`), so this content is what a crawler and the
 * first paint get, and nothing a member interacts with — it does not have to
 * match what React renders a moment later.
 */
export function renderShellBody(shell: string, bodyHtml: string): string {
  return shell.replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`);
}
