import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  toggleLockAction,
  updateEventAction,
  updateOddsAction,
  updatePhaseAction,
  updateTeamAction,
} from "@/actions/admin-overrides";
import {
  clearLockedEvent,
  clearLockedOdds,
  setLockedEvent,
  setLockedOdds,
  updateEvent,
  updateOdds,
} from "@/data/events";
import { clearLockedPhase, setLockedPhase, updatePhase } from "@/data/phases";
import { clearLockedTeam, setLockedTeam, updateTeam } from "@/data/teams";
import { clearPickResultsForEvent } from "@/data/picks";
import type { Profile } from "@/lib/db/schema/profiles";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { requireAdminSession } from "@/lib/permissions";
import { runStandingsRecalcForEvent } from "@/lib/sync/nfl/standings";

vi.mock("@/data/teams", () => ({
  setLockedTeam: vi.fn(),
  clearLockedTeam: vi.fn(),
  updateTeam: vi.fn(),
}));

vi.mock("@/data/phases", () => ({
  setLockedPhase: vi.fn(),
  clearLockedPhase: vi.fn(),
  updatePhase: vi.fn(),
}));

vi.mock("@/data/events", () => ({
  setLockedEvent: vi.fn(),
  clearLockedEvent: vi.fn(),
  setLockedOdds: vi.fn(),
  clearLockedOdds: vi.fn(),
  updateEvent: vi.fn(),
  updateOdds: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  requireAdminSession: vi.fn(),
}));

vi.mock("@/data/picks", () => ({
  clearPickResultsForEvent: vi.fn(),
}));

