"use server";

import { revalidatePath } from "next/cache";

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
import { withTransaction } from "@/data/utils";
import { getSession } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { cleanupInvitesIfFull } from "@/lib/invites";
import {
  hasLeagueStartLockPassed,
  isPhaseInLeagueRange,
  selectCurrentSeason,
} from "@/lib/nfl/leagues";
import { assertLeagueCommissioner } from "@/lib/permissions";
import { getAppNow } from "@/lib/simulator";
import type { ActionResult } from "@/lib/types";
import {
  createLeagueSchema,
  deleteLeagueSchema,
  updateLeagueSchema,
} from "@/lib/validators/leagues";

export async function createLeagueAction(
  input: unknown,
): Promise<ActionResult<{ leagueId: string }>> {
  const parsed = createLeagueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid league details.",
    };
  }

  const session = await getSession();

  let sportsLeague;
  try {
    sportsLeague = await getSportsLeagueByAbbreviation("NFL");
  } catch (err) {
    if (err instanceof NotFoundError) {
      return {
        success: false,
        error:
          "NFL is not set up yet. Run the NFL setup before creating leagues.",
      };
    }
    throw err;
  }

  const now = await getAppNow();
  const seasons = await getSeasonsBySportsLeague(sportsLeague.id);
  const currentSeason = selectCurrentSeason(seasons, now);
  if (!currentSeason) {
    return {
      success: false,
      error:
        "No NFL season is synced yet. Run the NFL setup before creating leagues.",
    };
  }

  const {
    name,
    imageUrl,
    startSeasonType,
    startWeekNumber,
    endSeasonType,
    endWeekNumber,
    size,
    picksPerPhase,
    pickType,
  } = parsed.data;

  const range = {
    startSeasonType,
    startWeekNumber,
    endSeasonType,
    endWeekNumber,
  };

  // §3.1 + §3.8: league creation is only allowed when the chosen start
  // week's pick lock is still in the future for this season.
  const phases = await getPhasesBySeason(currentSeason.id);

  // Make sure both endpoints exist in this season — otherwise the user
  // picked a week that doesn't run in NFL (e.g. regular-season week 19).
  const startExists = phases.some(
    (p) => p.seasonType === startSeasonType && p.weekNumber === startWeekNumber,
  );
  const endExists = phases.some(
    (p) => p.seasonType === endSeasonType && p.weekNumber === endWeekNumber,
  );
  if (!startExists || !endExists) {
    return {
      success: false,
      error: "Selected weeks aren't part of this NFL season.",
    };
  }
  if (!phases.some((p) => isPhaseInLeagueRange(p, range))) {
    return {
      success: false,
      error: "No phases fall within the selected range.",
    };
  }

  // `startExists` above already guarantees the start phase is in the
  // list, so the "no start phase found" fall-through of
  // hasLeagueStartLockPassed can't fire here — we're purely gating on
  // pickLockTime > now.
  if (hasLeagueStartLockPassed(phases, range, now)) {
    return {
      success: false,
      error:
        "The selected start week's pick lock has already passed. Pick a later week or wait for next season.",
    };
  }

  const normalizedImageUrl = imageUrl && imageUrl !== "" ? imageUrl : null;

  const league = await withTransaction(async (tx) => {
    const created = await insertLeague(
      {
        sportsLeagueId: sportsLeague.id,
        name,
        imageUrl: normalizedImageUrl,
        startSeasonType,
        startWeekNumber,
        endSeasonType,
        endWeekNumber,
        size,
        picksPerPhase,
        pickType,
      },
      tx,
    );

    await insertLeagueMember(
      {
        leagueId: created.id,
        userId: session.user.id,
        role: "commissioner",
      },
      tx,
    );

    await insertLeagueStanding(
      {
        leagueId: created.id,
        userId: session.user.id,
        seasonId: currentSeason.id,
      },
      tx,
    );

    return created;
  });

  revalidatePath("/leagues");

  return { success: true, data: { leagueId: league.id } };
}

