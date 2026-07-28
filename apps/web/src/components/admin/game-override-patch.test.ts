import { describe, expect, it } from "vitest";
import { GAME_STATUS, type AdminGame } from "@picksleagues/schemas";
import {
  buildGameOverridePatch,
  gameOverrideFormSeed,
  isGameOverrideFormDirty,
  NO_STATUS_OVERRIDE,
  type GameOverrideFormValues,
} from "./game-override-patch";

// Provider and override values deliberately DISAGREE on every field: the whole
// contract of this module is that the form edits the override layer, so a seed
// that accidentally read `effective*` would still look right against a fixture
// where the two match.
const GAME: AdminGame = {
  id: "game-1",
  weekId: "week-1",
  providerGameId: "provider-1",
  homeTeam: { id: "home", abbreviation: "HOM", name: "Home" },
  awayTeam: { id: "away", abbreviation: "AWY", name: "Away" },
  kickoffAt: "2026-09-13T17:00:00.000Z",
  status: GAME_STATUS.IN_PROGRESS,
  homeScore: 21,
  awayScore: 21,
  period: 3,
  clockSeconds: 421,
  latestSpread: -2.5,
  latestSpreadCapturedAt: "2026-09-12T12:00:00.000Z",
  overrideKickoffAt: null,
  overrideStatus: GAME_STATUS.FINAL,
  overrideHomeScore: 24,
  overrideAwayScore: 17,
  overrideSpread: null,
  overridePeriod: 4,
  overrideClockSeconds: null,
  overriddenBy: "admin-1",
  overriddenAt: "2026-09-14T00:00:00.000Z",
  effectiveKickoffAt: "2026-09-13T17:00:00.000Z",
  effectiveStatus: GAME_STATUS.FINAL,
  effectiveHomeScore: 24,
  effectiveAwayScore: 17,
  effectiveSpread: -2.5,
  effectivePeriod: 4,
  effectiveClockSeconds: 421,
};

const SEED = gameOverrideFormSeed(GAME);

function edit(changes: Partial<GameOverrideFormValues>): GameOverrideFormValues {
  return { ...SEED, ...changes };
}

describe("gameOverrideFormSeed", () => {
  it("seeds from the override layer, not the resolved values", () => {
    expect(SEED).toEqual({
      // No kickoff override, even though the game has an effective kickoff.
      kickoffAt: "",
      status: GAME_STATUS.FINAL,
      homeScore: "24",
      awayScore: "17",
      // No spread override, even though the game resolves to the provider's -2.5.
      spread: "",
      period: "4",
      // No clock override, even though the game resolves to the provider's 421s.
      clock: "",
    });
  });

  it("renders a clock override in m:ss, not raw seconds", () => {
    expect(gameOverrideFormSeed({ ...GAME, overrideClockSeconds: 754 }).clock).toBe("12:34");
  });

  it("renders an absent status override as the clear sentinel", () => {
    expect(gameOverrideFormSeed({ ...GAME, overrideStatus: null }).status).toBe(NO_STATUS_OVERRIDE);
  });
});

