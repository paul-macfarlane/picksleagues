import { describe, expect, it } from "vitest";
import { ImageUrlSchema } from "./image-url";

describe("ImageUrlSchema", () => {
  it.each([
    {
      label: "an https URL",
      input: "https://cdn.example.invalid/avatar.png",
      expected: "https://cdn.example.invalid/avatar.png",
    },
    {
      label: "an https URL with no path",
      input: "https://cdn.example.invalid",
      expected: "https://cdn.example.invalid",
    },
    {
      label: "query and fragment preserved verbatim",
      input: "https://cdn.example.invalid/a.png?size=200#x",
      expected: "https://cdn.example.invalid/a.png?size=200#x",
    },
    {
      label: "surrounding whitespace trimmed",
      input: "  https://cdn.example.invalid/avatar.png  ",
      expected: "https://cdn.example.invalid/avatar.png",
    },
    {
      label: "maximal length (2048 chars)",
      input: `https://cdn.example.invalid/${"a".repeat(2048 - 28)}`,
      expected: `https://cdn.example.invalid/${"a".repeat(2048 - 28)}`,
    },
  ])("accepts $label", ({ input, expected }) => {
    expect(ImageUrlSchema.parse(input)).toBe(expected);
  });

  it.each([
    { label: "http (not https)", input: "http://cdn.example.invalid/avatar.png" },
    { label: "javascript: scheme", input: "javascript:alert(1)" },
    { label: "data: URL", input: "data:image/png;base64,iVBORw0KGgo=" },
    { label: "protocol-relative URL", input: "//cdn.example.invalid/avatar.png" },
    { label: "bare host with no scheme", input: "cdn.example.invalid/avatar.png" },
    { label: "empty string", input: "" },
    {
      label: "too long (2049 chars)",
      input: `https://cdn.example.invalid/${"a".repeat(2049 - 28)}`,
    },
  ])("rejects $label", ({ input }) => {
    expect(ImageUrlSchema.safeParse(input).success).toBe(false);
  });
});
