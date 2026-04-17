import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWeeklySync } from "./weekly-sync";

vi.mock("@/data/sports", () => ({
  getDataSourceByName: vi.fn().mockResolvedValue({
    id: "ds-1",
    name: "ESPN",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  getSportsLeagueByAbbreviation: vi.fn().mockResolvedValue({
    id: "sl-1",
    name: "National Football League",
    abbreviation: "NFL",
    sport: "football",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
}));

vi.mock("@/lib/nfl/scheduling", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/nfl/scheduling")>();
  return {
    ...original,
    isNflSeasonMonth: vi.fn(),
  };
});

vi.mock("./structural", () => ({
  runStructuralSync: vi.fn(),
}));

const { getDataSourceByName, getSportsLeagueByAbbreviation } =
  await import("@/data/sports");
const { isNflSeasonMonth } = await import("@/lib/nfl/scheduling");
const { runStructuralSync } = await import("./structural");

const OCTOBER_SUNDAY = new Date("2025-10-12T18:00:00Z");

const STRUCTURAL_RESULT = {
  seasonYear: 2025,
  seasonId: "season-1",
  phasesUpserted: 18,
  phasesLocked: 0,
  teamsInserted: 0,
  teamsUpdated: 32,
  teamsLocked: 0,
  eventsInserted: 5,
  eventsUpdated: 10,
  eventsSkipped: 0,
  eventsLocked: 0,
  oddsToSync: [{ eventId: "event-1", oddsRef: "https://espn.com/odds/1" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isNflSeasonMonth).mockReturnValue(true);
  vi.mocked(runStructuralSync).mockResolvedValue(STRUCTURAL_RESULT);
});

describe("runWeeklySync", () => {
  it("skips when off-season", async () => {
    vi.mocked(isNflSeasonMonth).mockReturnValue(false);

    const result = await runWeeklySync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("off-season");
    expect(getDataSourceByName).not.toHaveBeenCalled();
    expect(runStructuralSync).not.toHaveBeenCalled();
  });

  it("looks up reference records and calls runStructuralSync", async () => {
    const result = await runWeeklySync(OCTOBER_SUNDAY);

    expect(getDataSourceByName).toHaveBeenCalledWith("ESPN");
    expect(getSportsLeagueByAbbreviation).toHaveBeenCalledWith("NFL");
    expect(runStructuralSync).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSource: expect.objectContaining({ id: "ds-1" }),
        sportsLeague: expect.objectContaining({ id: "sl-1" }),
        now: OCTOBER_SUNDAY,
      }),
    );
    expect(result.skipped).toBe(false);
  });

  it("returns structural counts (without odds)", async () => {
    const result = await runWeeklySync(OCTOBER_SUNDAY);

    expect(result).toEqual({
      skipped: false,
      seasonYear: 2025,
      phasesUpserted: 18,
      phasesLocked: 0,
      teamsInserted: 0,
      teamsUpdated: 32,
      teamsLocked: 0,
      eventsInserted: 5,
      eventsUpdated: 10,
      eventsSkipped: 0,
      eventsLocked: 0,
    });
    // Weekly sync specifically does NOT expose odds-related fields
    expect(result).not.toHaveProperty("oddsUpserted");
    expect(result).not.toHaveProperty("oddsToSync");
  });
});
