import { z } from "zod";
import { PicksLeagueMemberRoles } from "./picksLeagueMembers";

export const JoinPicksLeagueSchema = z.object({
  leagueId: z.string().trim().uuid(),
});

export const PicksLeagueInviteFormSchema = z.object({
  leagueId: z.string().uuid(),
  role: z.enum([
    PicksLeagueMemberRoles.MEMBER,
    PicksLeagueMemberRoles.COMMISSIONER,
  ]),
});

export const PICKS_LEAGUE_INVITE_EXPIRATION = 7 * 24 * 60 * 60 * 1000;

export const DirectInviteFormSchema = z.object({
  leagueId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum([
    PicksLeagueMemberRoles.MEMBER,
    PicksLeagueMemberRoles.COMMISSIONER,
  ]),
});