export async function updateLeagueAction(
  input: unknown,
): Promise<ActionResult<{ leagueId: string }>> {
  const parsed = updateLeagueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid league details.",
    };
  }

  const session = await getSession();

  const {
    leagueId,
    name,
    imageUrl,
    startSeasonType,
    startWeekNumber,
    endSeasonType,
    endWeekNumber,
    size,
    picksPerPhase,
    pickType,
  } = parsed.data;

  await assertLeagueCommissioner(session.user.id, leagueId);

  const league = await getLeagueById(leagueId);
  if (!league) {
    return { success: false, error: "League not found." };
  }

  const now = await getAppNow();
  const seasons = await getSeasonsBySportsLeague(league.sportsLeagueId);
  const currentSeason = selectCurrentSeason(seasons, now);
  const phases = currentSeason ? await getPhasesBySeason(currentSeason.id) : [];
  const memberCount = await getLeagueMemberCount(leagueId);

  const startLocked = hasLeagueStartLockPassed(phases, league, now);

  const rangeChanged =
    startSeasonType !== league.startSeasonType ||
    startWeekNumber !== league.startWeekNumber ||
    endSeasonType !== league.endSeasonType ||
    endWeekNumber !== league.endWeekNumber;

  const structuralChanged =
    rangeChanged ||
    size !== league.size ||
    picksPerPhase !== league.picksPerPhase ||
    pickType !== league.pickType;

  if (structuralChanged && startLocked) {
    // BUSINESS_SPEC §3.2 layers a second gate on top of the start lock:
    // "no picks submitted yet". The picks table doesn't exist until
    // PL-028, so today the start lock is the only gate. When picks ship,
    // fold in a picks-exist check here.
    return {
      success: false,
      error:
        "Structural settings are locked once the season's first pick lock has passed.",
    };
  }

  if (rangeChanged) {
    const range = {
      startSeasonType,
      startWeekNumber,
      endSeasonType,
      endWeekNumber,
    };
    const startExists = phases.some(
      (p) =>
        p.seasonType === startSeasonType && p.weekNumber === startWeekNumber,
    );
    const endExists = phases.some(
      (p) => p.seasonType === endSeasonType && p.weekNumber === endWeekNumber,
    );
    if (!startExists || !endExists) {
      return {
        success: false,
        error: "Selected weeks aren't part of this NFL season.",
      };
    }
    if (!phases.some((p) => isPhaseInLeagueRange(p, range))) {
      return {
        success: false,
        error: "No phases fall within the selected range.",
      };
    }
    // §3.1/§3.8 applied to edits: the new start week's pick lock must
    // still be in the future. Without this gate, a commissioner could
    // roll the start back to an already-locked earlier week — the
    // top-level `startLocked` check above only tests the CURRENT
    // start phase's lock.
    if (hasLeagueStartLockPassed(phases, range, now)) {
      return {
        success: false,
        error: "The selected start week's pick lock has already passed.",
      };
    }
  }

  if (size !== league.size && size < memberCount) {
    return {
      success: false,
      error: `League size can't go below the current member count (${memberCount}).`,
    };
  }

  const normalizedImageUrl = imageUrl && imageUrl !== "" ? imageUrl : null;

  await updateLeague(leagueId, {
    name,
    imageUrl: normalizedImageUrl,
    startSeasonType,
    startWeekNumber,
    endSeasonType,
    endWeekNumber,
    size,
    picksPerPhase,
    pickType,
  });

  // If the new size pushed the league to capacity, invalidate every
  // outstanding invite — this is the §5.4 invariant extended to settings
  // changes, not just joins.
  if (size < league.size) {
    await cleanupInvitesIfFull(leagueId);
  }

  revalidatePath(`/leagues/${leagueId}`, "layout");
  revalidatePath("/leagues");

  return { success: true, data: { leagueId } };
}

export async function deleteLeagueAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = deleteLeagueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid league id.",
    };
  }

  const session = await getSession();
  const { leagueId } = parsed.data;

  await assertLeagueCommissioner(session.user.id, leagueId);

  try {
    await removeLeague(leagueId);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: "League not found." };
    }
    throw err;
  }

  revalidatePath(`/leagues/${leagueId}`, "layout");
  revalidatePath("/leagues");

  return { success: true, data: undefined };
}
