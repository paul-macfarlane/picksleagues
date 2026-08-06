import { describe, expect, it } from "vitest";
import type { LeagueResponse } from "@picksleagues/schemas";
import { leagueHasStarted } from "./league";

// Only the fields `leagueHasStarted` reads matter for this boundary.
function leagueWithStartsAt(startsAt: string | null): LeagueResponse {
  return { startsAt } as LeagueResponse;
}

describe("leagueHasStarted", () => {
  it.each([
    [
      "null startsAt (not yet derivable) is not started",
      null,
      new Date("2026-01-01T00:00:00Z"),
      false,
    ],
    [
      "now before startsAt is not started",
      "2026-01-01T00:00:00Z",
      new Date("2025-12-31T23:59:00Z"),
      false,
    ],
    [
      "now exactly equal to startsAt is started",
      "2026-01-01T00:00:00Z",
      new Date("2026-01-01T00:00:00Z"),
      true,
    ],
    [
      "now after startsAt is started",
      "2026-01-01T00:00:00Z",
      new Date("2026-01-01T00:01:00Z"),
      true,
    ],
  ])("%s", (_description, startsAt, now, expected) => {
    expect(leagueHasStarted(leagueWithStartsAt(startsAt), now)).toBe(expected);
  });
});
