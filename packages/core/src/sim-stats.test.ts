import { describe, expect, it } from "vitest";
import {
  deriveAtsSummary,
  deriveFpiWinPct,
  deriveLastFive,
  deriveTeamSeasonRecord,
  simInjuries,
  type SimCompletedGame,
} from "./sim-stats";

/** Completed game between two of PHI/DAL/NYG, kickoffs a week apart in `order`. */
function game(overrides: {
  order: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  spread?: number | null;
}): SimCompletedGame {
  return {
    homeTeamProviderId: `${overrides.home}-id`,
    awayTeamProviderId: `${overrides.away}-id`,
    homeTeamAbbr: overrides.home,
    awayTeamAbbr: overrides.away,
    homeScore: overrides.homeScore,
    awayScore: overrides.awayScore,
    kickoffAt: new Date(Date.UTC(2026, 8, 7 + overrides.order * 7)),
    spread: overrides.spread ?? null,
  };
}

describe("deriveTeamSeasonRecord", () => {
  it("accumulates overall and home/road splits with points", () => {
    const completed = [
      game({ order: 1, home: "PHI", away: "DAL", homeScore: 24, awayScore: 20 }),
      game({ order: 2, home: "NYG", away: "PHI", homeScore: 10, awayScore: 31 }),
      game({ order: 3, home: "PHI", away: "NYG", homeScore: 17, awayScore: 17 }),
      game({ order: 4, home: "DAL", away: "PHI", homeScore: 28, awayScore: 3 }),
      // A game not involving PHI must not count.
      game({ order: 5, home: "DAL", away: "NYG", homeScore: 7, awayScore: 6 }),
    ];

    expect(deriveTeamSeasonRecord("PHI-id", completed)).toEqual({
      wins: 2,
      losses: 1,
      ties: 1,
      homeWins: 1,
      homeLosses: 0,
      homeTies: 1,
      roadWins: 1,
      roadLosses: 1,
      roadTies: 0,
      streak: -1,
      pointsFor: 24 + 31 + 17 + 3,
      pointsAgainst: 20 + 10 + 17 + 28,
    });
  });

  it.each([
    // Latest-first sequences and their signed streaks; a tie carries none.
    { name: "win streak", scores: [[24, 20] as const, [31, 10] as const], expected: 2 },
    {
      name: "loss streak broken by earlier win",
      scores: [[3, 28] as const, [24, 20] as const],
      expected: -1,
    },
    { name: "tie carries no streak", scores: [[17, 17] as const, [24, 20] as const], expected: 0 },
  ])("streak: $name", ({ scores, expected }) => {
    // scores[0] is the most recent game (highest order).
    const completed = scores.map(([teamScore, oppScore], index) =>
      game({
        order: scores.length - index,
        home: "PHI",
        away: "DAL",
        homeScore: teamScore,
        awayScore: oppScore,
      }),
    );
    expect(deriveTeamSeasonRecord("PHI-id", completed).streak).toBe(expected);
  });

  it("is all zeros for a team with no completed games", () => {
    expect(deriveTeamSeasonRecord("PHI-id", []).wins).toBe(0);
    expect(deriveTeamSeasonRecord("PHI-id", []).streak).toBe(0);
  });
});

describe("deriveAtsSummary", () => {
  it("grades covers from each side's perspective and formats pushes only when present", () => {
    const completed = [
      // PHI -3 at home, wins by 4: PHI covers, DAL doesn't.
      game({ order: 1, home: "PHI", away: "DAL", homeScore: 24, awayScore: 20, spread: -3 }),
      // PHI +3 on the road, loses by 3: exact push for both sides.
      game({ order: 2, home: "DAL", away: "PHI", homeScore: 20, awayScore: 17, spread: -3 }),
      // No line — contributes to nobody's ATS record.
      game({ order: 3, home: "PHI", away: "DAL", homeScore: 40, awayScore: 0, spread: null }),
    ];

    expect(deriveAtsSummary("PHI-id", completed)).toBe("1-0-1");
    expect(deriveAtsSummary("DAL-id", completed)).toBe("0-1-1");
  });

  it("is null when no completed game carried a line — ESPN's early-season shape", () => {
    const completed = [
      game({ order: 1, home: "PHI", away: "DAL", homeScore: 24, awayScore: 20, spread: null }),
    ];
    expect(deriveAtsSummary("PHI-id", completed)).toBeNull();
  });
});

describe("deriveLastFive", () => {
  it("returns up to five most-recent games, newest first, from the team's perspective", () => {
    const completed = Array.from({ length: 7 }, (_, i) =>
      game({
        order: i + 1,
        home: i % 2 === 0 ? "PHI" : "DAL",
        away: i % 2 === 0 ? "DAL" : "PHI",
        homeScore: 20 + i,
        awayScore: 10,
      }),
    );

    const lastFive = deriveLastFive("PHI-id", completed);

    expect(lastFive).toHaveLength(5);
    // Newest game: order 7 → home PHI, 26-10.
    expect(lastFive[0]).toEqual({
      result: "W",
      opponentAbbr: "DAL",
      teamScore: 26,
      opponentScore: 10,
      atHome: true,
    });
    // Its predecessor was a road loss (DAL home 25, PHI away 10).
    expect(lastFive[1]).toMatchObject({ result: "L", teamScore: 10, atHome: false });
  });
});

describe("deriveFpiWinPct", () => {
  it("maps the spread to complementary percentages and clamps the extremes", () => {
    // Home favored by 7 → home 67.5, away 32.5.
    expect(deriveFpiWinPct(-7, "home")).toBe(67.5);
    expect(deriveFpiWinPct(-7, "away")).toBe(32.5);
    // A max-grid spread clamps rather than reading as certainty.
    expect(deriveFpiWinPct(-28, "home")).toBe(95);
    expect(deriveFpiWinPct(28, "home")).toBe(5);
  });

  it("is null with no line — the omission path the UI must handle", () => {
    expect(deriveFpiWinPct(null, "home")).toBeNull();
  });
});

describe("simInjuries", () => {
  it("is deterministic per team and always leads with a key injury", () => {
    const first = simInjuries("PHI");
    const second = simInjuries("PHI");

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first.length).toBeLessThanOrEqual(3);
    // Entry 0 pins the basic tier's "key injury" filter (never Questionable).
    expect(first[0]!.status).toBe("Out");
    for (const entry of first) {
      expect(entry.athleteName).toMatch(/^\S+ \S+$/);
      expect(entry.position).toBeTruthy();
      expect(entry.injuryType).toBeTruthy();
    }
  });

  it("differs across teams (hash actually keyed on the abbreviation)", () => {
    const teams = ["PHI", "DAL", "NYG", "WSH", "SEA", "NE"];
    const reports = teams.map((team) => JSON.stringify(simInjuries(team)));
    expect(new Set(reports).size).toBeGreaterThan(1);
  });
});
