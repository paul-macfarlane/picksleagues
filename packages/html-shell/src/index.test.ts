import { describe, expect, it } from "vitest";
import { escapeAttribute, renderShellBody, renderShellMeta } from "./index";

/**
 * The failure mode here is silence: a tag whose pattern stops matching is left
 * as the generic app pitch, the document still renders, and the first sign is
 * a crawler or a preview bot reading the wrong page. So the assertions check
 * the old text is *gone*, not that the function ran.
 */

// The built shell wraps long tags onto several lines; the source file spells
// them on one. Both are real inputs — `apps/api` runs against the built one and
// `apps/web`'s prerender against a build of the source — and a pattern written
// for either alone silently misses the other.
const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <title>Picks Leagues</title>
    <meta
      name="description"
      content="Season-long sports leagues with friends."
    />
    <meta property="og:title" content="Picks Leagues" />
    <meta property="og:description" content="Season-long sports leagues with friends." />
    <meta property="og:url" content="https://www.picksleagues.com/" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index-abc123.js"></script>
  </body>
</html>`;

const META = { title: "Privacy Policy · Picks Leagues", description: "What the app stores." };

describe("renderShellMeta", () => {
  it("replaces every descriptive tag, leaving none of the generic pitch", () => {
    const html = renderShellMeta(SHELL, META);

    expect(html).toContain(`<title>${META.title}</title>`);
    expect(html).toContain(`<meta name="description" content="${META.description}" />`);
    expect(html).toContain(`<meta property="og:title" content="${META.title}" />`);
    expect(html).toContain(`<meta property="og:description" content="${META.description}" />`);
    expect(html).not.toContain("Season-long sports leagues");
    expect(html).not.toContain("<title>Picks Leagues</title>");
  });

  it("points og:url and a canonical link at the page's own URL", () => {
    const html = renderShellMeta(SHELL, {
      ...META,
      canonical: "https://www.picksleagues.com/privacy",
    });

    expect(html).toContain('<link rel="canonical" href="https://www.picksleagues.com/privacy" />');
    expect(html).toContain(
      '<meta property="og:url" content="https://www.picksleagues.com/privacy" />',
    );
    // Every prerendered page starts from one shell, so a page that kept the
    // shell's og:url would unfurl as the splash whichever page was shared.
    expect(html).not.toContain('content="https://www.picksleagues.com/" />');
  });

  it("leaves the URL alone when no canonical is given, so an invite stays unindexed", () => {
    const html = renderShellMeta(SHELL, META);

    expect(html).not.toContain('rel="canonical"');
    expect(html).toContain('<meta property="og:url" content="https://www.picksleagues.com/" />');
  });

  it("escapes text that would otherwise break out of the attribute", () => {
    const html = renderShellMeta(SHELL, {
      title: `Bob's "Best" League <script>alert(1)</script>`,
      description: "x & y",
    });

    expect(html).toContain(
      `<meta property="og:title" content="Bob's &quot;Best&quot; League &lt;script&gt;alert(1)&lt;/script&gt;" />`,
    );
    expect(html).toContain(`<meta name="description" content="x &amp; y" />`);
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("leaves the rest of the document alone, so the same SPA still boots", () => {
    const html = renderShellMeta(SHELL, META);

    expect(html).toContain('<script type="module" src="/assets/index-abc123.js"></script>');
    expect(html).toContain('<div id="root"></div>');
  });
});

describe("renderShellBody", () => {
  it("puts the markup where a crawler reads it", () => {
    const html = renderShellBody(SHELL, "<h1>Picks Leagues</h1>");

    expect(html).toContain('<div id="root"><h1>Picks Leagues</h1></div>');
  });

  it("keeps the asset tags, so the document is still the app", () => {
    const html = renderShellBody(SHELL, "<h1>Hi</h1>");

    expect(html).toContain('<script type="module" src="/assets/index-abc123.js"></script>');
  });
});

describe("escapeAttribute", () => {
  it.each([
    { value: `a "b"`, expected: "a &quot;b&quot;" },
    { value: "a & b", expected: "a &amp; b" },
    { value: "<script>", expected: "&lt;script&gt;" },
    { value: "plain text", expected: "plain text" },
  ])("escapes $value", ({ value, expected }) => {
    expect(escapeAttribute(value)).toBe(expected);
  });
});
