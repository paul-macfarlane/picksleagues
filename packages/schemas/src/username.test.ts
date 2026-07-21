import { describe, expect, it } from "vitest";
import { UsernameSchema } from "./username";

describe("UsernameSchema", () => {
  it.each([
    { label: "valid minimal length (3 chars)", input: "abc", expected: "abc" },
    {
      label: "valid maximal length (20 chars)",
      input: "a".repeat(20),
      expected: "a".repeat(20),
    },
    { label: "underscores and digits allowed", input: "paul_1993", expected: "paul_1993" },
    { label: "uppercase input lowercased on parse", input: "PaulM", expected: "paulm" },
    { label: "surrounding whitespace trimmed", input: "  paulm  ", expected: "paulm" },
  ])("accepts $label", ({ input, expected }) => {
    expect(UsernameSchema.parse(input)).toBe(expected);
  });

  it.each([
    { label: "too short (2 chars)", input: "ab" },
    { label: "too long (21 chars)", input: "a".repeat(21) },
    { label: "hyphen", input: "paul-m" },
    { label: "space", input: "paul m" },
    { label: "emoji", input: "paul😀" },
    { label: "empty string", input: "" },
  ])("rejects $label", ({ input }) => {
    expect(UsernameSchema.safeParse(input).success).toBe(false);
  });
});
