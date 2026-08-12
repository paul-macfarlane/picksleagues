import { describe, expect, it } from "vitest";
import { GENERIC_INVITE_OG, fallbackInviteShell } from "./invite-og";

// Rewriting the built shell's tags is `packages/html-shell`'s job and is
// covered there, against both the source file's one-line tags and the built
// file's wrapped ones. What's left here is the invite's own contract: the
// document served when no shell is on disk, and what a dead code discloses.

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
