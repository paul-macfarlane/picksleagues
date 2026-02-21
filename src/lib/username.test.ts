import { describe, expect, it } from "vitest";

import { generateUsername } from "./username";

describe("generateUsername", () => {
  it("generates a username from a standard email", () => {
    const username = generateUsername("paul.macfarlane@gmail.com");
    expect(username).toMatch(/^paulmacfarlane\d{4}$/);
  });

  it("strips special characters from the email prefix", () => {
    const username = generateUsername("john+test_user@example.com");
    expect(username).toMatch(/^johntestuser\d{4}$/);
  });

  it("lowercases the email prefix", () => {
    const username = generateUsername("JohnDoe@example.com");
    expect(username).toMatch(/^johndoe\d{4}$/);
  });

  it("handles email with only special characters in prefix", () => {
    const username = generateUsername("...@example.com");
    expect(username).toMatch(/^user\d{4}$/);
    expect(username.length).toBeGreaterThanOrEqual(3);
  });

  it("handles empty email gracefully", () => {
    const username = generateUsername("");
    expect(username).toMatch(/^user\d{4}$/);
    expect(username.length).toBeGreaterThanOrEqual(3);
  });

  it("generates a username within the 3-50 character range", () => {
    const username = generateUsername("a@example.com");
    expect(username.length).toBeGreaterThanOrEqual(3);
    expect(username.length).toBeLessThanOrEqual(50);
  });

  it("truncates very long email prefixes to fit within 50 chars", () => {
    const longPrefix = "a".repeat(100);
    const username = generateUsername(`${longPrefix}@example.com`);
    expect(username.length).toBeLessThanOrEqual(50);
  });

  it("appends a 4-digit numeric suffix", () => {
    const username = generateUsername("test@example.com");
    const suffix = username.slice(-4);
    expect(Number(suffix)).toBeGreaterThanOrEqual(1000);
    expect(Number(suffix)).toBeLessThanOrEqual(9999);
  });

  it("generates different usernames on subsequent calls", () => {
    const results = new Set(
      Array.from({ length: 20 }, () => generateUsername("test@example.com")),
    );
    // With a 4-digit random suffix, 20 calls should produce multiple unique values
    expect(results.size).toBeGreaterThan(1);
  });
});
