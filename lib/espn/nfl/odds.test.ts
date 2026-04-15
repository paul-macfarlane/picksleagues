import { beforeEach, describe, expect, it, vi } from "vitest";

import { espnFetch } from "@/lib/espn/shared/client";
import { fetchOdds } from "./odds";

vi.mock("@/lib/espn/shared/client", () => ({
  espnFetch: vi.fn(),
}));

describe("fetchOdds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps ESPN's home-team spread and flips sign for the away team", async () => {
    // ESPN returns home-perspective spread: negative when home is favored.
    // Example: KC (home) -2.5 over BAL -> spread: -2.5, homeSpread: -2.5, awaySpread: 2.5.
    vi.mocked(espnFetch).mockResolvedValue({
      items: [
        {
          provider: { id: "58", name: "ESPN BET" },
          homeTeamOdds: { spreadOdds: -120, moneyLine: -140, favorite: true },
          awayTeamOdds: { spreadOdds: 100, moneyLine: 120 },
          overUnder: 45.5,
          spread: -2.5,
        },
      ],
    });

    const result = await fetchOdds("https://espn.test/odds/1");

    expect(result).toEqual({
      providerId: "58",
      providerName: "ESPN BET",
      homeSpread: -2.5,
      awaySpread: 2.5,
      homeMoneyline: -140,
      awayMoneyline: 120,
      overUnder: 45.5,
    });
  });

  it("returns null when odds response has no items", async () => {
    vi.mocked(espnFetch).mockResolvedValue({ items: [] });

    const result = await fetchOdds("https://espn.test/odds/1");

    expect(result).toBeNull();
  });

  it("leaves spreads null when ESPN omits the spread value", async () => {
    vi.mocked(espnFetch).mockResolvedValue({
      items: [
        {
          provider: { id: "58", name: "ESPN BET" },
          homeTeamOdds: { moneyLine: -150 },
          awayTeamOdds: { moneyLine: 130 },
        },
      ],
    });

    const result = await fetchOdds("https://espn.test/odds/1");

    expect(result).toMatchObject({
      homeSpread: null,
      awaySpread: null,
      overUnder: null,
    });
  });
});
