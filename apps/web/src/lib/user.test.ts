import { describe, expect, it } from "vitest";
import { displayNameOf, handleOf, identityLines, initialsOf } from "./user";

describe("displayNameOf", () => {
  it.each([
    { user: { name: "Jane Doe", email: "jane@example.com" }, expected: "Jane Doe" },
    { user: { name: null, email: "jane@example.com" }, expected: "jane@example.com" },
    { user: { name: "", email: "jane@example.com" }, expected: "jane@example.com" },
  ])("returns $expected for $user", ({ user, expected }) => {
    expect(displayNameOf(user)).toBe(expected);
  });
});

describe("handleOf", () => {
  it.each([
    { user: { username: "janedoe", email: "jane@example.com" }, expected: "@janedoe" },
    { user: { username: null, email: "jane@example.com" }, expected: "jane@example.com" },
    { user: { email: "jane@example.com" }, expected: "jane@example.com" },
  ])("returns $expected for $user", ({ user, expected }) => {
    expect(handleOf(user)).toBe(expected);
  });
});

describe("identityLines", () => {
  it.each([
    {
      user: { displayName: "Jane Doe", username: "janedoe" },
      variant: "roomy" as const,
      expected: { primary: "Jane Doe", secondary: "@janedoe" },
    },
    {
      user: { displayName: "Jane Doe", username: null },
      variant: "roomy" as const,
      expected: { primary: "Jane Doe", secondary: null },
    },
    {
      user: { displayName: "Jane Doe" },
      variant: "roomy" as const,
      expected: { primary: "Jane Doe", secondary: null },
    },
    {
      user: { displayName: "Jane Doe", username: "janedoe" },
      variant: "compact" as const,
      expected: { primary: "Jane Doe", secondary: null },
    },
    {
      user: { displayName: "Jane Doe", username: null },
      variant: "compact" as const,
      expected: { primary: "Jane Doe", secondary: null },
    },
  ])("$variant with $user -> $expected", ({ user, variant, expected }) => {
    expect(identityLines(user, variant)).toEqual(expected);
  });
});

describe("initialsOf", () => {
  it.each([
    { name: "Jane Doe", expected: "JD" },
    { name: "Mary Jane Watson", expected: "MJ" },
    { name: "Jane", expected: "J" },
    { name: "", expected: "?" },
    { name: "jane@example.com", expected: "J" },
  ])("returns $expected for $name", ({ name, expected }) => {
    expect(initialsOf(name)).toBe(expected);
  });
});
