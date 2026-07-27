import { describe, expect, it } from "vitest";
import { UpdateMeRequestSchema } from "./me";

describe("UpdateMeRequestSchema", () => {
  it("rejects an empty object — at least one field is required", () => {
    expect(UpdateMeRequestSchema.safeParse({}).success).toBe(false);
  });

  it("accepts username only", () => {
    expect(UpdateMeRequestSchema.safeParse({ username: "paulm" }).success).toBe(true);
  });

  it("accepts displayName only", () => {
    expect(UpdateMeRequestSchema.safeParse({ displayName: "Paul" }).success).toBe(true);
  });

  it("accepts both fields", () => {
    expect(
      UpdateMeRequestSchema.safeParse({ username: "paulm", displayName: "Paul" }).success,
    ).toBe(true);
  });
});
