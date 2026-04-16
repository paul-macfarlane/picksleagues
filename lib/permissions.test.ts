import { describe, expect, it } from "vitest";

import type { Profile } from "@/lib/db/schema/profiles";
import { ForbiddenError } from "@/lib/errors";

import { assertAdmin } from "./permissions";

function makeProfile(role: Profile["role"]): Profile {
  return {
    id: "p-1",
    userId: "u-1",
    username: "alice",
    name: "Alice",
    avatarUrl: null,
    role,
    setupComplete: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("assertAdmin", () => {
  it("allows admin role", () => {
    expect(() => assertAdmin(makeProfile("admin"))).not.toThrow();
  });

  it("throws ForbiddenError for user role", () => {
    expect(() => assertAdmin(makeProfile("user"))).toThrow(ForbiddenError);
  });
});
