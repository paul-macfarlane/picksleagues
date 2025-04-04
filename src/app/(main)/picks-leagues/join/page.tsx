import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import FilterLeaguesForm from "@/app/(main)/picks-leagues/join/filter-leagues-form";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { filterDBPicksLeagues } from "@/db/picksLeagues";
import { z } from "zod";
import {
  PICKS_LEAGUE_MAX_SIZE,
  PICKS_LEAGUE_MAX_PICKS_PER_WEEK,
  PICKS_LEAGUE_MIN_SIZE,
  PICKS_LEAGUE_MIN_PICKS_PER_WEEK,
  PicksLeaguePickTypes,
} from "@/models/picksLeagues";
import { JoinLeagueForm } from "@/app/(main)/picks-leagues/join/join-league-form";
import { AUTH_URL } from "@/models/auth";
import { getActiveOrNextSportLeagueSeasonsDetails } from "@/services/sportLeagues";
import { getActiveAndNextDBSportLeagueSeasonDetailsWithActiveWeeks } from "@/db/sportLeagues";

const MAX_VISIBLE_PAGES = 5;
const PAGE_SIZE = 6;

function getPages(currentPage: number, totalPages: number): (number | "...")[] {
  const pages: (number | "...")[] = [];
  if (totalPages <= MAX_VISIBLE_PAGES) {
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
  } else {
    pages.push(1);
  }

  if (currentPage > 3) {
    pages.push("...");
  }

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (currentPage < totalPages - 2) {
    pages.push("...");
  }

  if (!pages.includes(totalPages)) {
    pages.push(totalPages);
  }

  return pages;
}

function getPageNumberUrl(
  searchParams: { [key: string]: string | string[] | undefined },
  pageNum: number,
): string {
  const activeParams = Object.fromEntries(
    Object.entries(searchParams)
      .filter(([_, value]) => Boolean(value))
      .map(([key, value]) => [key, String(value)]),
  );
  activeParams["page"] = `${pageNum}`;
  const queryParams = new URLSearchParams(activeParams).toString();

  return `/picks-leagues/join?${queryParams}`;
}

