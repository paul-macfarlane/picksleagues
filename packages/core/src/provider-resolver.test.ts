import { describe, expect, it, vi } from "vitest";
import { GAME_STATUS, SIM_FINAL_STATUS, WEEK_TYPE } from "@picksleagues/schemas";
import type { Clock } from "./clock";
import { FixedClock } from "./clock";
import { EspnProvider } from "./espn-provider";
import { resolveGameDataProvider } from "./provider-resolver";
import { SimulatedProvider, type SimFixtureGameRow, type SimFixtureSnapshot } from "./sim-provider";

const emptySnapshot: SimFixtureSnapshot = { seasonYear: 2026, weeks: [], games: [], teams: [] };

describe("resolveGameDataProvider", () => {
  it("returns the given ESPN instance and never reads fixtures when the simulator is off", async () => {
    const espn = new EspnProvider();
    const readFixtures = vi.fn().mockResolvedValue(emptySnapshot);

    const provider = resolveGameDataProvider({
      simEnabled: false,
      espn,
      clock: new FixedClock(new Date("2026-09-10T13:00:00Z")),
      activeScenarioId: "some-scenario",
      readFixtures,
    });

    expect(provider).toBe(espn);
    expect(readFixtures).not.toHaveBeenCalled();
  });

  it("returns the given ESPN instance when the simulator is on but no scenario is active", async () => {
    const espn = new EspnProvider();
    const readFixtures = vi.fn().mockResolvedValue(emptySnapshot);

    const provider = resolveGameDataProvider({
      simEnabled: true,
      espn,
      clock: new FixedClock(new Date("2026-09-10T13:00:00Z")),
      activeScenarioId: null,
      readFixtures,
    });

    expect(provider).toBe(espn);
    expect(readFixtures).not.toHaveBeenCalled();
  });

  it("returns a SimulatedProvider reading the active scenario's fixtures when one is loaded", async () => {
    const espn = new EspnProvider();
    const readFixtures = vi.fn().mockResolvedValue(emptySnapshot);

    const provider = resolveGameDataProvider({
      simEnabled: true,
      espn,
      clock: new FixedClock(new Date("2026-09-10T13:00:00Z")),
      activeScenarioId: "scenario-123",
      readFixtures,
    });

    expect(provider).toBeInstanceOf(SimulatedProvider);
    expect(provider).not.toBe(espn);
    await provider.fetchNflTeams();
    expect(readFixtures).toHaveBeenCalledExactlyOnceWith("scenario-123");
  });

  // The resolved provider must be pinned to the instant `resolveGameDataProvider`
  // was called with, not left free to re-read a live clock on every fetch — a
  // sync job fetching several weeks would otherwise straddle a kickoff
  // boundary partway through (mirrors resolveClock/clock.test.ts's own
  // pinning coverage). A clock that ticks forward on every call is the only
  // way to observe this: if the provider re-consulted it, a fetch issued
  // after the game's window elapsed would see it turn `final`.
  it("pins the returned provider's clock, so a later fetch doesn't see a live clock advance", async () => {
    const kickoff = new Date("2026-09-13T17:00:00.000Z");
    let tick = new Date(kickoff.getTime() - 1);
    const tickingClock: Clock = {
      now: () => {
        const current = tick;
        // Jumps well past the fixture's game window on every subsequent read,
        // so an unpinned provider would flip from scheduled to final.
        tick = new Date(tick.getTime() + 30 * 24 * 60 * 60 * 1000);
        return current;
      },
    };
    const game: SimFixtureGameRow = {
      providerGameId: "sim-1",
      weekType: WEEK_TYPE.REGULAR,
      weekNumber: 1,
      homeTeamAbbr: "PHI",
      homeTeamName: "Eagles",
      homeTeamProviderId: "21",
      awayTeamAbbr: "DAL",
      awayTeamName: "Cowboys",
      awayTeamProviderId: "6",
      kickoffAt: kickoff,
      spread: -3.5,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 24,
      finalAwayScore: 17,
    };
    const snapshot: SimFixtureSnapshot = { seasonYear: 2026, weeks: [], games: [game], teams: [] };

    const provider = resolveGameDataProvider({
      simEnabled: true,
      espn: new EspnProvider(),
      clock: tickingClock,
      activeScenarioId: "scenario-123",
      readFixtures: async () => snapshot,
    });

    // The first `now()` read happens inside `resolveGameDataProvider` itself
    // (pinning the FixedClock it hands to SimulatedProvider), so both of these
    // project against that same pre-kickoff instant, not the ticking clock's
    // later values.
    const first = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);
    const second = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);

    expect(first[0]).toMatchObject({
      status: GAME_STATUS.SCHEDULED,
      homeScore: null,
      awayScore: null,
    });
    expect(second[0]).toEqual(first[0]);
  });
});
