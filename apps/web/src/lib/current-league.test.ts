import { describe, expect, it } from "vitest";
import type { LeagueSummary } from "@picksleagues/schemas";
import { resolveCurrentLeague } from "./current-league";

const league = (id: string) => ({ id }) as LeagueSummary;
const leagues = [league("a"), league("b")];

describe("resolveCurrentLeague", () => {
  it.each([
    ["remembered league the member still belongs to", leagues, "b", "b"],
    ["remembered league the member has left", leagues, "gone", "a"],
    ["nothing remembered", leagues, null, "a"],
  ])("%s", (_, list, remembered, expected) => {
    expect(resolveCurrentLeague(list, remembered)?.id).toBe(expected);
  });

  it("resolves to nothing for a member with no leagues", () => {
    expect(resolveCurrentLeague([], "a")).toBeUndefined();
  });
});
