import { describe, expect, it } from "vitest";
import { SIM_FINAL_STATUS, WEEK_TYPE, type SimFixtureGame } from "@picksleagues/schemas";
import {
  buildFixturePatch,
  fixtureFormSeed,
  isFixtureFormDirty,
  type FixtureFormValues,
} from "./fixture-patch";

// Sub-second kickoff on purpose: library scenarios anchor fixtures to the raw
// wall-clock instant at load, so millisecond components are the normal case and
// the one a minute-precision input silently destroys.
const GAME: SimFixtureGame = {
  id: "game-1",
  scenarioId: "scenario-1",
  providerGameId: "provider-1",
  weekType: WEEK_TYPE.REGULAR,
  weekNumber: 1,
  homeTeamAbbr: "AAA",
  homeTeamName: "Team AAA",
  awayTeamAbbr: "BBB",
  awayTeamName: "Team BBB",
  kickoffAt: "2026-07-26T21:37:41.812Z",
  spread: -3.5,
  finalStatus: SIM_FINAL_STATUS.FINAL,
  finalHomeScore: 24,
  finalAwayScore: 17,
  projectedStatus: "final",
  projectedHomeScore: 24,
  projectedAwayScore: 17,
};

const SEED = fixtureFormSeed(GAME);

function edit(changes: Partial<FixtureFormValues>): FixtureFormValues {
  return { ...SEED, ...changes };
}

describe("fixtureFormSeed", () => {
  it("renders nullable numbers as empty strings, not 'null'", () => {
    const seed = fixtureFormSeed({
      ...GAME,
      spread: null,
      finalHomeScore: null,
      finalAwayScore: null,
    });
    expect(seed.spread).toBe("");
    expect(seed.finalHomeScore).toBe("");
    expect(seed.finalAwayScore).toBe("");
  });
});

describe("buildFixturePatch", () => {
  it("reports an untouched form as unchanged rather than an empty-body error", () => {
    expect(buildFixturePatch(SEED, SEED)).toEqual({ status: "unchanged" });
  });

  // The regression this module exists for: `datetime-local` has no seconds, so
  // echoing the seeded kickoff back would rewrite it truncated to the minute.
  it("never sends kickoffAt when the operator only changed another field", () => {
    const result = buildFixturePatch(SEED, edit({ spread: "-7.5" }));

    expect(result).toEqual({ status: "ok", patch: { spread: -7.5 } });
    expect(result).not.toHaveProperty("patch.kickoffAt");
  });

  it("sends kickoffAt as an ISO instant when it is actually edited", () => {
    const result = buildFixturePatch(SEED, edit({ kickoffAt: "2026-07-26T18:00" }));

    expect(result.status).toBe("ok");
    // Parsed as local wall-clock (what the input means), so assert the
    // round-trip rather than a fixed UTC string the test's TZ would decide.
    if (result.status === "ok") {
      expect(result.patch.kickoffAt).toBe(new Date("2026-07-26T18:00").toISOString());
    }
  });

  it.each(["spread", "finalHomeScore", "finalAwayScore"] as const)(
    "clearing %s sends an explicit null, not a skipped field",
    (field) => {
      const result = buildFixturePatch(SEED, edit({ [field]: "" }));

      expect(result).toEqual({ status: "ok", patch: { [field]: null } });
    },
  );

  it.each([
    ["abc", "letters"],
    ["-", "a lone minus"],
    ["1.2.3", "a malformed decimal"],
  ])("rejects %s in a numeric field instead of silently clearing it (%s)", (raw) => {
    const result = buildFixturePatch(SEED, edit({ spread: raw }));

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.fieldErrors.spread).toBeDefined();
    }
  });

  it("treats whitespace as a clear, not as zero", () => {
    expect(buildFixturePatch(SEED, edit({ spread: "   " }))).toEqual({
      status: "ok",
      patch: { spread: null },
    });
  });

  it("surfaces an out-of-range score on its own field, deferring the bound to the schema", () => {
    const result = buildFixturePatch(SEED, edit({ finalHomeScore: "500" }));

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.fieldErrors.finalHomeScore).toBeDefined();
      expect(result.fieldErrors.spread).toBeUndefined();
    }
  });

  it("rejects an emptied week number rather than sending 0", () => {
    const result = buildFixturePatch(SEED, edit({ weekNumber: "" }));

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.fieldErrors.weekNumber).toBeDefined();
  });

  it("reports a cleared kickoff as a field error rather than throwing on toISOString", () => {
    const result = buildFixturePatch(SEED, edit({ kickoffAt: "" }));

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.fieldErrors.kickoffAt).toBeDefined();
  });

  it("sends every field the operator did change, and only those", () => {
    const result = buildFixturePatch(
      SEED,
      edit({
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: "2",
        finalStatus: SIM_FINAL_STATUS.CANCELLED,
        finalHomeScore: "",
        finalAwayScore: "",
      }),
    );

    expect(result).toEqual({
      status: "ok",
      patch: {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 2,
        finalStatus: SIM_FINAL_STATUS.CANCELLED,
        finalHomeScore: null,
        finalAwayScore: null,
      },
    });
  });
});

describe("isFixtureFormDirty", () => {
  it("is false for the untouched seed and true for any single change", () => {
    expect(isFixtureFormDirty(SEED, SEED)).toBe(false);
    expect(isFixtureFormDirty(SEED, edit({ spread: "-7" }))).toBe(true);
  });
});
