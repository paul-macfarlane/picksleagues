"use server";

import { auth } from "@/auth";
import {
  createDBLeague,
  createDBLeagueSeason,
  createDBLeagueMember,
  DBLeague,
} from "@/db/leagues";
import {
  getDBSportById,
  getActiveSeasonForSport,
  getDBSportWeekById,
} from "@/db/sports";
import { getDBUserById } from "@/db/users";
import { withTransaction } from "@/db/util";
import { CreateLeagueSchema, LeagueMemberRoles } from "@/models/leagues";
import { redirect } from "next/navigation";

export interface CreateLeagueFormState {
  errors?: {
    form?: string;
    name?: string;
    logoUrl?: string;
    sportId?: string;
    picksPerWeek?: string;
    pickType?: string;
    startWeekId?: string;
    endWeekId?: string;
    leagueVisibility?: string;
    size?: string;
  };
  leagueId?: string;
}

export async function createLeagueAction(
  _prevState: CreateLeagueFormState,
  formData: FormData,
): Promise<CreateLeagueFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return redirect("/auth");
  }

  const dbUser = await getDBUserById(session.user.id);
  if (!dbUser) {
    console.error(
      `User with id ${session.user.id} from session not found in db while creating league`,
    );

    return {
      errors: {
        form: "An unexpected error occurred. Please try again later.",
      },
    };
  }

  const parsed = CreateLeagueSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: {
        name: parsed.error.issues
          .filter((error) => error.path.join(".") === "name")
          .map((error) => error.message)
          .join(", "),
        logoUrl: parsed.error.issues
          .filter((error) => error.path.join(".") === "logoUrl")
          .map((error) => error.message)
          .join(", "),
        sportId: parsed.error.issues
          .filter((error) => error.path.join(".") === "sportId")
          .map((error) => error.message)
          .join(", "),
        leagueVisibility: parsed.error.issues
          .filter((error) => error.path.join(".") === "leagueVisibility")
          .map((error) => error.message)
          .join(", "),
        pickType: parsed.error.issues
          .filter((error) => error.path.join(".") === "pickType")
          .map((error) => error.message)
          .join(", "),
        picksPerWeek: parsed.error.issues
          .filter((error) => error.path.join(".") === "picksPerWeek")
          .map((error) => error.message)
          .join(", "),
        startWeekId: parsed.error.issues
          .filter((error) => error.path.join(".") === "startWeekId")
          .map((error) => error.message)
          .join(", "),
        endWeekId: parsed.error.issues
          .filter((error) => error.path.join(".") === "endWeekId")
          .map((error) => error.message)
          .join(", "),
        size: parsed.error.issues
          .filter((error) => error.path.join(".") === "size")
          .map((error) => error.message)
          .join(", "),
      },
    };
  }

  const dbSport = await getDBSportById(parsed.data.sportId);
  if (!dbSport) {
    console.error(`Sport with id ${parsed.data.sportId} not found.`);
    return {
      errors: {
        sportId: "Invalid Sport",
      },
    };
  }

  const dbActiveSeason = await getActiveSeasonForSport(parsed.data.sportId);
  if (!dbActiveSeason) {
    console.error(
      `Sport with id ${dbSport.id} (${dbSport.name}) does not have an active season.`,
    );
    return {
      errors: {
        sportId: "Selected Sport does not have an active season.",
      },
    };
  }

  const dbStartWeek = await getDBSportWeekById(parsed.data.startWeekId);
  if (!dbStartWeek) {
    console.error(`Sports week with id ${parsed.data.startWeekId} not found.`);
    return {
      errors: {
        startWeekId: "Invalid Start Week",
      },
    };
  }

  const dbEndWeek = await getDBSportWeekById(parsed.data.endWeekId);
  if (!dbEndWeek) {
    console.error(`Sports week with id ${parsed.data.endWeekId} not found.`);
    return {
      errors: {
        endWeekId: "Invalid End Week",
      },
    };
  }

  if (dbEndWeek.startTime < dbStartWeek.startTime) {
    return {
      errors: {
        startWeekId: "Start Week must be before or the same week as End Week",
      },
    };
  }

  let dbLeague: DBLeague | undefined = undefined;
  try {
    dbLeague = await withTransaction(async (tx) => {
      const createDBLeagueData = {
        name: parsed.data.name,
        logoUrl: parsed.data.logoUrl,
        sportId: parsed.data.sportId,
        picksPerWeek: parsed.data.picksPerWeek,
        pickType: parsed.data.pickType,
        leagueVisibility: parsed.data.leagueVisibility,
        size: parsed.data.size,
      };
      const dbLeague = await createDBLeague(createDBLeagueData, tx);
      if (!dbLeague) {
        console.error("Unable to create league with data", createDBLeagueData);

        throw new Error("Unable to create league");
      }

      const createDBLeagueSeasonData = {
        leagueId: dbLeague.id,
        sportSeasonId: dbActiveSeason.id,
        startSportWeekId: dbStartWeek.id,
        endSportWeekId: dbEndWeek.id,
        active: true,
      };
      const dbLeagueSeason = await createDBLeagueSeason(
        createDBLeagueSeasonData,
        tx,
      );
      if (!dbLeagueSeason) {
        console.error(
          "Unable to create league season with ",
          createDBLeagueSeasonData,
        );

        throw new Error("Unable to create league season");
      }

      const createDBLeagueMemberData = {
        userId: dbUser.id,
        leagueId: dbLeague.id,
        role: LeagueMemberRoles.COMMISSIONER,
      };
      const dbLeagueMember = await createDBLeagueMember(
        createDBLeagueMemberData,
        tx,
      );
      if (!dbLeagueMember) {
        console.error(
          "Unable to create league member with ",
          createDBLeagueMemberData,
        );

        throw new Error("Unable to create league member");
      }

      return dbLeague;
    });
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(e.message);
    }

    return {
      errors: {
        form: "Unable to create league at this time. Please try again later.",
      },
    };
  }

  return {
    leagueId: dbLeague?.id,
  };
}
