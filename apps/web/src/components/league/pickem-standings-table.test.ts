import { describe, expect, it } from "vitest";
import type { PickemStandingsRow } from "@picksleagues/schemas";
import { sortStandingsRows, SORT_DIRECTION, STANDINGS_SORT_COLUMN } from "./pickem-standings-table";

function row(overrides: Partial<PickemStandingsRow> & { displayName: string }): PickemStandingsRow {
  return {
    leagueMemberId: overrides.displayName.toLowerCase(),
    userId: `user-${overrides.displayName.toLowerCase()}`,
    username: overrides.displayName.toLowerCase(),
    image: null,
    isViewer: false,
    points: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    rank: 1,
    ...overrides,
  };
}

/**
 * The table is sortable by any column, but the *board* is the server's: rank is
 * competition ranking on points alone (ADR-0018 decision 4), so this test pins
 * that sorting only reorders rows and never renumbers them.
 */
describe("sortStandingsRows", () => {
  // Three members level on points, which under ADR-0018 decision 4 means three
  // members sharing rank 1 with nothing behind it to separate them — Bravo gets
  // there by a different route (2 wins + 2 pushes at half a point) than Alpha
  // and Delta, and the board still says they are level. Server order is rank
  // ascending then display name, which is also the tie order these rows are
  // expected to fall back to.
  const board = [
    row({ displayName: "Alpha", points: 3, wins: 3, losses: 1, rank: 1 }),
    row({ displayName: "Bravo", points: 3, wins: 2, losses: 1, pushes: 2, rank: 1 }),
    row({ displayName: "Delta", points: 3, wins: 3, losses: 1, rank: 1 }),
    row({ displayName: "Charlie", points: 1, wins: 1, losses: 3, rank: 4 }),
  ];

  it("never recomputes rank — every row keeps the server's, ties included", () => {
    for (const column of Object.values(STANDINGS_SORT_COLUMN)) {
      for (const direction of Object.values(SORT_DIRECTION)) {
        const sorted = sortStandingsRows(board, { column, direction });
        const ranks = new Map(sorted.map((r) => [r.displayName, r.rank]));
        expect(ranks).toEqual(
          new Map([
            // All three keep rank 1 wherever a sort lands them, and the rank
            // below them is 4 — competition ranking, ties consuming the places
            // behind them.
            ["Alpha", 1],
            ["Bravo", 1],
            ["Delta", 1],
            ["Charlie", 4],
          ]),
        );
      }
    }
  });
});

/**
 * ADR-0018 decision 4: members level on points share a rank with **nothing
 * shown behind them** — no differential, no secondary sort, no separator.
 *
 * Pinned as the column set rather than as rendered markup because the set is
 * what the board is made of: every column here is a header, a cell, and a sort,
 * so a tiebreaker cannot reappear on the board without appearing in this list
 * first. The row type no longer carries a differential at all, which is the
 * other half of the guarantee.
 */
describe("STANDINGS_SORT_COLUMN", () => {
  it("offers nothing behind points to separate tied members", () => {
    expect(Object.values(STANDINGS_SORT_COLUMN)).toEqual(["rank", "member", "record", "points"]);
  });
});
