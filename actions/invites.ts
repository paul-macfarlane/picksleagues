"use server";

import { revalidatePath } from "next/cache";

import { getLeagueById, getLeagueMemberCount } from "@/data/leagues";
import {
  getDirectInviteById,
  removeDirectInvite,
  removeDirectInvitesByLeague,
  searchInviteCandidates,
  upsertDirectInvite,
} from "@/data/invites";
import { getLeagueMember, insertLeagueMember } from "@/data/members";
import { getActivePhasesForSportsLeague } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { insertLeagueStanding } from "@/data/standings";
import { withTransaction } from "@/data/utils";
import { getSession } from "@/lib/auth";
import type { Profile } from "@/lib/db/schema/profiles";
import { isLeagueInSeason, selectCurrentSeason } from "@/lib/nfl/leagues";
import { assertLeagueCommissioner } from "@/lib/permissions";
import type { ActionResult } from "@/lib/types";
import {
  createDirectInviteSchema,
  respondToDirectInviteSchema,
  searchProfilesSchema,
} from "@/lib/validators/invites";

const MAX_INVITE_CANDIDATES = 10;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function cleanupInvitesIfFull(leagueId: string): Promise<void> {
  const league = await getLeagueById(leagueId);
  if (!league) return;
  const count = await getLeagueMemberCount(leagueId);
  if (count >= league.size) {
    await removeDirectInvitesByLeague(leagueId);
  }
}

export async function createDirectInviteAction(
  input: unknown,
): Promise<ActionResult<{ inviteId: string }>> {
  const parsed = createDirectInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid invite details.",
    };
  }

  const session = await getSession();
  const { leagueId, inviteeUserId, role, expirationDays } = parsed.data;

  await assertLeagueCommissioner(session.user.id, leagueId);

  const league = await getLeagueById(leagueId);
  if (!league) {
    return { success: false, error: "League not found." };
  }

  const [activePhases, memberCount, existingMember] = await Promise.all([
    getActivePhasesForSportsLeague(league.sportsLeagueId, new Date()),
    getLeagueMemberCount(leagueId),
    getLeagueMember(leagueId, inviteeUserId),
  ]);

  if (existingMember) {
    return { success: false, error: "That user is already in the league." };
  }

  if (isLeagueInSeason(activePhases, league.seasonFormat)) {
    return {
      success: false,
      error: "Invites can't be created while the league is in-season.",
    };
  }

  if (memberCount >= league.size) {
    return { success: false, error: "League is already at capacity." };
  }

  const expiresAt = addDays(new Date(), expirationDays);
  const invite = await upsertDirectInvite({
    leagueId,
    inviteeUserId,
    inviterUserId: session.user.id,
    role,
    expiresAt,
  });

  revalidatePath(`/leagues/${leagueId}`, "layout");
  revalidatePath("/home");

  return { success: true, data: { inviteId: invite.id } };
}

export async function respondToDirectInviteAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = respondToDirectInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid invite response.",
    };
  }

  const session = await getSession();
  const { inviteId, response } = parsed.data;

  const invite = await getDirectInviteById(inviteId);
  if (!invite || invite.inviteeUserId !== session.user.id) {
    return { success: false, error: "Invite not found." };
  }

  if (response === "decline") {
    await removeDirectInvite(inviteId);
    revalidatePath("/home");
    return { success: true, data: undefined };
  }

  if (invite.expiresAt.getTime() <= Date.now()) {
    return { success: false, error: "This invite has expired." };
  }

  const league = await getLeagueById(invite.leagueId);
  if (!league) {
    return { success: false, error: "League not found." };
  }

  const [activePhases, memberCount] = await Promise.all([
    getActivePhasesForSportsLeague(league.sportsLeagueId, new Date()),
    getLeagueMemberCount(league.id),
  ]);

  if (isLeagueInSeason(activePhases, league.seasonFormat)) {
    return {
      success: false,
      error: "This league is already in-season. You can't join mid-season.",
    };
  }

  if (memberCount >= league.size) {
    return { success: false, error: "This league is already at capacity." };
  }

  const seasons = await getSeasonsBySportsLeague(league.sportsLeagueId);
  const currentSeason = selectCurrentSeason(seasons);
  if (!currentSeason) {
    return {
      success: false,
      error: "No NFL season is synced yet. Try again later.",
    };
  }

  await withTransaction(async (tx) => {
    await insertLeagueMember(
      {
        leagueId: league.id,
        userId: session.user.id,
        role: invite.role,
      },
      tx,
    );
    await insertLeagueStanding(
      {
        leagueId: league.id,
        userId: session.user.id,
        seasonId: currentSeason.id,
      },
      tx,
    );
    await removeDirectInvite(inviteId, tx);
  });

  await cleanupInvitesIfFull(league.id);

  revalidatePath(`/leagues/${league.id}`, "layout");
  revalidatePath("/leagues");
  revalidatePath("/home");

  return { success: true, data: undefined };
}

export async function searchInviteCandidatesAction(
  input: unknown,
): Promise<ActionResult<Profile[]>> {
  const parsed = searchProfilesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid search.",
    };
  }

  const session = await getSession();
  const { leagueId, query } = parsed.data;

  await assertLeagueCommissioner(session.user.id, leagueId);

  const candidates = await searchInviteCandidates(
    leagueId,
    query,
    MAX_INVITE_CANDIDATES,
  );
  return { success: true, data: candidates };
}
