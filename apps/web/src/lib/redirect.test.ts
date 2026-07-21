import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./redirect";

describe("safeInternalPath", () => {
  it.each([
    { label: "root-relative path", input: "/x", expected: "/x" },
    { label: "nested root-relative path", input: "/join/abc", expected: "/join/abc" },
    { label: "protocol-relative URL rejected", input: "//evil.com", expected: "/" },
    { label: "absolute URL rejected", input: "https://evil.com", expected: "/" },
    { label: "backslash protocol-relative trick rejected", input: "/\\evil.com", expected: "/" },
    { label: "embedded backslash rejected", input: "/join\\..\\x", expected: "/" },
    { label: "undefined falls back to root", input: undefined, expected: "/" },
  ])("$label", ({ input, expected }) => {
    expect(safeInternalPath(input)).toBe(expected);
  });
});
