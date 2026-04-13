import { describe, expect, it } from "vitest";

import { getInitials } from "@/lib/utils";

describe("getInitials", () => {
  it("returns the first letter of a single-word name", () => {
    expect(getInitials("Madonna")).toBe("M");
  });

  it("returns the first letter of the first two words", () => {
    expect(getInitials("Jane Doe")).toBe("JD");
  });

  it("caps at two letters for longer names", () => {
    expect(getInitials("Mary Jane Watson")).toBe("MJ");
  });

  it("uppercases lowercase input", () => {
    expect(getInitials("alice bob")).toBe("AB");
  });

  it("collapses extra whitespace", () => {
    expect(getInitials("  Alice   Bob  ")).toBe("AB");
  });

  it("falls back to '?' for empty input", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });
});
