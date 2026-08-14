import { describe, expect, it } from "vitest";
import type { AdminNflGameStatContextBlock, NflGameStatsTeamContext } from "@picksleagues/schemas";
import {
  buildNflContextOverrideRequest,
  nflContextOverrideFormSeed,
} from "./nfl-context-override-patch";

/**
 * The boundary under test: text ↔ the *whole-replacement* override layer —
 * blank means "no override for this field", `[]` is a real override, and
 * bad JSON or a bad shape is a field error that never reaches the wire.
 */

function teamContext(): NflGameStatsTeamContext {
  return { injuries: [], fpiWinPct: 55, atsSummary: "3-2", lastFive: [] };
}

function block(
  overridePayload: AdminNflGameStatContextBlock["overridePayload"] = null,
): AdminNflGameStatContextBlock {
  return {
    payload: { home: teamContext(), away: teamContext() },
    overridePayload,
    effective: { home: teamContext(), away: teamContext() },
    overriddenBy: null,
    overriddenAt: null,
    updatedAt: "2026-09-20T00:00:00.000Z",
  };
}

const VALID_INJURY = {
  athleteName: "A. Player",
  position: "WR",
  status: "Out",
  injuryType: "Ankle",
};

describe("nflContextOverrideFormSeed", () => {
  it("seeds blank with no override layer", () => {
    const seed = nflContextOverrideFormSeed(block());
    expect(seed["home:injuries"]).toBe("");
    expect(seed["away:fpiWinPct"]).toBe("");
  });

  it("seeds only the overridden fields — absent stays blank", () => {
    const seed = nflContextOverrideFormSeed(block({ home: { fpiWinPct: 70 } }));
    expect(seed["home:fpiWinPct"]).toBe("70");
    expect(seed["home:injuries"]).toBe("");
    expect(seed["away:fpiWinPct"]).toBe("");
  });
});

describe("buildNflContextOverrideRequest", () => {
  const blank = nflContextOverrideFormSeed(block());

  it("an all-blank form builds the empty request — clearing the whole layer", () => {
    expect(buildNflContextOverrideRequest(blank)).toEqual({ status: "ok", request: {} });
  });

  it("a filled field lands under its side; blank fields are omitted, not nulled", () => {
    const result = buildNflContextOverrideRequest({ ...blank, "home:fpiWinPct": "70" });
    expect(result).toEqual({ status: "ok", request: { home: { fpiWinPct: 70 } } });
  });

  it("an explicit [] is a real override — masking the provider's report", () => {
    const result = buildNflContextOverrideRequest({ ...blank, "away:injuries": "[]" });
    expect(result).toEqual({ status: "ok", request: { away: { injuries: [] } } });
  });

  it("a structured injuries override round-trips", () => {
    const result = buildNflContextOverrideRequest({
      ...blank,
      "home:injuries": JSON.stringify([VALID_INJURY]),
    });
    expect(result).toEqual({ status: "ok", request: { home: { injuries: [VALID_INJURY] } } });
  });

  it("unparsable JSON is a field error on that field alone", () => {
    const result = buildNflContextOverrideRequest({ ...blank, "home:injuries": "not json" });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.fieldErrors["home:injuries"]).toBeDefined();
      expect(result.fieldErrors["away:injuries"]).toBeUndefined();
    }
  });

  it("valid JSON with a bad shape fails the schema and maps to its field", () => {
    const result = buildNflContextOverrideRequest({
      ...blank,
      "away:lastFive": JSON.stringify([{ result: "X" }]),
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.fieldErrors["away:lastFive"]).toBeDefined();
    }
  });

  it("an out-of-range FPI fails its schema bound", () => {
    const result = buildNflContextOverrideRequest({ ...blank, "home:fpiWinPct": "140" });
    expect(result.status).toBe("invalid");
  });
});
