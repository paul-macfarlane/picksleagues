import { NextRequest } from "next/server";
import { upsertSportLeaguesFromESPN } from "@/services/sportLeagues";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json(
      { error: "Unauthorized" },
      {
        status: 401,
      },
    );
  }

  try {
    const upsertedLeagues = await upsertSportLeaguesFromESPN();
    console.log(`upserted ${upsertedLeagues.length} sport leagues from espn`);
  } catch (e) {
    console.error(e);

    return Response.json(
      {
        error: "Internal Server Error",
      },
      {
        status: 500,
      },
    );
  }

  return Response.json({
    success: true,
  });
}
