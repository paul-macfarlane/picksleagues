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
import { getLeagueMember } from "@/data/members";
import { getPhasesBySeason } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSession } from "@/lib/auth";
import type { LinkInvite } from "@/lib/db/schema/leagues";
import type { Profile } from "@/lib/db/schema/profiles";
import { joinLeague } from "@/lib/invites";
import {
  hasLeagueStartLockPassed,
  leagueActivationTime,
  selectCurrentSeason,
} from "@/lib/nfl/leagues";
import { assertLeagueCommissioner } from "@/lib/permissions";
import { getAppNow } from "@/lib/simulator";
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

  const now = await getAppNow();
  const [memberCount, existingMember, seasons] = await Promise.all([
    getLeagueMemberCount(leagueId),
    getLeagueMember(leagueId, inviteeUserId),
    getSeasonsBySportsLeague(league.sportsLeagueId),
  ]);

  if (existingMember) {
    return { success: false, error: "That user is already in the league." };
  }

  const currentSeason = selectCurrentSeason(seasons, now);
  if (!currentSeason) {
    return {
      success: false,
      error: "No NFL season is synced yet. Try again later.",
    };
  }
  const phases = await getPhasesBySeason(currentSeason.id);
  const activation = leagueActivationTime(
    league.createdAt,
    currentSeason.startDate,
  );
  if (hasLeagueStartLockPassed(phases, league.seasonFormat, activation, now)) {
    return {
      success: false,
      error:
        "New invites can't be created — the league's start lock has already passed.",
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
  if (joinResult.status === "error") {
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

  const now = await getAppNow();
  const [memberCount, seasons] = await Promise.all([
    getLeagueMemberCount(leagueId),
    getSeasonsBySportsLeague(league.sportsLeagueId),
  ]);

  const currentSeason = selectCurrentSeason(seasons, now);
  if (!currentSeason) {
    return {
      success: false,
      error: "No NFL season is synced yet. Try again later.",
    };
  }
  const phases = await getPhasesBySeason(currentSeason.id);
  const activation = leagueActivationTime(
    league.createdAt,
    currentSeason.startDate,
  );
  if (hasLeagueStartLockPassed(phases, league.seasonFormat, activation, now)) {
    return {
      success: false,
      error:
        "New invites can't be created — the league's start lock has already passed.",
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
  if (joinResult.status === "error") {
    return { success: false, error: joinResult.error };
  }

  revalidatePath(`/leagues/${league.id}`, "layout");
  revalidatePath("/leagues");

  return {
    success: true,
    data: {
      leagueId: league.id,
      alreadyMember: joinResult.status === "already_member",
    },
  };
}
