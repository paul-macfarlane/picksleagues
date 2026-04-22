"use server";

import { revalidatePath } from "next/cache";

import {
  clearLockedEvent,
  clearLockedOdds,
  setLockedEvent,
  setLockedOdds,
  updateEvent,
  updateOdds,
} from "@/data/events";
import { clearLockedPhase, setLockedPhase, updatePhase } from "@/data/phases";
import { clearPickResultsForEvent } from "@/data/picks";
import { clearLockedTeam, setLockedTeam, updateTeam } from "@/data/teams";
import { NotFoundError } from "@/lib/errors";
import { requireAdminSession } from "@/lib/permissions";
import { runStandingsRecalcForEvent } from "@/lib/sync/nfl/standings";
import type { ActionResult } from "@/lib/types";
import {
  parseDecimal,
  parseInteger,
  parsePeriod,
  parseScore,
  parseUtcDatetime,
  toggleLockSchema,
  updateEventSchema,
  updateOddsSchema,
  updatePhaseSchema,
  updateTeamSchema,
} from "@/lib/validators/admin-overrides";

const OVERRIDES_PATH = "/admin/overrides";

export async function toggleLockAction(input: unknown): Promise<ActionResult> {
  const parsed = toggleLockSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  await requireAdminSession();

  const { entity, id, locked } = parsed.data;
  const now = new Date();

  try {
    switch (entity) {
      case "team":
        if (locked) {
          await setLockedTeam(id, now);
        } else {
          await clearLockedTeam(id);
        }
        break;
      case "phase":
        if (locked) {
          await setLockedPhase(id, now);
        } else {
          await clearLockedPhase(id);
        }
        break;
      case "event":
        if (locked) {
          await setLockedEvent(id, now);
        } else {
          await clearLockedEvent(id);
        }
        break;
      case "odds":
        if (locked) {
          await setLockedOdds(id, now);
        } else {
          await clearLockedOdds(id);
        }
        break;
    }
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath(OVERRIDES_PATH);
  return { success: true, data: undefined };
}

export async function updateTeamAction(input: unknown): Promise<ActionResult> {
  const parsed = updateTeamSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  await requireAdminSession();

  const { id, name, location, abbreviation, logoUrl, logoDarkUrl } =
    parsed.data;

  try {
    await updateTeam(id, {
      name,
      location,
      abbreviation,
      logoUrl,
      logoDarkUrl,
      lockedAt: new Date(),
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath(OVERRIDES_PATH);
  return { success: true, data: undefined };
}

export async function updateEventAction(input: unknown): Promise<ActionResult> {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  await requireAdminSession();

  const {
    id,
    homeTeamId,
    awayTeamId,
    startTime,
    status,
    homeScore,
    awayScore,
    period,
    clock,
  } = parsed.data;

  try {
    await updateEvent(id, {
      homeTeamId,
      awayTeamId,
      startTime: parseUtcDatetime(startTime),
      status,
      homeScore: parseScore(homeScore),
      awayScore: parseScore(awayScore),
      period: parsePeriod(period),
      clock: clock === "" ? null : clock,
      lockedAt: new Date(),
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  // §8.5: when an admin edits an event, picks on it are invalidated
  // first (so a mid-flight recalc failure leaves the event's picks as
  // "unscored" rather than carrying a stale cached result), then the
  // scoped recalc re-scores them and recomputes standings for every
  // league that has picks on this event.
  await clearPickResultsForEvent(id);
  await runStandingsRecalcForEvent(id);

  revalidatePath(OVERRIDES_PATH);
  // Status/score changes on an event affect every league page that
  // renders that event (my-picks, league-picks, standings). Revalidate
  // the whole `/leagues` subtree so users don't see a stale `not_started`
  // row and bypass the pick lock.
  revalidatePath("/leagues", "layout");
  return { success: true, data: undefined };
}

export async function updateOddsAction(input: unknown): Promise<ActionResult> {
  const parsed = updateOddsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  await requireAdminSession();

  const {
    id,
    homeSpread,
    awaySpread,
    homeMoneyline,
    awayMoneyline,
    overUnder,
  } = parsed.data;

  try {
    await updateOdds(id, {
      homeSpread: parseDecimal(homeSpread),
      awaySpread: parseDecimal(awaySpread),
      homeMoneyline: parseInteger(homeMoneyline),
      awayMoneyline: parseInteger(awayMoneyline),
      overUnder: parseDecimal(overUnder),
      lockedAt: new Date(),
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath(OVERRIDES_PATH);
  return { success: true, data: undefined };
}

export async function updatePhaseAction(input: unknown): Promise<ActionResult> {
  const parsed = updatePhaseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  await requireAdminSession();

  const { id, label, startDate, endDate, pickLockTime } = parsed.data;

  try {
    await updatePhase(id, {
      label,
      startDate: parseUtcDatetime(startDate),
      endDate: parseUtcDatetime(endDate),
      pickLockTime: parseUtcDatetime(pickLockTime),
      lockedAt: new Date(),
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath(OVERRIDES_PATH);
  return { success: true, data: undefined };
}
