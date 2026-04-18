"use server";

import { revalidatePath } from "next/cache";

import {
  getLeagueById,
  getLeagueMemberCount,
  removeLeague,
} from "@/data/leagues";
import {
  getCommissionerCount,
  getLeagueMember,
  removeLeagueMember,
  updateLeagueMemberRole,
} from "@/data/members";
import { getActivePhasesForSportsLeague } from "@/data/phases";
import { removeLeagueStandingsForUser } from "@/data/standings";
import { withTransaction } from "@/data/utils";
import { getSession } from "@/lib/auth";
import { isLeagueInSeason } from "@/lib/nfl/leagues";
import {
  assertLeagueCommissioner,
  assertLeagueMember,
} from "@/lib/permissions";
import { getAppNow } from "@/lib/simulator";
import type { ActionResult } from "@/lib/types";
import {
  demoteMemberSchema,
  leaveLeagueSchema,
  promoteMemberSchema,
  removeMemberSchema,
} from "@/lib/validators/members";

export async function promoteMemberAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = promoteMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const session = await getSession();
  const { leagueId, userId } = parsed.data;
  await assertLeagueCommissioner(session.user.id, leagueId);

  const target = await getLeagueMember(leagueId, userId);
  if (!target) {
    return { success: false, error: "Member not found." };
  }
  if (target.role === "commissioner") {
    return { success: false, error: "That member is already a commissioner." };
  }

  await updateLeagueMemberRole(leagueId, userId, "commissioner");
  revalidatePath(`/leagues/${leagueId}`, "layout");
  return { success: true, data: undefined };
}

export async function demoteMemberAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = demoteMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const session = await getSession();
  const { leagueId, userId } = parsed.data;
  await assertLeagueCommissioner(session.user.id, leagueId);

  const target = await getLeagueMember(leagueId, userId);
  if (!target) {
    return { success: false, error: "Member not found." };
  }
  if (target.role !== "commissioner") {
    return { success: false, error: "That member isn't a commissioner." };
  }

  if (target.userId === session.user.id) {
    const commissionerCount = await getCommissionerCount(leagueId);
    if (commissionerCount <= 1) {
      return {
        success: false,
        error:
          "You're the only commissioner. Promote someone else before demoting yourself.",
      };
    }
  }

  await updateLeagueMemberRole(leagueId, userId, "member");
  revalidatePath(`/leagues/${leagueId}`, "layout");
  return { success: true, data: undefined };
}

export async function removeMemberAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const session = await getSession();
  const { leagueId, userId } = parsed.data;
  await assertLeagueCommissioner(session.user.id, leagueId);

  if (userId === session.user.id) {
    return {
      success: false,
      error: "Use 'Leave league' to remove yourself.",
    };
  }

  const league = await getLeagueById(leagueId);
  if (!league) {
    return { success: false, error: "League not found." };
  }

  const activePhases = await getActivePhasesForSportsLeague(
    league.sportsLeagueId,
    await getAppNow(),
  );
  if (isLeagueInSeason(activePhases, league)) {
    return {
      success: false,
      error: "Members can't be removed while the league is in-season.",
    };
  }

  const target = await getLeagueMember(leagueId, userId);
  if (!target) {
    return { success: false, error: "Member not found." };
  }

  await removeLeagueMember(leagueId, userId);
  revalidatePath(`/leagues/${leagueId}`, "layout");
  revalidatePath("/leagues");
  return { success: true, data: undefined };
}

export async function leaveLeagueAction(
  input: unknown,
): Promise<ActionResult<{ leagueDeleted: boolean }>> {
  const parsed = leaveLeagueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const session = await getSession();
  const { leagueId } = parsed.data;
  const member = await assertLeagueMember(session.user.id, leagueId);

  const league = await getLeagueById(leagueId);
  if (!league) {
    return { success: false, error: "League not found." };
  }

  const [activePhases, memberCount] = await Promise.all([
    getActivePhasesForSportsLeague(league.sportsLeagueId, await getAppNow()),
    getLeagueMemberCount(leagueId),
  ]);

  if (isLeagueInSeason(activePhases, league)) {
    return {
      success: false,
      error: "You can't leave the league while it's in-season.",
    };
  }

  if (memberCount <= 1) {
    await removeLeague(leagueId);
    revalidatePath(`/leagues/${leagueId}`, "layout");
    revalidatePath("/leagues");
    return { success: true, data: { leagueDeleted: true } };
  }

  if (member.role === "commissioner") {
    const commissionerCount = await getCommissionerCount(leagueId);
    if (commissionerCount <= 1) {
      return {
        success: false,
        error:
          "Promote another commissioner before leaving — you're the only one.",
      };
    }
  }

  await withTransaction(async (tx) => {
    await removeLeagueMember(leagueId, session.user.id, tx);
    await removeLeagueStandingsForUser(leagueId, session.user.id, tx);
  });
  revalidatePath(`/leagues/${leagueId}`, "layout");
  revalidatePath("/leagues");
  return { success: true, data: { leagueDeleted: false } };
}
