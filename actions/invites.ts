"use server";

import { randomUUID } from "node:crypto";

import { addDays } from "date-fns";
import { revalidatePath } from "next/cache";

import { getLeagueById, getLeagueMemberCount } from "@/data/leagues";
import {
  getDirectInviteById,
  getLinkInviteById,
  getLinkInviteByToken,
  insertLinkInvite,
  removeDirectInvite,
  removeLinkInvite,
  searchInviteCandidates,
  upsertDirectInvite,
} from "@/data/invites";
import { getLeagueMember, insertLeagueMember } from "@/data/members";
import { getActivePhasesForSportsLeague } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { insertLeagueStanding } from "@/data/standings";
import { withTransaction } from "@/data/utils";
import { getSession } from "@/lib/auth";
import type { League, LeagueRole, LinkInvite } from "@/lib/db/schema/leagues";
import type { Profile } from "@/lib/db/schema/profiles";
import { cleanupInvitesIfFull } from "@/lib/invites";
import { isLeagueInSeason, selectCurrentSeason } from "@/lib/nfl/leagues";
import { assertLeagueCommissioner } from "@/lib/permissions";
import type { ActionResult } from "@/lib/types";
import {
  createDirectInviteSchema,
  createLinkInviteSchema,
  joinViaLinkSchema,
  respondToDirectInviteSchema,
  revokeDirectInviteSchema,
  revokeLinkInviteSchema,
  searchProfilesSchema,
} from "@/lib/validators/invites";

const MAX_INVITE_CANDIDATES = 10;

type JoinSuccess = { alreadyMember: boolean };
type JoinError = { error: string };

async function joinLeague(
  league: League,
  userId: string,
  role: LeagueRole,
  options: { directInviteIdToDelete?: string } = {},
): Promise<JoinSuccess | JoinError> {
  const [activePhases, memberCount, existingMember] = await Promise.all([
    getActivePhasesForSportsLeague(league.sportsLeagueId, new Date()),
    getLeagueMemberCount(league.id),
    getLeagueMember(league.id, userId),
  ]);

  if (existingMember) {
    return { alreadyMember: true };
  }

  if (isLeagueInSeason(activePhases, league.seasonFormat)) {
    return {
      error: "This league is already in-season. You can't join mid-season.",
    };
  }

  if (memberCount >= league.size) {
    return { error: "This league is already at capacity." };
  }

  const seasons = await getSeasonsBySportsLeague(league.sportsLeagueId);
  const currentSeason = selectCurrentSeason(seasons);
  if (!currentSeason) {
    return { error: "No NFL season is synced yet. Try again later." };
  }

  await withTransaction(async (tx) => {
    await insertLeagueMember({ leagueId: league.id, userId, role }, tx);
    await insertLeagueStanding(
      { leagueId: league.id, userId, seasonId: currentSeason.id },
      tx,
    );
    if (options.directInviteIdToDelete) {
      await removeDirectInvite(options.directInviteIdToDelete, tx);
    }
  });

  await cleanupInvitesIfFull(league.id);
  return { alreadyMember: false };
}

function isJoinError(result: JoinSuccess | JoinError): result is JoinError {
  return "error" in result;
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
  revalidatePath("/leagues");

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
    revalidatePath("/leagues");
    return { success: true, data: undefined };
  }

  if (invite.expiresAt.getTime() <= Date.now()) {
    return { success: false, error: "This invite has expired." };
  }

  const league = await getLeagueById(invite.leagueId);
  if (!league) {
    return { success: false, error: "League not found." };
  }

  const joinResult = await joinLeague(league, session.user.id, invite.role, {
    directInviteIdToDelete: inviteId,
  });
  if (isJoinError(joinResult)) {
    return { success: false, error: joinResult.error };
  }

  revalidatePath(`/leagues/${league.id}`, "layout");
  revalidatePath("/leagues");

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

export async function createLinkInviteAction(
  input: unknown,
): Promise<ActionResult<{ invite: LinkInvite }>> {
  const parsed = createLinkInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid invite details.",
    };
  }

  const session = await getSession();
  const { leagueId, role, expirationDays } = parsed.data;

  await assertLeagueCommissioner(session.user.id, leagueId);

  const league = await getLeagueById(leagueId);
  if (!league) {
    return { success: false, error: "League not found." };
  }

  const [activePhases, memberCount] = await Promise.all([
    getActivePhasesForSportsLeague(league.sportsLeagueId, new Date()),
    getLeagueMemberCount(leagueId),
  ]);

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
  const invite = await insertLinkInvite({
    leagueId,
    inviterUserId: session.user.id,
    role,
    expiresAt,
    token: randomUUID(),
  });

  revalidatePath(`/leagues/${leagueId}`, "layout");

  return { success: true, data: { invite } };
}

export async function revokeLinkInviteAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = revokeLinkInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid invite id.",
    };
  }

  const session = await getSession();
  const { inviteId } = parsed.data;

  const invite = await getLinkInviteById(inviteId);
  if (!invite) {
    return { success: false, error: "Invite not found." };
  }

  await assertLeagueCommissioner(session.user.id, invite.leagueId);
  await removeLinkInvite(inviteId);

  revalidatePath(`/leagues/${invite.leagueId}`, "layout");

  return { success: true, data: undefined };
}

export async function revokeDirectInviteAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = revokeDirectInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid invite id.",
    };
  }

  const session = await getSession();
  const { inviteId } = parsed.data;

  const invite = await getDirectInviteById(inviteId);
  if (!invite) {
    return { success: false, error: "Invite not found." };
  }

  await assertLeagueCommissioner(session.user.id, invite.leagueId);
  await removeDirectInvite(inviteId);

  revalidatePath(`/leagues/${invite.leagueId}`, "layout");
  // Revoked invite disappears from the invitee's /leagues open-invite list.
  revalidatePath("/leagues");

  return { success: true, data: undefined };
}

export async function joinViaLinkInviteAction(
  input: unknown,
): Promise<ActionResult<{ leagueId: string; alreadyMember: boolean }>> {
  const parsed = joinViaLinkSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid invite link.",
    };
  }

  const session = await getSession();
  const { token } = parsed.data;

  const invite = await getLinkInviteByToken(token);
  if (!invite) {
    return { success: false, error: "Invite not found." };
  }

  if (invite.expiresAt.getTime() <= Date.now()) {
    return { success: false, error: "This invite has expired." };
  }

  const league = await getLeagueById(invite.leagueId);
  if (!league) {
    return { success: false, error: "League not found." };
  }

  const joinResult = await joinLeague(league, session.user.id, invite.role);
  if (isJoinError(joinResult)) {
    return { success: false, error: joinResult.error };
  }

  revalidatePath(`/leagues/${league.id}`, "layout");
  revalidatePath("/leagues");

  return {
    success: true,
    data: { leagueId: league.id, alreadyMember: joinResult.alreadyMember },
  };
}
