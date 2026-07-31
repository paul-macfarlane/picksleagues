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
    differential: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    rank: 1,
    ...overrides,
  };
}

/**
 * The table is sortable by any column, but the *board* is the server's: rank is
 * competition ranking computed at settlement, so these tests pin that sorting
 * only reorders rows and never renumbers them.
 */
describe("sortStandingsRows", () => {
  // Server order is display-name ascending, which is also the tie order these
  // rows are expected to fall back to.
  const board = [
    row({ displayName: "Alpha", points: 3, differential: 10, wins: 3, losses: 1, rank: 1 }),
    row({
      displayName: "Bravo",
      points: 3,
      differential: 4,
      wins: 2,
      losses: 1,
      pushes: 2,
      rank: 2,
    }),
    row({ displayName: "Charlie", points: 1, differential: -6, wins: 1, losses: 3, rank: 3 }),
    row({ displayName: "Delta", points: 3, differential: 10, wins: 3, losses: 1, rank: 1 }),
  ];

  const names = (rows: readonly PickemStandingsRow[]) => rows.map((r) => r.displayName);

  it("defaults to rank ascending — the league's actual standing", () => {
    expect(DEFAULT_STANDINGS_SORT).toEqual({ column: "rank", direction: "ascending" });
    expect(names(sortStandingsRows(board, DEFAULT_STANDINGS_SORT))).toEqual([
      "Alpha",
      "Delta",
      "Bravo",
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
      column: STANDINGS_SORT_COLUMN.DIFFERENTIAL,
      direction: SORT_DIRECTION.DESCENDING,
      expected: ["Alpha", "Delta", "Bravo", "Charlie"],
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
      expected: ["Charlie", "Bravo", "Alpha", "Delta"],
    },
  ])("sorts by $column $direction", ({ column, direction, expected }) => {
    expect(names(sortStandingsRows(board, { column, direction }))).toEqual(expected);
  });

  it("is stable — rows the comparator calls equal keep the server's order", () => {
    // Alpha and Delta are level on points, differential, and record; the server
    // sent them name-ascending and every sort must preserve that, in both
    // directions (a reversed comparator must not reverse the tie group).
    const byPoints = sortStandingsRows(board, {
      column: STANDINGS_SORT_COLUMN.POINTS,
      direction: SORT_DIRECTION.DESCENDING,
    });
    expect(byPoints.indexOf(byPoints.find((r) => r.displayName === "Alpha")!)).toBeLessThan(
      byPoints.indexOf(byPoints.find((r) => r.displayName === "Delta")!),
    );

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
            ["Alpha", 1],
            ["Bravo", 2],
            ["Charlie", 3],
            ["Delta", 1], // shares rank 1 with Alpha — still 1, wherever it lands
          ]),
        );
      }
    }
  });

  it("does not mutate the rows it was given", () => {
    const snapshot = names(board);
    sortStandingsRows(board, {
      column: STANDINGS_SORT_COLUMN.DIFFERENTIAL,
      direction: SORT_DIRECTION.DESCENDING,
    });
    expect(names(board)).toEqual(snapshot);
  });

  it("handles an empty board", () => {
    expect(sortStandingsRows([], DEFAULT_STANDINGS_SORT)).toEqual([]);
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
    { column: STANDINGS_SORT_COLUMN.DIFFERENTIAL, direction: "descending" },
    { column: STANDINGS_SORT_COLUMN.RECORD, direction: "descending" },
  ])("opens $column at $direction — best first for a scoring column", ({ column, direction }) => {
    expect(nextStandingsSort(DEFAULT_STANDINGS_SORT, column)).toEqual({ column, direction });
  });
});
