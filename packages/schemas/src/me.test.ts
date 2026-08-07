import { describe, expect, it } from "vitest";
import { UpdateMeRequestSchema } from "./me";

describe("UpdateMeRequestSchema", () => {
  it("rejects an empty object — at least one field is required", () => {
    expect(UpdateMeRequestSchema.safeParse({}).success).toBe(false);
  });

  it("accepts imageOverride only", () => {
    expect(
      UpdateMeRequestSchema.safeParse({ imageOverride: "https://cdn.example.invalid/a.png" })
        .success,
    ).toBe(true);
  });

  // The clear. A presence check admits it where a truthiness check would
  // reject the one request whose whole purpose is a falsy value.
  it("accepts a null imageOverride, which is how the member clears it", () => {
    expect(UpdateMeRequestSchema.safeParse({ imageOverride: null }).success).toBe(true);
  });

  it("rejects a non-https imageOverride", () => {
    expect(
      UpdateMeRequestSchema.safeParse({ imageOverride: "http://cdn.example.invalid/a.png" })
        .success,
    ).toBe(false);
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
