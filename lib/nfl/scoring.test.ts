import { describe, expect, it } from "vitest";

import type { EventStatus } from "@/lib/db/schema/sports";

import {
  calculatePickResult,
  calculateStandingsPoints,
  calculateWeeklyStandings,
  denseRank,
} from "./scoring";

const HOME = "home-team-id";
const AWAY = "away-team-id";

function event(
  overrides: Partial<{
    status: EventStatus;
    homeScore: number | null;
    awayScore: number | null;
  }> = {},
) {
  return {
    status: overrides.status ?? ("final" as EventStatus),
    homeTeamId: HOME,
    awayTeamId: AWAY,
    homeScore: overrides.homeScore === undefined ? 0 : overrides.homeScore,
    awayScore: overrides.awayScore === undefined ? 0 : overrides.awayScore,
  };
}

describe("calculatePickResult — straight up", () => {
  it("returns win when the picked team's score is higher", () => {
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: null },
        event({ homeScore: 24, awayScore: 17 }),
        "straight_up",
      ),
    ).toBe("win");
    expect(
      calculatePickResult(
        { teamId: AWAY, spreadAtLock: null },
        event({ homeScore: 17, awayScore: 24 }),
        "straight_up",
      ),
    ).toBe("win");
  });

  it("returns loss when the picked team's score is lower", () => {
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: null },
        event({ homeScore: 10, awayScore: 20 }),
        "straight_up",
      ),
    ).toBe("loss");
  });

  it("returns push on a tie", () => {
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: null },
        event({ homeScore: 17, awayScore: 17 }),
        "straight_up",
      ),
    ).toBe("push");
  });
});

describe("calculatePickResult — against the spread", () => {
  it("applies the frozen spread to the picked team's score (favorite wins ATS)", () => {
    // Picked home at -3.5. Home wins 24-17. Adjusted = 24 - 3.5 = 20.5 > 17 → win.
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: -3.5 },
        event({ homeScore: 24, awayScore: 17 }),
        "against_the_spread",
      ),
    ).toBe("win");
  });

  it("favorite loses ATS when the margin is smaller than the spread", () => {
    // Picked home at -7. Home wins 21-17. Adjusted = 21 - 7 = 14 < 17 → loss.
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: -7 },
        event({ homeScore: 21, awayScore: 17 }),
        "against_the_spread",
      ),
    ).toBe("loss");
  });

  it("underdog wins outright and also covers ATS", () => {
    // Picked away at +3.5. Away wins 17-14. Adjusted = 17 + 3.5 = 20.5 > 14 → win.
    expect(
      calculatePickResult(
        { teamId: AWAY, spreadAtLock: 3.5 },
        event({ homeScore: 14, awayScore: 17 }),
        "against_the_spread",
      ),
    ).toBe("win");
  });

  it("underdog loses outright but covers ATS", () => {
    // Picked away at +7. Home wins 24-20. Adjusted = 20 + 7 = 27 > 24 → win.
    expect(
      calculatePickResult(
        { teamId: AWAY, spreadAtLock: 7 },
        event({ homeScore: 24, awayScore: 20 }),
        "against_the_spread",
      ),
    ).toBe("win");
  });

  it("returns push when adjusted score exactly equals the opponent", () => {
    // Picked home at -3. Home wins 24-21. Adjusted = 24 - 3 = 21 = 21 → push.
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: -3 },
        event({ homeScore: 24, awayScore: 21 }),
        "against_the_spread",
      ),
    ).toBe("push");
  });

  it("pick'em (spread 0) scores like straight up", () => {
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: 0 },
        event({ homeScore: 21, awayScore: 17 }),
        "against_the_spread",
      ),
    ).toBe("win");
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: 0 },
        event({ homeScore: 17, awayScore: 17 }),
        "against_the_spread",
      ),
    ).toBe("push");
  });

  it("returns null when an ATS pick has no frozen spread", () => {
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: null },
        event({ homeScore: 24, awayScore: 17 }),
        "against_the_spread",
      ),
    ).toBeNull();
  });
});

describe("calculatePickResult — unscoreable states", () => {
  it("returns null when the event is not final", () => {
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: null },
        event({ status: "in_progress", homeScore: 14, awayScore: 7 }),
        "straight_up",
      ),
    ).toBeNull();
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: null },
        event({ status: "not_started", homeScore: null, awayScore: null }),
        "straight_up",
      ),
    ).toBeNull();
  });

  it("returns null when scores are missing on a final event", () => {
    expect(
      calculatePickResult(
        { teamId: HOME, spreadAtLock: null },
        event({ status: "final", homeScore: null, awayScore: 17 }),
        "straight_up",
      ),
    ).toBeNull();
  });

  it("returns null when the picked team isn't home or away of this event", () => {
    expect(
      calculatePickResult(
        { teamId: "mystery-team", spreadAtLock: null },
        event({ homeScore: 24, awayScore: 17 }),
        "straight_up",
      ),
    ).toBeNull();
  });
});

describe("calculateStandingsPoints", () => {
  it("sums wins, losses, pushes and points per §8.2", () => {
    expect(calculateStandingsPoints(["win", "win", "loss", "push"])).toEqual({
      wins: 2,
      losses: 1,
      pushes: 1,
      points: 2.5,
    });
  });

  it("ignores unscored picks (null)", () => {
    expect(
      calculateStandingsPoints(["win", null, null, "push", "loss"]),
    ).toEqual({
      wins: 1,
      losses: 1,
      pushes: 1,
      points: 1.5,
    });
  });

  it("zeros out an empty list", () => {
    expect(calculateStandingsPoints([])).toEqual({
      wins: 0,
      losses: 0,
      pushes: 0,
      points: 0,
    });
  });
});

