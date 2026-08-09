import { describe, expect, it } from "vitest";
import {
  NFL_REGULAR_SEASON_RANGE,
  SURVIVOR_PUSH_TIE_RESOLUTION,
  SurvivorSettingsInputSchema,
  SurvivorSettingsSchema,
  isWeekInSeasonRange,
  LEAGUE_SETTINGS_INPUT_SCHEMAS,
  LEAGUE_SETTINGS_SCHEMAS,
  MarchMadnessSettingsSchema,
  nflSeasonOrdinal,
  PICKEM_NOMINAL_RANGE,
  PICKEM_SEASON_RANGE_PRESET,
  pickemSettingsInvalidatePicks,
  PickemSettingsInputSchema,
  PickemSettingsSchema,
  survivorSettingsInvalidatePicks,
  type PickemSeasonRangePreset,
  type PickemSettings,
  type SurvivorSettings,
} from "./league-settings";
import { LEAGUE_MODE } from "./league-mode";
import { PICK_TYPE } from "./pick-type";
import { WEEK_TYPE } from "./week-type";

// Tests pin raw literals so a constant-value edit fails loudly (engineering
// rules §Quality).
const regular = (number: number) => ({ type: "regular" as const, number });
const postseason = (number: number) => ({ type: "postseason" as const, number });
const regularRange = (start: number, end: number) => ({
  startWeek: regular(start),
  endWeek: regular(end),
});

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

describe("isWeekInSeasonRange", () => {
  const week = (weekType: "regular" | "postseason", weekNumber: number) => ({
    weekType,
    weekNumber,
  });

  it.each([
    {
      label: "first week of the range",
      w: week("regular", 1),
      range: regularRange(1, 18),
      in: true,
    },
    {
      label: "last week of the range",
      w: week("regular", 18),
      range: regularRange(1, 18),
      in: true,
    },
    { label: "before the range", w: week("regular", 3), range: regularRange(5, 18), in: false },
    { label: "after the range", w: week("regular", 6), range: regularRange(1, 5), in: false },
    // The whole reason this isn't a `weekNumber` compare: a postseason week 1
    // is *after* regular week 18, and a naive numeric test reads it as before.
    {
      label: "Wild Card is outside a regular-season range",
      w: week("postseason", 1),
      range: regularRange(1, 18),
      in: false,
    },
    {
      label: "Wild Card is inside a postseason range",
      w: week("postseason", 1),
      range: { startWeek: postseason(1), endWeek: postseason(4) },
      in: true,
    },
    {
      label: "regular week 18 is outside a postseason range",
      w: week("regular", 18),
      range: { startWeek: postseason(1), endWeek: postseason(4) },
      in: false,
    },
    {
      label: "a full-season range spans the boundary",
      w: week("postseason", 4),
      range: { startWeek: regular(1), endWeek: postseason(4) },
      in: true,
    },
  ])("$label", ({ w, range, in: expected }) => {
    expect(isWeekInSeasonRange(w, range)).toBe(expected);
  });
});

describe("PickemSettingsSchema", () => {
  const base = {
    seasonRangePreset: "regular_season",
    startWeek: regular(1),
    endWeek: regular(18),
    pickType: "straight_up",
  };

  it("applies defaults: 5 picks per week", () => {
    const parsed = PickemSettingsSchema.parse(base);
    expect(parsed.picksPerWeek).toBe(5);
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
      input: {
        ...base,
        seasonRangePreset: "postseason",
        startWeek: postseason(1),
        endWeek: postseason(4),
      },
    },
    {
      label: "ATS with 16 picks",
      input: { ...base, pickType: "against_the_spread", picksPerWeek: 16 },
    },
    { label: "1 pick per week", input: { ...base, picksPerWeek: 1 } },
    {
      // Push is fixed at 0.5 (ADR-0018) and the setting is gone; Zod strips
      // unknown keys, so a league_seasons row stored before the removal still
      // parses instead of failing every read path that touches it.
      label: "a stored row still carrying the retired pushTieResolution key",
      input: { ...base, pushTieResolution: "full_point" },
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
    { label: "unknown pick type", input: { ...base, pickType: "parlay" } },
    { label: "unknown season range preset", input: { ...base, seasonRangePreset: "preseason" } },
    // The preset has no `.default()` on purpose: a stored row without one was
    // written before ADR-0020 and its range came from somewhere else entirely,
    // so defaulting it would mislabel that league rather than fail loudly.
    {
      label: "no season range preset at all",
      input: { startWeek: regular(1), endWeek: regular(18), pickType: "straight_up" },
    },
  ])("rejects $label", ({ input }) => {
    expect(PickemSettingsSchema.safeParse(input).success).toBe(false);
  });
});

