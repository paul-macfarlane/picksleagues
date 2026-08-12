import { describe, expect, it } from "vitest";
import { GENERIC_INVITE_OG, fallbackInviteShell, renderInviteShell } from "./invite-og";

/**
 * The unfurl's failure mode is silence: a tag that doesn't match its pattern is
 * left as the generic app pitch, the page still renders, every test that only
 * checks "did it run" still passes, and the first sign is a link pasted into a
 * real thread. So every case here asserts the *old* text is gone.
 */

// The source spelling (apps/web/index.html) and the built spelling, which the
// build reformats onto several lines. Both are real inputs — the function runs
// against the built one in production and the source one is what a reader
// edits — and a pattern written for either alone silently misses the other.
const SOURCE_SHELL = `<!doctype html>
<html lang="en">
  <head>
    <title>Picks Leagues</title>
    <meta name="description" content="Season-long sports leagues with friends." />
    <meta property="og:title" content="Picks Leagues" />
    <meta property="og:description" content="Season-long sports leagues with friends." />
    <script type="module" src="/assets/index-abc123.js"></script>
  </head>
</html>`;

const BUILT_SHELL = `<!doctype html>
<html lang="en">
  <head>
    <title>Picks Leagues</title>
    <meta
      name="description"
      content="Season-long sports leagues with friends — NFL pick'em and survivor, with March Madness brackets to come."
    />
    <meta property="og:title" content="Picks Leagues" />
    <meta
      property="og:description"
      content="Season-long sports leagues with friends — NFL pick'em and survivor, with March Madness brackets to come."
    />
    <script type="module" src="/assets/index-abc123.js"></script>
  </head>
</html>`;

const META = { title: "You're invited to Sunday Crew", description: "NFL Pick'em · 4 spots left." };

describe("renderInviteShell", () => {
  it.each([
    { name: "the source shell's one-line tags", shell: SOURCE_SHELL },
    { name: "the built shell's wrapped tags", shell: BUILT_SHELL },
  ])("rewrites every descriptive tag in $name", ({ shell }) => {
    const html = renderInviteShell(shell, META);

    expect(html).toContain(`<title>${META.title}</title>`);
    expect(html).toContain(`<meta name="description" content="${META.description}" />`);
    expect(html).toContain(`<meta property="og:title" content="${META.title}" />`);
    expect(html).toContain(`<meta property="og:description" content="${META.description}" />`);
    // The claim the four assertions above can't make on their own: nothing of
    // the generic pitch survived anywhere in the document.
    expect(html).not.toContain("Season-long sports leagues");
    expect(html).not.toContain("<title>Picks Leagues</title>");
  });

  it("leaves the rest of the document alone, so the same SPA still boots", () => {
    const html = renderInviteShell(BUILT_SHELL, META);
    expect(html).toContain('<script type="module" src="/assets/index-abc123.js"></script>');
    expect(html).toContain('<html lang="en">');
  });

  it("escapes a league name that would otherwise break out of the attribute", () => {
    const html = renderInviteShell(SOURCE_SHELL, {
      title: `Bob's "Best" League <script>alert(1)</script>`,
      description: "x & y",
    });

    expect(html).toContain(
      `<meta property="og:title" content="Bob's &quot;Best&quot; League &lt;script&gt;alert(1)&lt;/script&gt;" />`,
    );
    expect(html).toContain(`<meta name="description" content="x &amp; y" />`);
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("fallbackInviteShell", () => {
  it("carries the tags a preview bot reads, escaped the same way", () => {
    const html = fallbackInviteShell({ title: `A "B"`, description: "C & D" });
    expect(html).toContain(`<meta property="og:title" content="A &quot;B&quot;" />`);
    expect(html).toContain(`<meta property="og:description" content="C &amp; D" />`);
  });

  it("names no league in the generic case, since a dead code names none", () => {
    const html = fallbackInviteShell(GENERIC_INVITE_OG);
    expect(html).toContain("You're invited to a league");
  });
});
