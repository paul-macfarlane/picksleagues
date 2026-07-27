import { describe, expect, it } from "vitest";
import {
  ELIMINATION_PUSH_TIE_RESOLUTION,
  EliminationSettingsSchema,
  LEAGUE_SETTINGS_SCHEMAS,
  MarchMadnessSettingsSchema,
  nflSeasonOrdinal,
  PICKEM_PUSH_TIE_RESOLUTION,
  PickemSettingsSchema,
} from "./league-settings";
import { LEAGUE_MODE } from "./league-mode";
import { PICK_TYPE } from "./pick-type";
import { WEEK_TYPE } from "./week-type";

// Tests pin raw literals so a constant-value edit fails loudly (engineering
// rules §Quality).
const regular = (number: number) => ({ type: "regular" as const, number });
const postseason = (number: number) => ({ type: "postseason" as const, number });

describe("nflSeasonOrdinal", () => {
  it.each([
    { label: "regular week 1", week: regular(1), expected: 1 },
    { label: "regular week 18", week: regular(18), expected: 18 },
    { label: "Wild Card follows week 18", week: postseason(1), expected: 19 },
    { label: "Super Bowl is last", week: postseason(4), expected: 22 },
  ])("$label", ({ week, expected }) => {
    expect(nflSeasonOrdinal(week)).toBe(expected);
  });
});

