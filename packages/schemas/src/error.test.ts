import { describe, expect, it } from "vitest";
import { ERROR_CODE } from "./error";
import { JOIN_BLOCKED_REASON } from "./invites";

describe("ERROR_CODE", () => {
  it("has unique values", () => {
    const values = Object.values(ERROR_CODE);
    expect(new Set(values).size).toBe(values.length);
  });

  // Join refusals go on the wire as the shared `error` envelope field, so
  // every JOIN_BLOCKED_REASON must also be a valid ERROR_CODE — pinned with
  // raw literals per the tests-pin-contracts rule.
  it.each([
    "invite_revoked",
    "invite_expired",
    "invite_exhausted",
    "already_member",
    "league_concluded",
    "join_closed",
    "league_full",
  ])("JOIN_BLOCKED_REASON member %s is a member of ERROR_CODE", (reason) => {
    expect(Object.values(JOIN_BLOCKED_REASON)).toContain(reason);
    expect(Object.values(ERROR_CODE)).toContain(reason);
  });
});
