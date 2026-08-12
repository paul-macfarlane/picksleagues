import { describe, expect, it } from "vitest";
import {
  NFL_REGULAR_SEASON_RANGE,
  SurvivorSettingsInputSchema,
  SurvivorSettingsSchema,
  isWeekInSeasonRange,
  LEAGUE_SETTINGS_INPUT_SCHEMAS,
  LEAGUE_SETTINGS_SCHEMAS,
  MarchMadnessSettingsSchema,
  nflSeasonOrdinal,
  pickemSettingsInvalidatePicks,
  PickemSettingsInputSchema,
  PickemSettingsSchema,
  survivorSettingsInvalidatePicks,
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
      label: "mid-season resolved start",
      input: { ...base, startWeek: regular(5) },
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
    {
      // Same stripping rule for the preset ADR-0031 retired: a row written
      // under ADR-0020 carries the label alongside the refs it resolved to,
      // and the refs are all anything downstream ever computed on.
      label: "a stored row still carrying the retired seasonRangePreset key",
      input: { ...base, seasonRangePreset: "regular_season" },
    },
  ])("accepts $label", ({ input }) => {
    expect(PickemSettingsSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    {
      label: "end before start",
      input: { ...base, startWeek: regular(5), endWeek: regular(4) },
    },
    // The mode is regular-season only (ADR-0031): a postseason ref anywhere in
    // a stored range is a bug, not a configuration.
    {
      label: "postseason start",
      input: { ...base, startWeek: postseason(1), endWeek: postseason(4) },
    },
    { label: "postseason end", input: { ...base, endWeek: postseason(1) } },
    { label: "regular week 0", input: { ...base, startWeek: regular(0) } },
    { label: "regular week 19", input: { ...base, endWeek: regular(19) } },
    { label: "0 picks per week", input: { ...base, picksPerWeek: 0 } },
    { label: "17 picks per week", input: { ...base, picksPerWeek: 17 } },
    { label: "fractional picks per week", input: { ...base, picksPerWeek: 2.5 } },
    { label: "unknown pick type", input: { ...base, pickType: "parlay" } },
  ])("rejects $label", ({ input }) => {
    expect(PickemSettingsSchema.safeParse(input).success).toBe(false);
  });
});

