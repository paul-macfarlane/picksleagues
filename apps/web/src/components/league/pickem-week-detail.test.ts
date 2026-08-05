import { describe, expect, it } from "vitest";
import type { PickemMemberPicks, PickemStandingsRow } from "@picksleagues/schemas";
import { orderMembersByWeek } from "./pickem-week-detail";

function member(id: string, displayName: string): PickemMemberPicks {
  return {
    leagueMemberId: id,
    userId: `user-${id}`,
    username: displayName.toLowerCase(),
    displayName,
    image: null,
    isViewer: false,
    picks: [],
    hiddenPickCount: 0,
  };
}

function standing(id: string, rank: number): PickemStandingsRow {
  return {
    leagueMemberId: id,
    userId: `user-${id}`,
    username: id,
    displayName: id,
    image: null,
    isViewer: false,
    points: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    rank,
  };
}

/**
 * The order the league's picks are read in. It defers entirely to the server's
 * rank (spec §Standings) — the cases here pin *which* board wins and where
 * the unranked land, not the ranking rule itself, which lives in
 * `packages/scoring`.
 */
describe("orderMembersByWeek", () => {
  const ana = member("a", "Ana");
  const bo = member("b", "Bo");
  const cy = member("c", "Cy");
  const names = (rows: PickemMemberPicks[]) => rows.map((row) => row.displayName);

  it("orders by the week's rank, best first", () => {
    const ordered = orderMembersByWeek(
      [bo, ana, cy],
      [standing("a", 2), standing("b", 3), standing("c", 1)],
      [],
    );
    expect(names(ordered)).toEqual(["Cy", "Ana", "Bo"]);
  });

  // A ranked member always precedes an unranked one. Worth pinning because the
  // obvious `rankA - rankB` comparator gets this wrong: `1 - Infinity` is
  // `-Infinity`, a correct sign but not a usable tie test, and it silently fell
  // through to the season tiebreak in the first version of this function.
  it("puts members with no weekly result after every ranked member", () => {
    const ordered = orderMembersByWeek([ana, bo], [standing("b", 4)], [standing("a", 1)]);
    expect(names(ordered)).toEqual(["Bo", "Ana"]);
  });

  // Nothing has settled this week, so the weekly board is empty for everyone.
  it("falls back to the season rank when the week has not settled", () => {
    const ordered = orderMembersByWeek(
      [ana, bo, cy],
      [],
      [standing("a", 3), standing("b", 1), standing("c", 2)],
    );
    expect(names(ordered)).toEqual(["Bo", "Cy", "Ana"]);
  });

  // Members level on points share a rank server-side and nothing is shown
  // behind it (ADR-0018 decision 4), so the order between them has to come
  // from somewhere stable — otherwise the two swap places between renders of
  // the same data.
  it("breaks a shared rank by display name", () => {
    const ordered = orderMembersByWeek([cy, ana, bo], [standing("a", 1), standing("b", 1)], []);
    expect(names(ordered)).toEqual(["Ana", "Bo", "Cy"]);
  });

  it("falls back to display name with no standings at all", () => {
    expect(names(orderMembersByWeek([cy, bo, ana], [], []))).toEqual(["Ana", "Bo", "Cy"]);
  });

  it("does not mutate the members it was given", () => {
    const input = [cy, ana];
    orderMembersByWeek(input, [standing("a", 1)], []);
    expect(names(input)).toEqual(["Cy", "Ana"]);
  });
});
