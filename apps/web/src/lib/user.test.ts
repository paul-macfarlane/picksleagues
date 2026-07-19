import { describe, expect, it } from "vitest";
import { displayNameOf, initialsOf } from "./user";

describe("displayNameOf", () => {
  it.each([
    { user: { name: "Jane Doe", email: "jane@example.com" }, expected: "Jane Doe" },
    { user: { name: null, email: "jane@example.com" }, expected: "jane@example.com" },
    { user: { name: "", email: "jane@example.com" }, expected: "jane@example.com" },
  ])("returns $expected for $user", ({ user, expected }) => {
    expect(displayNameOf(user)).toBe(expected);
  });
});

describe("initialsOf", () => {
  it.each([
    { name: "Jane Doe", expected: "JD" },
    { name: "Jane", expected: "J" },
    { name: "", expected: "?" },
    { name: "jane@example.com", expected: "J" },
  ])("returns $expected for $name", ({ name, expected }) => {
    expect(initialsOf(name)).toBe(expected);
  });
});