describe("buildGameOverridePatch", () => {
  it("reports an untouched form as unchanged rather than an empty-body error", () => {
    expect(buildGameOverridePatch(SEED, SEED)).toEqual({ status: "unchanged" });
  });

  // The regression this module exists for: an omitted field means "leave the
  // stored override alone", so echoing untouched fields back would rewrite them
  // — the kickoff truncated to the whole minute, and everything else pinned.
  it("sends only the fields the operator actually changed", () => {
    const result = buildGameOverridePatch(SEED, edit({ homeScore: "27" }));
    expect(result).toEqual({ status: "ok", patch: { homeScore: 27 } });
  });

  it("sends an edited kickoff as an ISO instant", () => {
    const result = buildGameOverridePatch(SEED, edit({ kickoffAt: "2026-09-14T13:00" }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.patch.kickoffAt).toBe(new Date("2026-09-14T13:00").toISOString());
  });

  it.each(["homeScore", "awayScore"] as const)(
    "sends an emptied %s as an explicit null clear",
    (field) => {
      const result = buildGameOverridePatch(SEED, edit({ [field]: "" }));
      expect(result).toEqual({ status: "ok", patch: { [field]: null } });
    },
  );

  it("sends an emptied spread as an explicit null clear", () => {
    const seeded = gameOverrideFormSeed({ ...GAME, overrideSpread: 7.5 });
    expect(buildGameOverridePatch(seeded, { ...seeded, spread: "" })).toEqual({
      status: "ok",
      patch: { spread: null },
    });
  });

  it("sends a cleared kickoff as an explicit null rather than throwing on toISOString", () => {
    const seeded = gameOverrideFormSeed({ ...GAME, overrideKickoffAt: "2026-09-14T23:00:00.000Z" });
    expect(buildGameOverridePatch(seeded, { ...seeded, kickoffAt: "" })).toEqual({
      status: "ok",
      patch: { kickoffAt: null },
    });
  });

  it("sends the status sentinel as an explicit null clear", () => {
    expect(buildGameOverridePatch(SEED, edit({ status: NO_STATUS_OVERRIDE }))).toEqual({
      status: "ok",
      patch: { status: null },
    });
  });

  it("treats whitespace as a clear, not as zero", () => {
    expect(buildGameOverridePatch(SEED, edit({ homeScore: "   " }))).toEqual({
      status: "ok",
      patch: { homeScore: null },
    });
  });

  it.each(["abc", "1.2.3"])("rejects the non-numeric score %s on its own field", (raw) => {
    const result = buildGameOverridePatch(SEED, edit({ homeScore: raw }));
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.fieldErrors.homeScore).toBeTruthy();
  });

  it("surfaces an out-of-range score on its own field, deferring the bound to the schema", () => {
    const result = buildGameOverridePatch(SEED, edit({ homeScore: "500" }));
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.fieldErrors.homeScore).toBeTruthy();
  });

  it("reports an unparseable kickoff as a field error", () => {
    const result = buildGameOverridePatch(SEED, edit({ kickoffAt: "not-a-date" }));
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.fieldErrors.kickoffAt).toBeTruthy();
  });

  it("sets and clears different fields in one save", () => {
    const result = buildGameOverridePatch(
      SEED,
      edit({ status: NO_STATUS_OVERRIDE, homeScore: "", spread: "-7.5" }),
    );
    expect(result).toEqual({
      status: "ok",
      patch: { status: null, homeScore: null, spread: -7.5 },
    });
  });

  it("sends an edited period as a plain integer", () => {
    const result = buildGameOverridePatch(SEED, edit({ period: "6" }));
    expect(result).toEqual({ status: "ok", patch: { period: 6 } });
  });

  it("sends an emptied period as an explicit null clear", () => {
    const result = buildGameOverridePatch(SEED, edit({ period: "" }));
    expect(result).toEqual({ status: "ok", patch: { period: null } });
  });

  it("sends an edited clock as whole seconds, converted from m:ss", () => {
    const result = buildGameOverridePatch(SEED, edit({ clock: "12:34" }));
    expect(result).toEqual({ status: "ok", patch: { clockSeconds: 754 } });
  });

  it("sends an emptied clock as an explicit null clear", () => {
    const seeded = gameOverrideFormSeed({ ...GAME, overrideClockSeconds: 421 });
    expect(buildGameOverridePatch(seeded, { ...seeded, clock: "" })).toEqual({
      status: "ok",
      patch: { clockSeconds: null },
    });
  });

  it("round-trips a clock override through the seed exactly", () => {
    const result = buildGameOverridePatch(SEED, edit({ clock: "1:05" }));
    expect(result).toEqual({ status: "ok", patch: { clockSeconds: 65 } });
    const seeded = gameOverrideFormSeed({ ...GAME, overrideClockSeconds: 65 });
    expect(seeded.clock).toBe("1:05");
  });

  it.each(["abc", "12", "12:"])("rejects an unparseable clock %s on its own field", (raw) => {
    const result = buildGameOverridePatch(SEED, edit({ clock: raw }));
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.fieldErrors.clock).toBeTruthy();
  });

  it("rejects an out-of-range clock second component on its own field", () => {
    const result = buildGameOverridePatch(SEED, edit({ clock: "1:75" }));
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.fieldErrors.clock).toBeTruthy();
  });

  it("surfaces an out-of-range clock (over the schema's bound) on the clock field, not clockSeconds", () => {
    const result = buildGameOverridePatch(SEED, edit({ clock: "70:00" }));
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.fieldErrors.clock).toBeTruthy();
  });

  it("surfaces an out-of-range period on its own field, deferring the bound to the schema", () => {
    const result = buildGameOverridePatch(SEED, edit({ period: "11" }));
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.fieldErrors.period).toBeTruthy();
  });
});

describe("isGameOverrideFormDirty", () => {
  it("is false for the untouched seed and true for any single change", () => {
    expect(isGameOverrideFormDirty(SEED, SEED)).toBe(false);
    expect(isGameOverrideFormDirty(SEED, edit({ spread: "-7" }))).toBe(true);
    expect(isGameOverrideFormDirty(SEED, edit({ status: NO_STATUS_OVERRIDE }))).toBe(true);
    expect(isGameOverrideFormDirty(SEED, edit({ period: "6" }))).toBe(true);
    expect(isGameOverrideFormDirty(SEED, edit({ clock: "1:05" }))).toBe(true);
  });
});