describe("PickemSettingsInputSchema", () => {
  const base = { pickType: "straight_up" };

  it("applies defaults: 5 picks per week", () => {
    expect(PickemSettingsInputSchema.parse(base).picksPerWeek).toBe(5);
  });

  // The wire/stored divergence ADR-0031 keeps from ADR-0020: a client naming
  // week refs — or the preset clients sent until ADR-0031 — gets them
  // dropped, so resolution, not the request, decides the range.
  it("drops client-supplied week refs and the retired preset instead of carrying them through", () => {
    const parsed = PickemSettingsInputSchema.parse({
      ...base,
      seasonRangePreset: "postseason",
      startWeek: regular(9),
      endWeek: postseason(4),
    });
    expect(parsed).toEqual({
      pickType: "straight_up",
      picksPerWeek: 5,
    });
  });

  it.each([
    { label: "the minimal request", input: base },
    {
      label: "ATS with 16 picks",
      input: { ...base, pickType: "against_the_spread", picksPerWeek: 16 },
    },
  ])("accepts $label", ({ input }) => {
    expect(PickemSettingsInputSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    { label: "missing pick type", input: {} },
    { label: "unknown pick type", input: { ...base, pickType: "parlay" } },
    { label: "17 picks per week", input: { ...base, picksPerWeek: 17 } },
  ])("rejects $label", ({ input }) => {
    expect(PickemSettingsInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("pickemSettingsInvalidatePicks", () => {
  const base: PickemSettings = {
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
    // The one range clause left (ADR-0031): the server's pre-start
    // re-resolution can advance the start under an unchanged request.
    { label: "startWeek moves later in season order", next: { ...base, startWeek: regular(2) } },
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
    // Pins the deliberate absence of a narrowing-end clause: the end week is
    // fixed at regular week 18 with no path that lowers it (ADR-0031), so the
    // clause would be inert protection.
    {
      label: "endWeek differs (no write path can produce this)",
      next: { ...base, endWeek: regular(17) },
    },
  ])("does not invalidate when $label", ({ next, previous = base }) => {
    expect(pickemSettingsInvalidatePicks(previous, next)).toBe(false);
  });
});

describe("survivorSettingsInvalidatePicks", () => {
  const base: SurvivorSettings = {
    startWeek: regular(1),
    endWeek: regular(18),
  };

  it("invalidates when startWeek moves later in season order", () => {
    expect(survivorSettingsInvalidatePicks(base, { ...base, startWeek: regular(2) })).toBe(true);
  });

  it.each([
    { label: "nothing changes", next: base },
    {
      label: "startWeek moves earlier (widens the range)",
      previous: { ...base, startWeek: regular(2) },
      next: base,
    },
  ])("does not invalidate when $label", ({ next, previous = base }) => {
    expect(survivorSettingsInvalidatePicks(previous, next)).toBe(false);
  });
});

describe("SurvivorSettingsSchema", () => {
  const base = {
    startWeek: regular(1),
    endWeek: regular(18),
  };

  it.each([
    { label: "full regular season", input: base },
    { label: "single week", input: { ...base, startWeek: regular(7), endWeek: regular(7) } },
    {
      // A tie is fixed at advance-with-team-consumed (ADR-0033); Zod strips
      // the retired key, so a row stored before the removal still parses.
      label: "a stored row still carrying the retired pushTieResolution key",
      input: { ...base, pushTieResolution: "eliminate" },
    },
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

  // The stored refs are unchanged by ADR-0024/0033 — only rule knobs left the
  // shape — so everything downstream keeps reading the refs it always did.
  it("round-trips the resolved refs the server stores, including a mid-season start", () => {
    const stored = {
      startWeek: regular(5),
      endWeek: regular(18),
    };
    expect(SurvivorSettingsSchema.parse(stored)).toEqual(stored);
  });

  it("accepts the regular-season nominal range both modes resolve from", () => {
    expect(SurvivorSettingsSchema.safeParse(NFL_REGULAR_SEASON_RANGE).success).toBe(true);
  });
});

describe("SurvivorSettingsInputSchema", () => {
  it("carries nothing — a Survivor league has no rule left to choose", () => {
    expect(SurvivorSettingsInputSchema.parse({})).toEqual({});
  });

  // Everything a client might send is decided somewhere other than the wire:
  // the range server-side against the clock (ADR-0024), the pick type by the
  // mode itself (ADR-0026), and the push/tie rule fixed at its default
  // (ADR-0033). Stripping rather than refusing is what keeps an out-of-date
  // client from failing a league creation over a setting it can't influence
  // either way.
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
    {
      label: "the pre-ADR-0033 push/tie rule",
      input: { pushTieResolution: "eliminate" },
    },
  ])("strips $label from the wire", ({ input }) => {
    expect(SurvivorSettingsInputSchema.parse(input)).toEqual({});
  });
});

describe("MarchMadnessSettingsSchema", () => {
  it("applies default: 5 brackets per member", () => {
    const parsed = MarchMadnessSettingsSchema.parse({});
    expect(parsed.maxBracketsPerMember).toBe(5);
  });

  it.each([
    { label: "1 bracket", input: { maxBracketsPerMember: 1 } },
    { label: "10 brackets", input: { maxBracketsPerMember: 10 } },
    {
      // Scoring is standard doubling only (ADR-0034); Zod strips the retired
      // keys, so a row stored under the old shape still parses.
      label: "a stored row still carrying the retired scoring-model keys",
      input: { maxBracketsPerMember: 5, scoringModel: "custom", roundValues: [1, 2, 4, 8, 16, 32] },
    },
  ])("accepts $label", ({ input }) => {
    expect(MarchMadnessSettingsSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    { label: "0 brackets", input: { maxBracketsPerMember: 0 } },
    { label: "11 brackets", input: { maxBracketsPerMember: 11 } },
    { label: "fractional brackets", input: { maxBracketsPerMember: 2.5 } },
  ])("rejects $label", ({ input }) => {
    expect(MarchMadnessSettingsSchema.safeParse(input).success).toBe(false);
  });

  it("strips the retired scoring-model keys so stale values can't persist", () => {
    const parsed = MarchMadnessSettingsSchema.parse({
      scoringModel: "custom",
      roundValues: [1, 2, 4, 8, 16, 32],
    });
    expect("scoringModel" in parsed).toBe(false);
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

  // Both NFL modes' entries differ from the stored map (ADR-0024, ADR-0031):
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
    expect(Object.values(WEEK_TYPE).sort()).toEqual(["postseason", "regular"]);
  });
});
