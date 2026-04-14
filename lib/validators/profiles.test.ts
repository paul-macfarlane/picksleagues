import { describe, expect, it } from "vitest";

import { updateProfileSchema } from "./profiles";

const validInput = {
  username: "paul1234",
  name: "Paul Macfarlane",
  avatarUrl: "https://example.com/avatar.png",
};

describe("updateProfileSchema", () => {
  it("accepts valid input", () => {
    const result = updateProfileSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts the minimum username length", () => {
    const result = updateProfileSchema.safeParse({
      ...validInput,
      username: "abc",
    });
    expect(result.success).toBe(true);
  });

  it("accepts the maximum username length", () => {
    const result = updateProfileSchema.safeParse({
      ...validInput,
      username: "a".repeat(50),
    });
    expect(result.success).toBe(true);
  });

  it("rejects usernames shorter than 3 characters", () => {
    const result = updateProfileSchema.safeParse({
      ...validInput,
      username: "ab",
    });
    expect(result.success).toBe(false);
  });

  it("rejects usernames longer than 50 characters", () => {
    const result = updateProfileSchema.safeParse({
      ...validInput,
      username: "a".repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it('rejects the reserved "anonymous" username (case-insensitive)', () => {
    for (const username of ["anonymous", "Anonymous", "ANONYMOUS"]) {
      const result = updateProfileSchema.safeParse({ ...validInput, username });
      expect(result.success).toBe(false);
    }
  });

  it("rejects usernames with invalid characters", () => {
    const result = updateProfileSchema.safeParse({
      ...validInput,
      username: "bad name",
    });
    expect(result.success).toBe(false);
  });

  it("requires a name", () => {
    const result = updateProfileSchema.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("accepts an empty string avatar URL", () => {
    const result = updateProfileSchema.safeParse({
      ...validInput,
      avatarUrl: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a missing avatar URL", () => {
    const result = updateProfileSchema.safeParse({
      username: validInput.username,
      name: validInput.name,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid avatar URL", () => {
    const result = updateProfileSchema.safeParse({
      ...validInput,
      avatarUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});
