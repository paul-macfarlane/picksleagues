import { describe, expect, it } from "vitest";
import { DisplayNameSchema } from "./display-name";

describe("DisplayNameSchema", () => {
  it.each([
    { label: "valid simple name", input: "Paul", expected: "Paul" },
    { label: "valid maximal length (50 chars)", input: "a".repeat(50), expected: "a".repeat(50) },
    { label: "surrounding whitespace trimmed", input: "  Paul  ", expected: "Paul" },
  ])("accepts $label", ({ input, expected }) => {
    expect(DisplayNameSchema.parse(input)).toBe(expected);
  });

  it.each([
    { label: "empty string", input: "" },
    { label: "whitespace-only", input: "   " },
    { label: "too long (51 chars)", input: "a".repeat(51) },
  ])("rejects $label", ({ input }) => {
    expect(DisplayNameSchema.safeParse(input).success).toBe(false);
  });
});
