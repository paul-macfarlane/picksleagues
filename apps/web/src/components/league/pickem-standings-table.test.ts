import { describe, expect, it } from "vitest";
import type { PickemStandingsRow } from "@picksleagues/schemas";
import {
  DEFAULT_STANDINGS_SORT,
  nextStandingsSort,
  sortStandingsRows,
  SORT_DIRECTION,
  STANDINGS_SORT_COLUMN,
} from "./pickem-standings-table";

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
 * competition ranking on points alone (ADR-0018 decision 4), so these tests pin
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

  const names = (rows: readonly PickemStandingsRow[]) => rows.map((r) => r.displayName);

  it("defaults to rank ascending — the league's actual standing", () => {
    expect(DEFAULT_STANDINGS_SORT).toEqual({ column: "rank", direction: "ascending" });
    expect(names(sortStandingsRows(board, DEFAULT_STANDINGS_SORT))).toEqual([
      "Alpha",
      "Bravo",
      "Delta",
      "Charlie",
    ]);
  });

  it.each([
    {
      column: STANDINGS_SORT_COLUMN.POINTS,
      direction: SORT_DIRECTION.DESCENDING,
      expected: ["Alpha", "Bravo", "Delta", "Charlie"],
    },
    {
      column: STANDINGS_SORT_COLUMN.POINTS,
      direction: SORT_DIRECTION.ASCENDING,
      expected: ["Charlie", "Alpha", "Bravo", "Delta"],
    },
    {
      column: STANDINGS_SORT_COLUMN.RECORD,
      direction: SORT_DIRECTION.DESCENDING,
      expected: ["Alpha", "Delta", "Bravo", "Charlie"],
    },
    {
      column: STANDINGS_SORT_COLUMN.RECORD,
      direction: SORT_DIRECTION.ASCENDING,
      expected: ["Charlie", "Bravo", "Alpha", "Delta"],
    },
    {
      column: STANDINGS_SORT_COLUMN.MEMBER,
      direction: SORT_DIRECTION.DESCENDING,
      expected: ["Delta", "Charlie", "Bravo", "Alpha"],
    },
    {
      column: STANDINGS_SORT_COLUMN.RANK,
      direction: SORT_DIRECTION.DESCENDING,
      expected: ["Charlie", "Alpha", "Bravo", "Delta"],
    },
  ])("sorts by $column $direction", ({ column, direction, expected }) => {
    expect(names(sortStandingsRows(board, { column, direction }))).toEqual(expected);
  });

  it("is stable — rows the comparator calls equal keep the server's order", () => {
    // The three tied members are level on points and share a rank; the server
    // sent them name-ascending and every sort must preserve that, in both
    // directions (a reversed comparator must not reverse the tie group).
    const byPoints = sortStandingsRows(board, {
      column: STANDINGS_SORT_COLUMN.POINTS,
      direction: SORT_DIRECTION.DESCENDING,
    });
    expect(names(byPoints.filter((r) => r.points === 3))).toEqual(["Alpha", "Bravo", "Delta"]);

    const byRecord = sortStandingsRows(board, {
      column: STANDINGS_SORT_COLUMN.RECORD,
      direction: SORT_DIRECTION.ASCENDING,
    });
    expect(names(byRecord.filter((r) => r.wins === 3))).toEqual(["Alpha", "Delta"]);
  });

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

  it("does not mutate the rows it was given", () => {
    const snapshot = names(board);
    sortStandingsRows(board, {
      column: STANDINGS_SORT_COLUMN.POINTS,
      direction: SORT_DIRECTION.DESCENDING,
    });
    expect(names(board)).toEqual(snapshot);
  });

  it("handles an empty board", () => {
    expect(sortStandingsRows([], DEFAULT_STANDINGS_SORT)).toEqual([]);
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

describe("nextStandingsSort", () => {
  it("reverses the column already sorted", () => {
    expect(nextStandingsSort(DEFAULT_STANDINGS_SORT, STANDINGS_SORT_COLUMN.RANK)).toEqual({
      column: "rank",
      direction: "descending",
    });
    expect(
      nextStandingsSort(
        { column: STANDINGS_SORT_COLUMN.RANK, direction: SORT_DIRECTION.DESCENDING },
        STANDINGS_SORT_COLUMN.RANK,
      ),
    ).toEqual({ column: "rank", direction: "ascending" });
  });

  it.each([
    { column: STANDINGS_SORT_COLUMN.MEMBER, direction: "ascending" },
    { column: STANDINGS_SORT_COLUMN.POINTS, direction: "descending" },
    { column: STANDINGS_SORT_COLUMN.RECORD, direction: "descending" },
  ])("opens $column at $direction — best first for a scoring column", ({ column, direction }) => {
    expect(nextStandingsSort(DEFAULT_STANDINGS_SORT, column)).toEqual({ column, direction });
  });
});