export default async function JoinLeagues(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const session = await auth();
  if (!session?.user?.id) {
    return redirect(AUTH_URL);
  }

  if (!searchParams["page"]) {
    searchParams["page"] = "1";
  }

  let currentPage = 1;
  const parsePageNumber = z.coerce
    .number()
    .min(1)
    .safeParse(searchParams["page"]);
  if (parsePageNumber.success) {
    currentPage = parsePageNumber.data;
  }

  let sportLeagueId: string | undefined;
  if (searchParams["sportLeagueId"]) {
    const parseSportLeagueId = z
      .string()
      .uuid()
      .safeParse(searchParams["sportLeagueId"]);
    if (parseSportLeagueId.success) {
      sportLeagueId = parseSportLeagueId.data;
    }
  }

  let sportLeagueSeasonId: string | undefined;
  if (searchParams["sportLeagueSeasonId"]) {
    const parseSportLeagueSeasonId = z
      .string()
      .uuid()
      .safeParse(searchParams["sportLeagueSeasonId"]);
    if (parseSportLeagueSeasonId.success) {
      sportLeagueSeasonId = parseSportLeagueSeasonId.data;
    }
  }

  let pickType: PicksLeaguePickTypes | undefined;
  if (searchParams["pickType"]) {
    const parsePickType = z
      .enum([
        PicksLeaguePickTypes.AGAINST_THE_SPREAD,
        PicksLeaguePickTypes.STRAIGHT_UP,
      ])
      .safeParse(searchParams["pickType"]);
    if (parsePickType.success) {
      pickType = parsePickType.data;
    }
  }

  let startSportLeagueWeekId: string | undefined;
  if (searchParams["startSportLeagueWeekId"]) {
    const parseStartSportLeagueWeekId = z
      .string()
      .uuid()
      .safeParse(searchParams["startSportLeagueWeekId"]);
    if (parseStartSportLeagueWeekId.success) {
      startSportLeagueWeekId = parseStartSportLeagueWeekId.data;
    }
  }

  let endSportLeagueWeekId: string | undefined;
  if (searchParams["endSportLeagueWeekId"]) {
    const parseEndSportLeagueWeekId = z
      .string()
      .uuid()
      .safeParse(searchParams["endSportLeagueWeekId"]);
    if (parseEndSportLeagueWeekId.success) {
      endSportLeagueWeekId = parseEndSportLeagueWeekId.data;
    }
  }

  let picksPerWeek: number | undefined;
  if (searchParams["picksPerWeek"]) {
    const parsePicks = z.coerce
      .number()
      .min(PICKS_LEAGUE_MIN_PICKS_PER_WEEK)
      .max(PICKS_LEAGUE_MAX_PICKS_PER_WEEK)
      .safeParse(searchParams["picksPerWeek"]);
    if (parsePicks.success) {
      picksPerWeek = parsePicks.data;
    }
  }

  let size: number | undefined;
  if (searchParams["size"]) {
    const parseSize = z.coerce
      .number()
      .min(PICKS_LEAGUE_MIN_SIZE)
      .max(PICKS_LEAGUE_MAX_SIZE)
      .safeParse(searchParams["size"]);
    if (parseSize.success) {
      size = parseSize.data;
    }
  }

  const dbSportLeagues =
    await getActiveAndNextDBSportLeagueSeasonDetailsWithActiveWeeks();

  // If no season is selected, find the closest ending season for the selected sport
  if (sportLeagueId && !sportLeagueSeasonId) {
    const selectedLeague = dbSportLeagues.find(
      (league) => league.id === sportLeagueId,
    );
    if (selectedLeague) {
      const now = new Date();
      const activeSeason = selectedLeague.seasons
        .filter((season) => new Date(season.endTime) > now)
        .sort(
          (a, b) =>
            new Date(a.endTime).getTime() - new Date(b.endTime).getTime(),
        )[0];
      if (activeSeason) {
        sportLeagueSeasonId = activeSeason.id;
      }
    }
  }

  const { leagues, total } = await filterDBPicksLeagues(
    {
      sportLeagueId,
      sportLeagueSeasonId,
      pickType,
      picksPerWeek,
      startSportLeagueWeekId,
      endSportLeagueWeekId,
      size,
    },
    session.user.id,
    PAGE_SIZE,
    (currentPage - 1) * PAGE_SIZE,
  );

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pages = getPages(currentPage, totalPages);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Join Picks Leagues</CardTitle>
        </CardHeader>
        <FilterLeaguesForm sportLeagues={dbSportLeagues} />
      </Card>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {leagues.map((league) => (
          <JoinLeagueForm key={league.id} league={league} />
        ))}
      </div>

      {leagues.length > 0 && (
        <Pagination className="mt-8">
          <PaginationContent>
            {currentPage > 1 ? (
              <PaginationItem>
                <PaginationPrevious
                  href={getPageNumberUrl(searchParams, currentPage - 1)}
                />
              </PaginationItem>
            ) : (
              <></>
            )}

            {pages.map((page) => (
              <PaginationItem key={page}>
                {page === "..." ? (
                  <PaginationEllipsis />
                ) : (
                  <PaginationLink
                    isActive={page === currentPage}
                    href={getPageNumberUrl(searchParams, page)}
                  >
                    {page}
                  </PaginationLink>
                )}
              </PaginationItem>
            ))}

            {currentPage < totalPages ? (
              <PaginationItem>
                <PaginationNext
                  href={getPageNumberUrl(searchParams, currentPage + 1)}
                />
              </PaginationItem>
            ) : (
              <></>
            )}
          </PaginationContent>
        </Pagination>
      )}

      {leagues.length === 0 ? (
        <p className="w-full text-center">No leagues found</p>
      ) : (
        <></>
      )}
    </div>
  );
}
