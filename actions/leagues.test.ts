import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError, UnauthorizedError } from "@/lib/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/data/leagues", () => ({
  insertLeague: vi.fn(),
}));

vi.mock("@/data/members", () => ({
  insertLeagueMember: vi.fn(),
}));

vi.mock("@/data/seasons", () => ({
  getSeasonsBySportsLeague: vi.fn(),
}));

vi.mock("@/data/sports", () => ({
  getSportsLeagueByAbbreviation: vi.fn(),
}));

vi.mock("@/data/standings", () => ({
  insertLeagueStanding: vi.fn(),
}));

vi.mock("@/data/utils", () => ({
  withTransaction: vi.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn({})),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

import { insertLeague } from "@/data/leagues";
import { insertLeagueMember } from "@/data/members";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSportsLeagueByAbbreviation } from "@/data/sports";
import { insertLeagueStanding } from "@/data/standings";
import { getSession } from "@/lib/auth";

import { createLeagueAction } from "./leagues";

const validInput = {
  name: "Test League",
  imageUrl: "",
  seasonFormat: "regular_season",
  size: 10,
  picksPerPhase: 5,
  pickType: "straight_up",
} as const;

const session = { user: { id: "user-1" } };

const nflLeague = {
  id: "nfl-id",
  name: "NFL",
  abbreviation: "NFL",
  sport: "football",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const season = {
  id: "season-1",
  sportsLeagueId: "nfl-id",
  year: 2026,
  startDate: new Date("2026-09-01"),
  endDate: new Date("2027-02-28"),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const createdLeague = {
  id: "league-1",
  sportsLeagueId: "nfl-id",
  name: "Test League",
  imageUrl: null,
  seasonFormat: "regular_season" as const,
  size: 10,
  picksPerPhase: 5,
  pickType: "straight_up" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(
    session as Awaited<ReturnType<typeof getSession>>,
  );
  vi.mocked(getSportsLeagueByAbbreviation).mockResolvedValue(nflLeague);
  vi.mocked(getSeasonsBySportsLeague).mockResolvedValue([season]);
  vi.mocked(insertLeague).mockResolvedValue(createdLeague);
  vi.mocked(insertLeagueMember).mockResolvedValue({
    id: "m-1",
    leagueId: "league-1",
    userId: "user-1",
    role: "commissioner",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(insertLeagueStanding).mockResolvedValue({
    id: "s-1",
    leagueId: "league-1",
    userId: "user-1",
    seasonId: "season-1",
    wins: 0,
    losses: 0,
    pushes: 0,
    points: 0,
    rank: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe("createLeagueAction", () => {
  it("returns a validation error when input is invalid", async () => {
    const result = await createLeagueAction({ ...validInput, name: "ab" });
    expect(result.success).toBe(false);
    expect(insertLeague).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when not logged in", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new UnauthorizedError());
    await expect(createLeagueAction(validInput)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("returns a business error when NFL is not yet set up", async () => {
    vi.mocked(getSportsLeagueByAbbreviation).mockRejectedValueOnce(
      new NotFoundError(),
    );
    const result = await createLeagueAction(validInput);
    expect(result.success).toBe(false);
    expect(insertLeague).not.toHaveBeenCalled();
  });

  it("returns a business error when no NFL season has been synced", async () => {
    vi.mocked(getSeasonsBySportsLeague).mockResolvedValueOnce([]);
    const result = await createLeagueAction(validInput);
    expect(result.success).toBe(false);
    expect(insertLeague).not.toHaveBeenCalled();
  });

  it("creates league + commissioner member + zeroed standing atomically", async () => {
    const result = await createLeagueAction(validInput);
    expect(result.success).toBe(true);
    expect(insertLeague).toHaveBeenCalledWith(
      expect.objectContaining({
        name: validInput.name,
        sportsLeagueId: "nfl-id",
        seasonFormat: "regular_season",
        size: 10,
        picksPerPhase: 5,
        pickType: "straight_up",
        imageUrl: null,
      }),
      expect.anything(),
    );
    expect(insertLeagueMember).toHaveBeenCalledWith(
      {
        leagueId: "league-1",
        userId: "user-1",
        role: "commissioner",
      },
      expect.anything(),
    );
    expect(insertLeagueStanding).toHaveBeenCalledWith(
      {
        leagueId: "league-1",
        userId: "user-1",
        seasonId: "season-1",
      },
      expect.anything(),
    );
    if (result.success) {
      expect(result.data).toEqual({ leagueId: "league-1" });
    }
  });

  it("stores a provided image URL", async () => {
    await createLeagueAction({
      ...validInput,
      imageUrl: "https://example.com/logo.png",
    });
    expect(insertLeague).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: "https://example.com/logo.png",
      }),
      expect.anything(),
    );
  });
});