describe("PickemSettingsSchema", () => {
  const base = {
    startWeek: regular(1),
    endWeek: regular(18),
    pickType: "straight_up",
  };

  it("applies defaults: 5 picks per week, half-point pushes", () => {
    const parsed = PickemSettingsSchema.parse(base);
    expect(parsed.picksPerWeek).toBe(5);
    expect(parsed.pushTieResolution).toBe("half_point");
  });

  it.each([
    {
      label: "single-week league (start == end)",
      input: { ...base, endWeek: regular(1), startWeek: regular(1) },
    },
    {
      label: "regular start, playoff end",
      input: { ...base, startWeek: regular(10), endWeek: postseason(4) },
    },
    {
      label: "playoff-only league",
      input: { ...base, startWeek: postseason(1), endWeek: postseason(4) },
    },
    {
      label: "ATS with full-point pushes, 16 picks",
      input: {
        ...base,
        pickType: "against_the_spread",
        picksPerWeek: 16,
        pushTieResolution: "full_point",
      },
    },
    {
      label: "1 pick per week, zero-point pushes",
      input: { ...base, picksPerWeek: 1, pushTieResolution: "zero_points" },
    },
  ])("accepts $label", ({ input }) => {
    expect(PickemSettingsSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    {
      label: "end before start (regular)",
      input: { ...base, startWeek: regular(5), endWeek: regular(4) },
    },
    {
      label: "end in regular after playoff start",
      input: { ...base, startWeek: postseason(1), endWeek: regular(18) },
    },
    { label: "regular week 0", input: { ...base, startWeek: regular(0) } },
    { label: "regular week 19", input: { ...base, endWeek: regular(19) } },
    { label: "postseason round 5", input: { ...base, endWeek: postseason(5) } },
    { label: "0 picks per week", input: { ...base, picksPerWeek: 0 } },
    { label: "17 picks per week", input: { ...base, picksPerWeek: 17 } },
    { label: "fractional picks per week", input: { ...base, picksPerWeek: 2.5 } },
    { label: "unknown push resolution", input: { ...base, pushTieResolution: "quarter_point" } },
    { label: "unknown pick type", input: { ...base, pickType: "parlay" } },
  ])("rejects $label", ({ input }) => {
    expect(PickemSettingsSchema.safeParse(input).success).toBe(false);
  });
});

describe("EliminationSettingsSchema", () => {
  const base = {
    startWeek: regular(1),
    endWeek: regular(18),
    pickType: "straight_up",
  };

  it("applies default: advance on push", () => {
    expect(EliminationSettingsSchema.parse(base).pushTieResolution).toBe("advance");
  });

  it.each([
    { label: "full regular season", input: base },
    { label: "single week", input: { ...base, startWeek: regular(7), endWeek: regular(7) } },
    { label: "eliminate on push", input: { ...base, pushTieResolution: "eliminate" } },
  ])("accepts $label", ({ input }) => {
    expect(EliminationSettingsSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    { label: "end before start", input: { ...base, startWeek: regular(9), endWeek: regular(8) } },
    {
      label: "postseason start (regular-season only)",
      input: { ...base, startWeek: postseason(1) },
    },
    { label: "postseason end (regular-season only)", input: { ...base, endWeek: postseason(1) } },
    { label: "week 0", input: { ...base, startWeek: regular(0) } },
    { label: "week 19", input: { ...base, endWeek: regular(19) } },
  ])("rejects $label", ({ input }) => {
    expect(EliminationSettingsSchema.safeParse(input).success).toBe(false);
  });
});

describe("MarchMadnessSettingsSchema", () => {
  it("applies default: 5 brackets per member", () => {
    const parsed = MarchMadnessSettingsSchema.parse({ scoringModel: "standard_doubling" });
    expect(parsed.maxBracketsPerMember).toBe(5);
  });

  it.each([
    {
      label: "standard doubling",
      input: { scoringModel: "standard_doubling", maxBracketsPerMember: 1 },
    },
    {
      label: "custom with six round values",
      input: { scoringModel: "custom", roundValues: [1, 2, 4, 8, 16, 32] },
    },
    {
      label: "custom allows zero-value rounds",
      input: { scoringModel: "custom", roundValues: [0, 0, 0, 0, 0, 1] },
    },
    {
      label: "10 brackets",
      input: { scoringModel: "standard_doubling", maxBracketsPerMember: 10 },
    },
  ])("accepts $label", ({ input }) => {
    expect(MarchMadnessSettingsSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    { label: "0 brackets", input: { scoringModel: "standard_doubling", maxBracketsPerMember: 0 } },
    {
      label: "11 brackets",
      input: { scoringModel: "standard_doubling", maxBracketsPerMember: 11 },
    },
    { label: "custom without round values", input: { scoringModel: "custom" } },
    {
      label: "custom with five round values",
      input: { scoringModel: "custom", roundValues: [1, 2, 4, 8, 16] },
    },
    {
      label: "custom with seven round values",
      input: { scoringModel: "custom", roundValues: [1, 2, 4, 8, 16, 32, 64] },
    },
    {
      label: "negative round value",
      input: { scoringModel: "custom", roundValues: [1, 2, 4, 8, 16, -1] },
    },
    {
      label: "fractional round value",
      input: { scoringModel: "custom", roundValues: [1, 2, 4, 8, 16, 0.5] },
    },
    { label: "unknown scoring model", input: { scoringModel: "tripling" } },
  ])("rejects $label", ({ input }) => {
    expect(MarchMadnessSettingsSchema.safeParse(input).success).toBe(false);
  });

  it("strips round values from a standard-doubling league so stale values can't persist", () => {
    const parsed = MarchMadnessSettingsSchema.parse({
      scoringModel: "standard_doubling",
      roundValues: [1, 2, 4, 8, 16, 32],
    });
    expect("roundValues" in parsed).toBe(false);
  });
});

describe("LEAGUE_SETTINGS_SCHEMAS", () => {
  it("dispatches every league mode to its settings schema", () => {
    expect(Object.keys(LEAGUE_SETTINGS_SCHEMAS).sort()).toEqual(Object.values(LEAGUE_MODE).sort());
    expect(LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM]).toBe(PickemSettingsSchema);
    expect(LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.ELIMINATION]).toBe(EliminationSettingsSchema);
    expect(LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.MARCH_MADNESS]).toBe(MarchMadnessSettingsSchema);
  });

  it("pins the wire values other packages build on", () => {
    expect(Object.values(LEAGUE_MODE).sort()).toEqual(["elimination", "march_madness", "pickem"]);
    expect(Object.values(PICK_TYPE).sort()).toEqual(["against_the_spread", "straight_up"]);
    expect(Object.values(PICKEM_PUSH_TIE_RESOLUTION).sort()).toEqual([
      "full_point",
      "half_point",
      "zero_points",
    ]);
    expect(Object.values(ELIMINATION_PUSH_TIE_RESOLUTION).sort()).toEqual(["advance", "eliminate"]);
    expect(Object.values(WEEK_TYPE).sort()).toEqual(["postseason", "regular"]);
  });
});