describe("denseRank (§8.4)", () => {
  it("assigns rank 1 to the single highest scorer", () => {
    const ranked = denseRank(
      [
        { id: "a", p: 5 },
        { id: "b", p: 3 },
        { id: "c", p: 1 },
      ],
      (e) => e.p,
    );
    expect(ranked.map((r) => [r.entry.id, r.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("ties share a rank and the next distinct rank jumps by the tied count", () => {
    const ranked = denseRank(
      [
        { id: "a", p: 5 },
        { id: "b", p: 5 },
        { id: "c", p: 3 },
      ],
      (e) => e.p,
    );
    // a & b tied at 1 (2 tied) → next distinct rank = 1 + 2 = 3.
    expect(ranked.map((r) => [r.entry.id, r.rank])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 3],
    ]);
  });

  it("handles multiple distinct tie groups", () => {
    // [5,5,3,3,1] → ranks [1,1,3,3,5]
    const ranked = denseRank(
      [
        { id: "a", p: 5 },
        { id: "b", p: 5 },
        { id: "c", p: 3 },
        { id: "d", p: 3 },
        { id: "e", p: 1 },
      ],
      (e) => e.p,
    );
    expect(ranked.map((r) => [r.entry.id, r.rank])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 3],
      ["d", 3],
      ["e", 5],
    ]);
  });

  it("handles all-tied at rank 1", () => {
    const ranked = denseRank(
      [
        { id: "a", p: 0 },
        { id: "b", p: 0 },
        { id: "c", p: 0 },
      ],
      (e) => e.p,
    );
    expect(ranked.every((r) => r.rank === 1)).toBe(true);
  });

  it("preserves points-desc ordering in the output", () => {
    const ranked = denseRank(
      [
        { id: "a", p: 1 },
        { id: "b", p: 3 },
        { id: "c", p: 2 },
      ],
      (e) => e.p,
    );
    expect(ranked.map((r) => r.entry.id)).toEqual(["b", "c", "a"]);
  });

  it("returns an empty list when given no entries", () => {
    expect(denseRank([], (e: { p: number }) => e.p)).toEqual([]);
  });
});

describe("calculateWeeklyStandings", () => {
  it("aggregates per-user wins/losses/pushes and ranks by points", () => {
    const standings = calculateWeeklyStandings(
      [
        // user-a: 2 wins, 1 push → 2.5 pts
        { userId: "user-a", pickResult: "win" },
        { userId: "user-a", pickResult: "win" },
        { userId: "user-a", pickResult: "push" },
        // user-b: 1 win, 2 losses → 1 pt
        { userId: "user-b", pickResult: "win" },
        { userId: "user-b", pickResult: "loss" },
        { userId: "user-b", pickResult: "loss" },
        // user-c: 2 wins → 2 pts
        { userId: "user-c", pickResult: "win" },
        { userId: "user-c", pickResult: "win" },
      ],
      ["user-a", "user-b", "user-c"],
    );

    expect(standings).toEqual([
      {
        userId: "user-a",
        wins: 2,
        losses: 0,
        pushes: 1,
        points: 2.5,
        rank: 1,
      },
      { userId: "user-c", wins: 2, losses: 0, pushes: 0, points: 2, rank: 2 },
      { userId: "user-b", wins: 1, losses: 2, pushes: 0, points: 1, rank: 3 },
    ]);
  });

  it("includes members with no picks at 0-0-0 so ranks account for them", () => {
    const standings = calculateWeeklyStandings(
      [{ userId: "user-a", pickResult: "win" }],
      ["user-a", "user-b"],
    );
    expect(standings).toEqual([
      { userId: "user-a", wins: 1, losses: 0, pushes: 0, points: 1, rank: 1 },
      { userId: "user-b", wins: 0, losses: 0, pushes: 0, points: 0, rank: 2 },
    ]);
  });

  it("ignores picks from users not in the member list (§4.3 former members)", () => {
    const standings = calculateWeeklyStandings(
      [
        { userId: "user-a", pickResult: "win" },
        { userId: "removed-member", pickResult: "win" },
      ],
      ["user-a"],
    );
    expect(standings).toEqual([
      { userId: "user-a", wins: 1, losses: 0, pushes: 0, points: 1, rank: 1 },
    ]);
  });

  it("treats unscored (null) picks as 0 points without counting W/L/P", () => {
    const standings = calculateWeeklyStandings(
      [
        { userId: "user-a", pickResult: null },
        { userId: "user-a", pickResult: "win" },
      ],
      ["user-a"],
    );
    expect(standings[0]).toEqual({
      userId: "user-a",
      wins: 1,
      losses: 0,
      pushes: 0,
      points: 1,
      rank: 1,
    });
  });

  it("all-tied members share rank 1", () => {
    const standings = calculateWeeklyStandings(
      [],
      ["user-a", "user-b", "user-c"],
    );
    expect(standings.every((s) => s.rank === 1)).toBe(true);
    expect(standings.every((s) => s.points === 0)).toBe(true);
  });
});
