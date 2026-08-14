import { describe, expect, it } from "vitest";
import type { AdminTeam } from "@picksleagues/schemas";
import {
  buildTeamIdentityOverridePatch,
  isTeamIdentityOverrideFormDirty,
  teamIdentityOverrideFormSeed,
} from "./team-identity-override-patch";

function team(overrides?: Partial<AdminTeam>): AdminTeam {
  return {
    id: "team-1",
    sport: "nfl",
    providerTeamId: "prov-1",
    abbreviation: "HOM",
    name: "Home Team",
    location: "Home",
    logoLightUrl: null,
    logoDarkUrl: null,
    overrideName: null,
    overrideAbbreviation: null,
    overrideLocation: null,
    overrideLogoLightUrl: null,
    overrideLogoDarkUrl: null,
    overriddenBy: null,
    overriddenAt: null,
    effectiveName: "Home Team",
    effectiveAbbreviation: "HOM",
    effectiveLocation: "Home",
    effectiveLogoLightUrl: null,
    effectiveLogoDarkUrl: null,
    updatedAt: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("teamIdentityOverrideFormSeed", () => {
  it("seeds from the override layer, never the resolved values", () => {
    const seed = teamIdentityOverrideFormSeed(team({ overrideAbbreviation: "COR" }));
    expect(seed.abbreviation).toBe("COR");
    // Provider-tracking fields seed empty — copying effective values in would
    // pin provider truth into the override columns (arch D15).
    expect(seed.name).toBe("");
  });
});

describe("buildTeamIdentityOverridePatch", () => {
  const seed = teamIdentityOverrideFormSeed(team({ overrideAbbreviation: "COR" }));

  it("is unchanged when nothing differs from the seed", () => {
    expect(buildTeamIdentityOverridePatch(seed, { ...seed })).toEqual({ status: "unchanged" });
    expect(isTeamIdentityOverrideFormDirty(seed, { ...seed })).toBe(false);
  });

  it("treats whitespace-only edits as unchanged, in the diff and the dirty predicate alike", () => {
    // A trailing space on an overridden field, and spaces typed into an empty
    // one: neither is a change, so neither may enable Save or write a no-op
    // audit row.
    const padded = { ...seed, abbreviation: "COR ", name: "   " };
    expect(buildTeamIdentityOverridePatch(seed, padded)).toEqual({ status: "unchanged" });
    expect(isTeamIdentityOverrideFormDirty(seed, padded)).toBe(false);
  });

  it("trims a genuinely changed value before sending it", () => {
    const result = buildTeamIdentityOverridePatch(seed, { ...seed, name: "  New Name  " });
    expect(result).toEqual({ status: "ok", patch: { name: "New Name" } });
  });

  it("sends only the fields the operator changed", () => {
    const result = buildTeamIdentityOverridePatch(seed, { ...seed, name: "Corrected Team" });
    expect(result).toEqual({ status: "ok", patch: { name: "Corrected Team" } });
  });

  it("turns an emptied field into an explicit clear", () => {
    const result = buildTeamIdentityOverridePatch(seed, { ...seed, abbreviation: "" });
    expect(result).toEqual({ status: "ok", patch: { abbreviation: null } });
  });

  it("maps schema failures to field errors instead of sending them", () => {
    const result = buildTeamIdentityOverridePatch(seed, {
      ...seed,
      logoLightUrl: "http://insecure.example.com/logo.png",
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.fieldErrors.logoLightUrl).toBeDefined();
    }
  });
});
