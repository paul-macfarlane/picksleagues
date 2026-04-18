import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/data/leagues", () => ({
  insertLeague: vi.fn(),
  updateLeague: vi.fn(),
  removeLeague: vi.fn(),
  getLeagueById: vi.fn(),
  getLeagueMemberCount: vi.fn(),
}));

vi.mock("@/data/members", () => ({
  insertLeagueMember: vi.fn(),
}));

vi.mock("@/data/phases", () => ({
  getPhasesBySeason: vi.fn(),
}));

vi.mock("@/lib/invites", () => ({
  cleanupInvitesIfFull: vi.fn(),
}));

vi.mock("@/lib/simulator", () => ({
  getAppNow: vi.fn(() => Promise.resolve(new Date())),
}));

vi.mock("@/lib/permissions", () => ({
  assertLeagueCommissioner: vi.fn(),
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

import {
  getLeagueById,
  getLeagueMemberCount,
  insertLeague,
  removeLeague,
  updateLeague,
} from "@/data/leagues";
import { insertLeagueMember } from "@/data/members";
import { getPhasesBySeason } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSportsLeagueByAbbreviation } from "@/data/sports";
import { insertLeagueStanding } from "@/data/standings";
import { getSession } from "@/lib/auth";
import { cleanupInvitesIfFull } from "@/lib/invites";
import { assertLeagueCommissioner } from "@/lib/permissions";

import {
  createLeagueAction,
  deleteLeagueAction,
  updateLeagueAction,
} from "./leagues";

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
  year: 2099,
  startDate: new Date("2099-09-01T00:00:00Z"),
  endDate: new Date("2100-02-28T00:00:00Z"),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Future-dated Week 1 keeps the league's start lock in the future by
// default, so structural edits + invites + creation stay open.
const openPhase = {
  id: "phase-1",
  seasonId: season.id,
  seasonType: "regular" as const,
  weekNumber: 1,
  label: "Week 1",
  startDate: new Date("2099-09-07T00:00:00Z"),
  endDate: new Date("2099-09-14T00:00:00Z"),
  pickLockTime: new Date("2099-09-07T17:00:00Z"),
  lockedAt: null,
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
  vi.mocked(getPhasesBySeason).mockResolvedValue([openPhase]);
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

describe("updateLeagueAction", () => {
  const leagueId = "11111111-1111-4111-8111-111111111111";
  const existingLeague = {
    ...createdLeague,
    id: leagueId,
    size: 10,
    // Created well before Week 1 → activation defaults to season.startDate.
    createdAt: new Date("2099-06-01T00:00:00Z"),
  };

  // Default remains the future-dated openPhase from the outer beforeEach
  // (unlocked). Individual tests swap to this past-dated phase when they
  // need to exercise the start-locked branch.
  const lockedPhase = {
    ...openPhase,
    startDate: new Date("2020-09-07T00:00:00Z"),
    endDate: new Date("2020-09-14T00:00:00Z"),
    pickLockTime: new Date("2020-09-07T17:00:00Z"),
  };

  const validUpdate = {
    leagueId,
    name: "Renamed League",
    imageUrl: "",
    seasonFormat: "regular_season",
    size: 10,
    picksPerPhase: 5,
    pickType: "straight_up",
  } as const;

  beforeEach(() => {
    vi.mocked(assertLeagueCommissioner).mockResolvedValue({
      id: "m-1",
      leagueId,
      userId: "user-1",
      role: "commissioner",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(getLeagueById).mockResolvedValue(existingLeague);
    vi.mocked(getLeagueMemberCount).mockResolvedValue(1);
    vi.mocked(updateLeague).mockResolvedValue(existingLeague);
  });

  it("returns a validation error on bad input", async () => {
    const result = await updateLeagueAction({ ...validUpdate, name: "a" });
    expect(result.success).toBe(false);
    expect(updateLeague).not.toHaveBeenCalled();
  });

  it("propagates ForbiddenError when the user is not a commissioner", async () => {
    vi.mocked(assertLeagueCommissioner).mockRejectedValueOnce(
      new ForbiddenError("Must be a league commissioner"),
    );
    await expect(updateLeagueAction(validUpdate)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("returns an error when the league does not exist", async () => {
    vi.mocked(getLeagueById).mockResolvedValueOnce(null);
    const result = await updateLeagueAction(validUpdate);
    expect(result.success).toBe(false);
    expect(updateLeague).not.toHaveBeenCalled();
  });

  it("allows name-only edits once the start lock has passed", async () => {
    // Default phases mock has a future-dated start lock; swap to a past
    // one so the league is "post-start-lock" for this test.
    vi.mocked(getPhasesBySeason).mockResolvedValueOnce([lockedPhase]);
    const result = await updateLeagueAction({
      ...validUpdate,
      name: "New Name",
      imageUrl: "https://example.com/new.png",
    });
    expect(result.success).toBe(true);
    expect(updateLeague).toHaveBeenCalledWith(
      leagueId,
      expect.objectContaining({
        name: "New Name",
        imageUrl: "https://example.com/new.png",
      }),
    );
  });

  it("blocks structural edits once the start lock has passed", async () => {
    vi.mocked(getPhasesBySeason).mockResolvedValueOnce([lockedPhase]);
    const result = await updateLeagueAction({ ...validUpdate, size: 12 });
    expect(result.success).toBe(false);
    expect(updateLeague).not.toHaveBeenCalled();
  });

  it("blocks structural edits when the league's own start phase has locked mid-season", async () => {
    // A phase whose pickLockTime IS > activation (so it would be the
    // start phase) but is <= now (so it has already fired) exercises the
    // "start phase exists but its lock is passed" branch of
    // hasLeagueStartLockPassed — distinct from the "no eligible start
    // phase at all" branch above.
    const midSeasonLocked = {
      ...openPhase,
      startDate: new Date("2099-09-14T00:00:00Z"),
      endDate: new Date("2099-09-21T00:00:00Z"),
      pickLockTime: new Date("2099-09-14T17:00:00Z"),
    };
    vi.mocked(getLeagueById).mockResolvedValueOnce({
      ...existingLeague,
      // Activation > season start → mid-season league.
      createdAt: new Date("2099-09-10T00:00:00Z"),
    });
    vi.mocked(getPhasesBySeason).mockResolvedValueOnce([midSeasonLocked]);
    // Pretend "now" is after the pickLockTime.
    const { getAppNow } = await import("@/lib/simulator");
    vi.mocked(getAppNow).mockResolvedValueOnce(
      new Date("2099-09-15T00:00:00Z"),
    );
    const result = await updateLeagueAction({ ...validUpdate, size: 12 });
    expect(result.success).toBe(false);
    expect(updateLeague).not.toHaveBeenCalled();
  });

  it("refuses to shrink league size below the current member count", async () => {
    vi.mocked(getLeagueMemberCount).mockResolvedValueOnce(8);
    const result = await updateLeagueAction({ ...validUpdate, size: 6 });
    expect(result.success).toBe(false);
    expect(updateLeague).not.toHaveBeenCalled();
  });

  it("updates structural settings before the start lock fires", async () => {
    const result = await updateLeagueAction({
      ...validUpdate,
      size: 12,
      pickType: "against_the_spread",
      picksPerPhase: 6,
      seasonFormat: "full_season",
    });
    expect(result.success).toBe(true);
    expect(updateLeague).toHaveBeenCalledWith(
      leagueId,
      expect.objectContaining({
        size: 12,
        pickType: "against_the_spread",
        picksPerPhase: 6,
        seasonFormat: "full_season",
      }),
    );
    expect(cleanupInvitesIfFull).not.toHaveBeenCalled();
  });

  it("cleans up invites when the size change could fill the league", async () => {
    vi.mocked(getLeagueById).mockResolvedValueOnce({
      ...existingLeague,
      size: 12,
    });
    const result = await updateLeagueAction({ ...validUpdate, size: 6 });
    expect(result.success).toBe(true);
    expect(cleanupInvitesIfFull).toHaveBeenCalledWith(leagueId);
  });
});

describe("deleteLeagueAction", () => {
  const leagueId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    vi.mocked(assertLeagueCommissioner).mockResolvedValue({
      id: "m-1",
      leagueId,
      userId: "user-1",
      role: "commissioner",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(removeLeague).mockResolvedValue(undefined);
  });

  it("returns a validation error on a bad id", async () => {
    const result = await deleteLeagueAction({ leagueId: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(removeLeague).not.toHaveBeenCalled();
  });

  it("propagates ForbiddenError when the user is not a commissioner", async () => {
    vi.mocked(assertLeagueCommissioner).mockRejectedValueOnce(
      new ForbiddenError("Must be a league commissioner"),
    );
    await expect(deleteLeagueAction({ leagueId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(removeLeague).not.toHaveBeenCalled();
  });

  it("deletes the league on success", async () => {
    const result = await deleteLeagueAction({ leagueId });
    expect(result.success).toBe(true);
    expect(removeLeague).toHaveBeenCalledWith(leagueId);
  });

  it("returns a business error if the league cannot be found", async () => {
    vi.mocked(removeLeague).mockRejectedValueOnce(new NotFoundError());
    const result = await deleteLeagueAction({ leagueId });
    expect(result.success).toBe(false);
  });
});