vi.mock("@/lib/sync/nfl/standings", () => ({
  runStandingsRecalcForEvent: vi
    .fn()
    .mockResolvedValue({ leaguesAffected: 0, picksRescored: 0 }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { revalidatePath } = await import("next/cache");

const UUID = "11111111-1111-4111-8111-111111111111";

const ADMIN_PROFILE: Profile = {
  id: "profile-admin-1",
  userId: "admin-1",
  username: "admin",
  name: "Admin",
  avatarUrl: null,
  role: "admin",
  setupComplete: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdminSession).mockResolvedValue({
    userId: "admin-1",
    profile: ADMIN_PROFILE,
  });
});

describe("toggleLockAction", () => {
  it("rejects invalid input without calling auth", async () => {
    const result = await toggleLockAction({ entity: "bogus" });

    expect(result.success).toBe(false);
    expect(requireAdminSession).not.toHaveBeenCalled();
    expect(setLockedTeam).not.toHaveBeenCalled();
  });

  it("bubbles UnauthorizedError from requireAdminSession", async () => {
    vi.mocked(requireAdminSession).mockRejectedValueOnce(
      new UnauthorizedError(),
    );

    await expect(
      toggleLockAction({ entity: "team", id: UUID, locked: true }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("bubbles ForbiddenError from requireAdminSession", async () => {
    vi.mocked(requireAdminSession).mockRejectedValueOnce(new ForbiddenError());

    await expect(
      toggleLockAction({ entity: "team", id: UUID, locked: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("locks a team via setLockedTeam with the caller-supplied id", async () => {
    const result = await toggleLockAction({
      entity: "team",
      id: UUID,
      locked: true,
    });

    expect(result.success).toBe(true);
    expect(setLockedTeam).toHaveBeenCalledWith(UUID, expect.any(Date));
    expect(clearLockedTeam).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/admin/overrides");
  });

  it("unlocks a team via clearLockedTeam", async () => {
    const result = await toggleLockAction({
      entity: "team",
      id: UUID,
      locked: false,
    });

    expect(result.success).toBe(true);
    expect(clearLockedTeam).toHaveBeenCalledWith(UUID);
    expect(setLockedTeam).not.toHaveBeenCalled();
  });

  it("dispatches to the right helper per entity", async () => {
    await toggleLockAction({ entity: "phase", id: UUID, locked: true });
    expect(setLockedPhase).toHaveBeenCalledWith(UUID, expect.any(Date));

    await toggleLockAction({ entity: "phase", id: UUID, locked: false });
    expect(clearLockedPhase).toHaveBeenCalledWith(UUID);

    await toggleLockAction({ entity: "event", id: UUID, locked: true });
    expect(setLockedEvent).toHaveBeenCalledWith(UUID, expect.any(Date));

    await toggleLockAction({ entity: "event", id: UUID, locked: false });
    expect(clearLockedEvent).toHaveBeenCalledWith(UUID);

    await toggleLockAction({ entity: "odds", id: UUID, locked: true });
    expect(setLockedOdds).toHaveBeenCalledWith(UUID, expect.any(Date));

    await toggleLockAction({ entity: "odds", id: UUID, locked: false });
    expect(clearLockedOdds).toHaveBeenCalledWith(UUID);
  });

  it("returns { success: false } when the target is not found", async () => {
    vi.mocked(setLockedTeam).mockRejectedValueOnce(
      new NotFoundError("Team not found"),
    );

    const result = await toggleLockAction({
      entity: "team",
      id: UUID,
      locked: true,
    });

    expect(result).toEqual({ success: false, error: "Team not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("propagates unexpected errors", async () => {
    vi.mocked(setLockedTeam).mockRejectedValueOnce(new Error("boom"));

    await expect(
      toggleLockAction({ entity: "team", id: UUID, locked: true }),
    ).rejects.toThrow("boom");
  });
});

describe("updateTeamAction", () => {
  function validInput() {
    return {
      id: UUID,
      name: "Chiefs",
      location: "Kansas City",
      abbreviation: "KC",
      logoUrl: "https://example.com/kc.png",
      logoDarkUrl: "",
    };
  }

  it("rejects invalid input without calling auth", async () => {
    const result = await updateTeamAction({ ...validInput(), name: "" });

    expect(result.success).toBe(false);
    expect(requireAdminSession).not.toHaveBeenCalled();
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("requires admin session", async () => {
    vi.mocked(requireAdminSession).mockRejectedValueOnce(new ForbiddenError());

    await expect(updateTeamAction(validInput())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("updates the team, auto-locks, and normalizes empty URLs to null", async () => {
    const result = await updateTeamAction(validInput());

    expect(result.success).toBe(true);
    expect(updateTeam).toHaveBeenCalledWith(UUID, {
      name: "Chiefs",
      location: "Kansas City",
      abbreviation: "KC",
      logoUrl: "https://example.com/kc.png",
      logoDarkUrl: null,
      lockedAt: expect.any(Date),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/overrides");
  });

  it("rejects digits/symbols in abbreviation", async () => {
    const result = await updateTeamAction({
      ...validInput(),
      abbreviation: "KC1",
    });

    expect(result.success).toBe(false);
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("uppercases the abbreviation input", async () => {
    await updateTeamAction({ ...validInput(), abbreviation: "kc" });

    expect(updateTeam).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({ abbreviation: "KC" }),
    );
  });

  it("rejects a non-URL logoUrl", async () => {
    const result = await updateTeamAction({
      ...validInput(),
      logoUrl: "not a url",
    });

    expect(result.success).toBe(false);
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("returns a business error when the team is missing", async () => {
    vi.mocked(updateTeam).mockRejectedValueOnce(
      new NotFoundError("Team not found"),
    );

    const result = await updateTeamAction(validInput());

    expect(result).toEqual({ success: false, error: "Team not found" });
  });
});

describe("updatePhaseAction", () => {
  function validInput() {
    return {
      id: UUID,
      label: "Week 1",
      startDate: "2025-09-09 00:00",
      endDate: "2025-09-16 06:00",
      pickLockTime: "2025-09-14 17:00",
    };
  }

  it("rejects malformed datetime strings", async () => {
    const result = await updatePhaseAction({
      ...validInput(),
      startDate: "09/09/2025",
    });

    expect(result.success).toBe(false);
    expect(updatePhase).not.toHaveBeenCalled();
  });

  it("rejects invalid calendar dates (e.g. Feb 30)", async () => {
    const result = await updatePhaseAction({
      ...validInput(),
      startDate: "2025-02-30 00:00",
    });

    expect(result.success).toBe(false);
    expect(updatePhase).not.toHaveBeenCalled();
  });

  it("rejects out-of-range time fields (e.g. 25:99)", async () => {
    const result = await updatePhaseAction({
      ...validInput(),
      startDate: "2025-09-09 25:99",
    });

    expect(result.success).toBe(false);
    expect(updatePhase).not.toHaveBeenCalled();
  });

  it("rejects when end is not after start", async () => {
    const result = await updatePhaseAction({
      ...validInput(),
      endDate: "2025-09-09 00:00",
    });

    expect(result.success).toBe(false);
    expect(updatePhase).not.toHaveBeenCalled();
  });

  it("converts strings to UTC Dates and auto-locks", async () => {
    const result = await updatePhaseAction(validInput());

    expect(result.success).toBe(true);
    expect(updatePhase).toHaveBeenCalledWith(UUID, {
      label: "Week 1",
      startDate: new Date("2025-09-09T00:00:00Z"),
      endDate: new Date("2025-09-16T06:00:00Z"),
      pickLockTime: new Date("2025-09-14T17:00:00Z"),
      lockedAt: expect.any(Date),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/overrides");
  });

  it("returns a business error when the phase is missing", async () => {
    vi.mocked(updatePhase).mockRejectedValueOnce(
      new NotFoundError("Phase not found"),
    );

    const result = await updatePhaseAction(validInput());

    expect(result).toEqual({ success: false, error: "Phase not found" });
  });
});

describe("updateEventAction", () => {
  const HOME_TEAM_ID = "22222222-2222-4222-8222-222222222222";
  const AWAY_TEAM_ID = "33333333-3333-4333-8333-333333333333";

  function validInput() {
    return {
      id: UUID,
      homeTeamId: HOME_TEAM_ID,
      awayTeamId: AWAY_TEAM_ID,
      startTime: "2025-09-09 17:00",
      status: "not_started" as const,
      homeScore: "",
      awayScore: "",
      period: "",
      clock: "",
    };
  }

  it("rejects when home and away teams are the same", async () => {
    const result = await updateEventAction({
      ...validInput(),
      awayTeamId: HOME_TEAM_ID,
    });

    expect(result.success).toBe(false);
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it("requires scores when status is final", async () => {
    const result = await updateEventAction({
      ...validInput(),
      status: "final",
    });

    expect(result.success).toBe(false);
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it("rejects non-numeric scores", async () => {
    const result = await updateEventAction({
      ...validInput(),
      status: "final",
      homeScore: "seven",
      awayScore: "3",
    });

    expect(result.success).toBe(false);
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it("rejects negative scores (regex-enforced)", async () => {
    const result = await updateEventAction({
      ...validInput(),
      homeScore: "-3",
      awayScore: "7",
    });

    expect(result.success).toBe(false);
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it("converts empty scores to null and auto-locks for not_started", async () => {
    const result = await updateEventAction(validInput());

    expect(result.success).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith(UUID, {
      homeTeamId: HOME_TEAM_ID,
      awayTeamId: AWAY_TEAM_ID,
      startTime: new Date("2025-09-09T17:00:00Z"),
      status: "not_started",
      homeScore: null,
      awayScore: null,
      period: null,
      clock: null,
      lockedAt: expect.any(Date),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/overrides");
  });

  it("passes period and clock when provided (in-progress edit)", async () => {
    const result = await updateEventAction({
      ...validInput(),
      status: "in_progress",
      homeScore: "7",
      awayScore: "10",
      period: "3",
      clock: "4:12",
    });

    expect(result.success).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({
        period: 3,
        clock: "4:12",
      }),
    );
  });

  it("parses final with scores", async () => {
    const result = await updateEventAction({
      ...validInput(),
      status: "final",
      homeScore: "24",
      awayScore: "17",
    });

    expect(result.success).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({
        status: "final",
        homeScore: 24,
        awayScore: 17,
      }),
    );
  });

  it("returns a business error when the event is missing", async () => {
    vi.mocked(updateEvent).mockRejectedValueOnce(
      new NotFoundError("Event not found"),
    );

    const result = await updateEventAction(validInput());

    expect(result).toEqual({ success: false, error: "Event not found" });
    // Failure path: pick results should NOT be cleared and the recalc
    // should not run — otherwise an unrelated failure would silently
    // invalidate pick history.
    expect(clearPickResultsForEvent).not.toHaveBeenCalled();
    expect(runStandingsRecalcForEvent).not.toHaveBeenCalled();
  });

  it("clears pick results and re-runs standings after a successful event update (§8.5)", async () => {
    await updateEventAction({
      ...validInput(),
      status: "final",
      homeScore: "24",
      awayScore: "17",
    });

    expect(clearPickResultsForEvent).toHaveBeenCalledWith(UUID);
    expect(runStandingsRecalcForEvent).toHaveBeenCalledWith(UUID);
  });
});

describe("updateOddsAction", () => {
  function validInput() {
    return {
      id: UUID,
      homeSpread: "-3.5",
      awaySpread: "3.5",
      homeMoneyline: "-180",
      awayMoneyline: "150",
      overUnder: "47.5",
    };
  }

  it("rejects non-numeric input", async () => {
    const result = await updateOddsAction({
      ...validInput(),
      homeSpread: "pick-em",
    });

    expect(result.success).toBe(false);
    expect(updateOdds).not.toHaveBeenCalled();
  });

  it("rejects decimals in moneyline fields", async () => {
    const result = await updateOddsAction({
      ...validInput(),
      homeMoneyline: "-180.5",
    });

    expect(result.success).toBe(false);
    expect(updateOdds).not.toHaveBeenCalled();
  });

  it("parses and auto-locks on save", async () => {
    const result = await updateOddsAction(validInput());

    expect(result.success).toBe(true);
    expect(updateOdds).toHaveBeenCalledWith(UUID, {
      homeSpread: -3.5,
      awaySpread: 3.5,
      homeMoneyline: -180,
      awayMoneyline: 150,
      overUnder: 47.5,
      lockedAt: expect.any(Date),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/overrides");
  });

  it("converts empty strings to null", async () => {
    const result = await updateOddsAction({
      id: UUID,
      homeSpread: "",
      awaySpread: "",
      homeMoneyline: "",
      awayMoneyline: "",
      overUnder: "",
    });

    expect(result.success).toBe(true);
    expect(updateOdds).toHaveBeenCalledWith(UUID, {
      homeSpread: null,
      awaySpread: null,
      homeMoneyline: null,
      awayMoneyline: null,
      overUnder: null,
      lockedAt: expect.any(Date),
    });
  });

  it("returns a business error when the odds row is missing", async () => {
    vi.mocked(updateOdds).mockRejectedValueOnce(
      new NotFoundError("Odds not found"),
    );

    const result = await updateOddsAction(validInput());

    expect(result).toEqual({ success: false, error: "Odds not found" });
  });
});
