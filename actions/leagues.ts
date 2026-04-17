"use server";

import { revalidatePath } from "next/cache";

import { insertLeague } from "@/data/leagues";
import { insertLeagueMember } from "@/data/members";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSportsLeagueByAbbreviation } from "@/data/sports";
import { insertLeagueStanding } from "@/data/standings";
import { withTransaction } from "@/data/utils";
import { getSession } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { selectCurrentSeason } from "@/lib/nfl/leagues";
import type { ActionResult } from "@/lib/types";
import { createLeagueSchema } from "@/lib/validators/leagues";

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

  const seasons = await getSeasonsBySportsLeague(sportsLeague.id);
  const currentSeason = selectCurrentSeason(seasons);
  if (!currentSeason) {
    return {
      success: false,
      error:
        "No NFL season is synced yet. Run the NFL setup before creating leagues.",
    };
  }

  const { name, imageUrl, seasonFormat, size, picksPerPhase, pickType } =
    parsed.data;

  const league = await withTransaction(async (tx) => {
    const created = await insertLeague(
      {
        sportsLeagueId: sportsLeague.id,
        name,
        imageUrl: imageUrl ?? null,
        seasonFormat,
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
  revalidatePath("/home");

  return { success: true, data: { leagueId: league.id } };
}
