"use server";

import { auth } from "@/auth";
import { getDBPicksLeagueByIdWithMemberCount } from "@/db/picksLeagues";
import { redirect } from "next/navigation";
import {
  createDBPicksLeagueInvite,
  getOpenDBPicksLeagueInvitesForUser,
} from "@/db/picksLeagueInvite";
import {
  DirectInviteFormSchema,
  PicksLeagueInviteFormSchema,
} from "@/models/picksLeagueInvites";
import { AUTH_URL } from "@/models/auth";
import { getDBPicksLeagueMember } from "@/db/picksLeagueMembers";
import { getDBUserById } from "@/db/users";
import { PicksLeagueMemberRoles } from "@/models/picksLeagueMembers";
import { picksLeagueIsInSeason } from "@/services/picksLeagues";
import { getNextDBPicksLeagueSeason } from "@/db/picksLeagueSeasons";
import { getDBSportLeagueWeekById } from "@/db/sportLeagues";

export interface LeagueInviteActionState {
  errors?: {
    form?: string;
    leagueId?: string;
  };
  inviteUrl?: string;
}

export async function picksLeagueInviteAction(
  _prevState: LeagueInviteActionState,
  formData: FormData,
): Promise<LeagueInviteActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return redirect(AUTH_URL);
  }

  const dbUser = await getDBUserById(session.user.id);
  if (!dbUser) {
    console.error(
      `unable to find db user using id from session ${session.user.id} on invite action`,
    );
    return redirect(AUTH_URL);
  }

  // Try parsing as direct invite first
  const directInviteParsed = DirectInviteFormSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (directInviteParsed.success) {
    const { leagueId, userId, role } = directInviteParsed.data;

    const dbPicksLeague = await getDBPicksLeagueByIdWithMemberCount(leagueId);
    if (!dbPicksLeague) {
      return {
        errors: {
          leagueId: "League not found",
        },
      };
    }

    if (dbPicksLeague.memberCount >= dbPicksLeague.size) {
      return {
        errors: {
          leagueId: "League cannot be joined because it is full",
        },
      };
    }

    const picksLeagueMember = await getDBPicksLeagueMember(
      dbPicksLeague.id,
      dbUser.id,
    );
    if (!picksLeagueMember) {
      return {
        errors: {
          form: "Cannot send invite for a league you are not a part of",
        },
      };
    }

    if (picksLeagueMember.role !== PicksLeagueMemberRoles.COMMISSIONER) {
      return {
        errors: {
          form: "Cannot send invite for a league you are not the commissioner of",
        },
      };
    }

    const invitedUser = await getDBUserById(userId);
    if (!invitedUser) {
      return {
        errors: {
          form: "User not found",
        },
      };
    }

    const existingMember = await getDBPicksLeagueMember(leagueId, userId);
    if (existingMember) {
      return {
        errors: {
          form: "User is already a member of this league",
        },
      };
    }

    const existingInvites = await getOpenDBPicksLeagueInvitesForUser(
      leagueId,
      userId,
    );
    if (existingInvites.length > 0) {
      return {
        errors: {
          form: "User is already invited to this league",
        },
      };
    }

    const leagueIsInSeason = await picksLeagueIsInSeason(leagueId);
    if (leagueIsInSeason) {
      return {
        errors: {
          form: "Cannot invite members to league while in season",
        },
      };
    }

    const nextSeason = await getNextDBPicksLeagueSeason(leagueId);
    if (!nextSeason) {
      return {
        errors: {
          form: "There is no next season for this league",
        },
      };
    }

    const startWeek = await getDBSportLeagueWeekById(
      nextSeason.startSportLeagueWeekId,
    );
    if (!startWeek) {
      return {
        errors: {
          form: "Unable to find start week for next season",
        },
      };
    }

    const createInviteData = {
      leagueId,
      userId,
      expiresAt: startWeek.startTime,
      role,
    };

    const dbInvite = await createDBPicksLeagueInvite(createInviteData);
    if (!dbInvite) {
      console.error("Unable to create league invite with ", createInviteData);

      return {
        errors: {
          form: "Unable to generate invite. Please try again later.",
        },
      };
    }

    return {};
  }

  // If not a direct invite, try parsing as a link invite
  const parsed = PicksLeagueInviteFormSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success) {
    return {
      errors: {
        leagueId: parsed.error.issues
          .filter((error) => error.path.join(".") === "leagueId")
          .map((error) => error.message)
          .join(", "),
      },
    };
  }

  const { leagueId, role } = parsed.data;
  const dbPicksLeague = await getDBPicksLeagueByIdWithMemberCount(leagueId);
  if (!dbPicksLeague) {
    return {
      errors: {
        leagueId: "League not found",
      },
    };
  }

  if (dbPicksLeague.memberCount >= dbPicksLeague.size) {
    return {
      errors: {
        leagueId: "League cannot be joined because it is full",
      },
    };
  }

  const picksLeagueMember = await getDBPicksLeagueMember(
    dbPicksLeague.id,
    dbUser.id,
  );
  if (!picksLeagueMember) {
    return {
      errors: {
        form: "Cannot send invite for a league you are not a part of",
      },
    };
  }

  if (picksLeagueMember.role !== PicksLeagueMemberRoles.COMMISSIONER) {
    return {
      errors: {
        form: "Cannot send invite for a league you are not the commissioner of",
      },
    };
  }

  const leagueIsInSeason = await picksLeagueIsInSeason(leagueId);
  if (leagueIsInSeason) {
    return {
      errors: {
        form: "Cannot invite members to league while in season",
      },
    };
  }

  const nextSeason = await getNextDBPicksLeagueSeason(leagueId);
  if (!nextSeason) {
    return {
      errors: {
        form: "There is no next season for this league",
      },
    };
  }

  const startWeek = await getDBSportLeagueWeekById(
    nextSeason.startSportLeagueWeekId,
  );
  if (!startWeek) {
    return {
      errors: {
        form: "Unable to find start week for next season",
      },
    };
  }

  const createInviteData = {
    leagueId,
    expiresAt: startWeek.startTime,
    role,
  };
  const dbInvite = await createDBPicksLeagueInvite(createInviteData);
  if (!dbInvite) {
    console.error("Unable to create league invite with ", createInviteData);

    return {
      errors: {
        form: "Unable to generate invite. Please try again later.",
      },
    };
  }

  return {
    inviteUrl: `${process.env.NEXT_PUBLIC_HOST!}/invites/${dbInvite.id}`,
  };
}
