"use server";

import { revalidatePath } from "next/cache";

import { getLeagueById } from "@/data/leagues";
import {
  getCommissionerCount,
  getLeagueMember,
  removeLeagueMember,
  updateLeagueMemberRole,
} from "@/data/members";
import { getActivePhasesForSportsLeague } from "@/data/phases";
import { getSession } from "@/lib/auth";
import { isLeagueInSeason } from "@/lib/nfl/leagues";
import { assertLeagueCommissioner } from "@/lib/permissions";
import type { ActionResult } from "@/lib/types";
import {
  demoteMemberSchema,
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
    new Date(),
  );
  if (isLeagueInSeason(activePhases, league.seasonFormat)) {
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
  revalidatePath("/home");
  return { success: true, data: undefined };
}