describe("PickemSettingsInputSchema", () => {
  const base = { seasonRangePreset: "full_season", pickType: "straight_up" };

  it("applies defaults: 5 picks per week", () => {
    expect(PickemSettingsInputSchema.parse(base).picksPerWeek).toBe(5);
  });

  // The wire/stored divergence ADR-0020 rests on: a client naming week refs
  // gets them dropped, so resolution — not the request — decides the range.
  it("drops client-supplied week refs instead of carrying them through", () => {
    const parsed = PickemSettingsInputSchema.parse({
      ...base,
      startWeek: regular(9),
      endWeek: postseason(4),
    });
    expect(parsed).toEqual({
      seasonRangePreset: "full_season",
      pickType: "straight_up",
      picksPerWeek: 5,
    });
  });

  it.each([
    { label: "every preset", input: base },
    { label: "regular season", input: { ...base, seasonRangePreset: "regular_season" } },
    { label: "postseason", input: { ...base, seasonRangePreset: "postseason" } },
    {
      label: "ATS with 16 picks",
      input: { ...base, pickType: "against_the_spread", picksPerWeek: 16 },
    },
  ])("accepts $label", ({ input }) => {
    expect(PickemSettingsInputSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    { label: "unknown preset", input: { ...base, seasonRangePreset: "weeks_4_to_15" } },
    { label: "missing preset", input: { pickType: "straight_up" } },
    { label: "unknown pick type", input: { ...base, pickType: "parlay" } },
    { label: "17 picks per week", input: { ...base, picksPerWeek: 17 } },
  ])("rejects $label", ({ input }) => {
    expect(PickemSettingsInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("pickemSettingsInvalidatePicks", () => {
  const base: PickemSettings = {
    seasonRangePreset: "regular_season",
    startWeek: regular(1),
    endWeek: regular(18),
    pickType: "straight_up",
    picksPerWeek: 5,
  };

  it.each([
    {
      label: "pickType switches straight_up → against_the_spread",
      next: { ...base, pickType: "against_the_spread" as const },
    },
    {
      label: "pickType switches against_the_spread → straight_up",
      previous: { ...base, pickType: "against_the_spread" as const },
      next: base,
    },
    { label: "picksPerWeek is lowered", next: { ...base, picksPerWeek: 4 } },
    // A raise strands picks just as a lowering does, for the opposite reason:
    // under submit-once (ADR-0018) the member has spent their one submission
    // and would sit permanently under the new cap with no way to add picks.
    { label: "picksPerWeek is raised", next: { ...base, picksPerWeek: 6 } },
    { label: "startWeek moves later in season order", next: { ...base, startWeek: regular(2) } },
    {
      label: "startWeek moves later across the regular/postseason boundary",
      next: { ...base, startWeek: postseason(1) },
    },
    { label: "endWeek moves earlier in season order", next: { ...base, endWeek: regular(17) } },
    {
      label: "endWeek moves earlier across the regular/postseason boundary",
      previous: { ...base, endWeek: postseason(1) },
      next: base,
    },
  ])("invalidates when $label", ({ next, previous = base }) => {
    expect(pickemSettingsInvalidatePicks(previous, next)).toBe(true);
  });

  it.each([
    { label: "nothing changes", next: base },
    {
      label: "startWeek moves earlier (widens the range)",
      previous: { ...base, startWeek: regular(2) },
      next: base,
    },
    { label: "endWeek moves later (widens the range)", next: { ...base, endWeek: postseason(4) } },
    // The preset is a label for the range, not a second source of truth: the
    // resolved refs are what could strand a pick, so a preset that resolved to
    // the same range strands nothing.
    {
      label: "only the preset label changes, resolving to the same range",
      next: { ...base, seasonRangePreset: "full_season" as const },
    },
  ])("does not invalidate when $label", ({ next, previous = base }) => {
    expect(pickemSettingsInvalidatePicks(previous, next)).toBe(false);
  });
});

describe("survivorSettingsInvalidatePicks", () => {
  const base: SurvivorSettings = {
    startWeek: regular(1),
    endWeek: regular(18),
    pushTieResolution: "advance",
  };

  it("invalidates when startWeek moves later in season order", () => {
    expect(survivorSettingsInvalidatePicks(base, { ...base, startWeek: regular(2) })).toBe(true);
  });

  it.each([
    { label: "nothing changes", next: base },
    // Settlement reads this at grading time, so no stored pick becomes
    // ungradeable — this is the case the whole predicate exists to spare.
    {
      label: "pushTieResolution changes",
      next: { ...base, pushTieResolution: "eliminate" as const },
    },
    {
      label: "startWeek moves earlier (widens the range)",
      previous: { ...base, startWeek: regular(2) },
      next: base,
    },
  ])("does not invalidate when $label", ({ next, previous = base }) => {
    expect(survivorSettingsInvalidatePicks(previous, next)).toBe(false);
  });
});

describe("PICKEM_NOMINAL_RANGE", () => {
  it("pins each preset's nominal range", () => {
    expect(PICKEM_NOMINAL_RANGE).toEqual({
      regular_season: { startWeek: regular(1), endWeek: regular(18) },
      postseason: { startWeek: postseason(1), endWeek: postseason(4) },
      full_season: { startWeek: regular(1), endWeek: postseason(4) },
    });
  });

  // Resolution starts from these and the settings editor builds its draft from
  // them, so a nominal range that violates the stored schema's ordering rule
  // would surface as a thrown parse on a real save rather than here.
  it.each(Object.values(PICKEM_SEASON_RANGE_PRESET))(
    "%s's nominal range satisfies the stored schema",
    (preset) => {
      const parsed = PickemSettingsSchema.safeParse({
        seasonRangePreset: preset,
        ...PICKEM_NOMINAL_RANGE[preset],
        pickType: "straight_up",
      });
      expect(parsed.success).toBe(true);
    },
  );
});

/**
 * The question the pre-start settings editor actually asks before a save:
 * switching from one preset to another re-resolves the range server-side, so
 * "would this change strand already-submitted picks?" has to be answered from
 * the *new* preset's nominal range, not from the refs the league currently
 * stores. These cases are that answer, mode-level and copy-free — the warning's
 * wording and placement are presentation policy and deliberately untested.
 */
describe("changing the season-range preset", () => {
  function settingsFor(
    preset: PickemSeasonRangePreset,
    overrides: Partial<PickemSettings> = {},
  ): PickemSettings {
    return {
      seasonRangePreset: preset,
      startWeek: PICKEM_NOMINAL_RANGE[preset].startWeek,
      endWeek: PICKEM_NOMINAL_RANGE[preset].endWeek,
      pickType: "straight_up",
      picksPerWeek: 5,
      ...overrides,
    };
  }

  it.each([
    {
      label: "regular season → postseason skips every week already picked",
      from: "regular_season",
      to: "postseason",
    },
    {
      label: "full season → regular season drops the playoff weeks",
      from: "full_season",
      to: "regular_season",
    },
    {
      label: "full season → postseason drops the regular-season weeks",
      from: "full_season",
      to: "postseason",
    },
    {
      label: "postseason → regular season drops the playoff weeks",
      from: "postseason",
      to: "regular_season",
    },
  ] as const)("strands picks: $label", ({ from, to }) => {
    expect(pickemSettingsInvalidatePicks(settingsFor(from), settingsFor(to))).toBe(true);
  });

  it.each([
    {
      label: "regular season → full season only adds playoff weeks",
      from: "regular_season",
      to: "full_season",
    },
    {
      label: "postseason → full season only adds regular-season weeks",
      from: "postseason",
      to: "full_season",
    },
  ] as const)("strands nothing: $label", ({ from, to }) => {
    expect(pickemSettingsInvalidatePicks(settingsFor(from), settingsFor(to))).toBe(false);
  });

  // The case a nominal draft could get wrong and doesn't: a league created
  // mid-week stores a start *later* than its preset's nominal one (ADR-0020's
  // mid-week rule). Editing pick type alone must not read as narrowing the
  // range back to week 1 — nominal-vs-stored is a widening, which strands
  // nothing.
  it("does not strand picks when a mid-week-resolved league keeps its preset", () => {
    const stored = settingsFor("regular_season", { startWeek: regular(5) });
    expect(pickemSettingsInvalidatePicks(stored, settingsFor("regular_season"))).toBe(false);
  });
});

describe("SurvivorSettingsSchema", () => {
  const base = {
    startWeek: regular(1),
    endWeek: regular(18),
  };

  it("applies default: advance on push", () => {
    expect(SurvivorSettingsSchema.parse(base).pushTieResolution).toBe("advance");
  });

  it.each([
    { label: "full regular season", input: base },
    { label: "single week", input: { ...base, startWeek: regular(7), endWeek: regular(7) } },
    { label: "eliminate on push", input: { ...base, pushTieResolution: "eliminate" } },
  ])("accepts $label", ({ input }) => {
    expect(SurvivorSettingsSchema.safeParse(input).success).toBe(true);
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
    expect(SurvivorSettingsSchema.safeParse(input).success).toBe(false);
  });

  // The stored shape is unchanged by ADR-0024 — only the wire shape lost the
  // range — so everything downstream keeps reading the refs it always did.
  it("round-trips the resolved refs the server stores, including a mid-season start", () => {
    const stored = {
      startWeek: regular(5),
      endWeek: regular(18),
      pushTieResolution: "advance" as const,
    };
    expect(SurvivorSettingsSchema.parse(stored)).toEqual(stored);
  });

  it("accepts the regular-season nominal range both modes resolve from", () => {
    expect(SurvivorSettingsSchema.safeParse(NFL_REGULAR_SEASON_RANGE).success).toBe(true);
  });
});

describe("SurvivorSettingsInputSchema", () => {
  it("carries only the settings a commissioner still chooses", () => {
    expect(SurvivorSettingsInputSchema.parse({})).toEqual({ pushTieResolution: "advance" });
  });

  // Everything else a client might send is decided somewhere other than the
  // wire: the range server-side against the clock (ADR-0024), and the pick type
  // by the mode itself (ADR-0026 — Survivor is straight-up only). Stripping
  // rather than refusing is what keeps an out-of-date client from failing a
  // league creation over a setting it can't influence either way.
  it.each([
    { label: "a start week", input: { startWeek: regular(5) } },
    { label: "an end week", input: { endWeek: regular(10) } },
    {
      label: "the whole pre-ADR-0024 range",
      input: { startWeek: regular(1), endWeek: regular(18) },
    },
    {
      label: "a season-range preset it has no vocabulary for",
      input: { seasonRangePreset: "regular_season" },
    },
    { label: "a pick type", input: { pickType: "straight_up" } },
  ])("strips $label from the wire", ({ input }) => {
    expect(SurvivorSettingsInputSchema.parse(input)).toEqual({ pushTieResolution: "advance" });
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
    expect(LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.SURVIVOR]).toBe(SurvivorSettingsSchema);
    expect(LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.MARCH_MADNESS]).toBe(MarchMadnessSettingsSchema);
  });

  // Both NFL modes' entries differ from the stored map (ADR-0020, ADR-0024):
  // each has its season range resolved rather than chosen. March Madness has
  // no range, and an entry of its drifting apart would mean a wire shape
  // nothing resolves into the stored one.
  it("dispatches every league mode to its input schema, diverging for both NFL modes", () => {
    expect(Object.keys(LEAGUE_SETTINGS_INPUT_SCHEMAS).sort()).toEqual(
      Object.values(LEAGUE_MODE).sort(),
    );
    expect(LEAGUE_SETTINGS_INPUT_SCHEMAS[LEAGUE_MODE.PICKEM]).toBe(PickemSettingsInputSchema);
    expect(LEAGUE_SETTINGS_INPUT_SCHEMAS[LEAGUE_MODE.SURVIVOR]).toBe(SurvivorSettingsInputSchema);
    expect(LEAGUE_SETTINGS_INPUT_SCHEMAS[LEAGUE_MODE.MARCH_MADNESS]).toBe(
      MarchMadnessSettingsSchema,
    );
  });

  it("pins the wire values other packages build on", () => {
    expect(Object.values(LEAGUE_MODE).sort()).toEqual(["march_madness", "pickem", "survivor"]);
    expect(Object.values(PICK_TYPE).sort()).toEqual(["against_the_spread", "straight_up"]);
    expect(Object.values(SURVIVOR_PUSH_TIE_RESOLUTION).sort()).toEqual(["advance", "eliminate"]);
    expect(Object.values(WEEK_TYPE).sort()).toEqual(["postseason", "regular"]);
    expect(Object.values(PICKEM_SEASON_RANGE_PRESET).sort()).toEqual([
      "full_season",
      "postseason",
      "regular_season",
    ]);
  });
});
