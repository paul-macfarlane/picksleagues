import { espnFetch, espnFetchRef, nflTeamsUrl } from "@/lib/espn/shared/client";
import type { EspnItemsResponse, EspnRef } from "@/lib/espn/shared/types";

export interface EspnLogo {
  href: string;
  width: number;
  height: number;
  rel: string[];
}

export interface EspnTeam {
  id: string;
  location: string;
  name: string;
  abbreviation: string;
  logos: EspnLogo[];
}

export interface FetchedTeam {
  espnId: string;
  name: string;
  location: string;
  abbreviation: string;
  logoUrl?: string;
  logoDarkUrl?: string;
}

function findLogo(
  logos: EspnLogo[],
  variant: "default" | "dark",
): string | undefined {
  const rel = variant === "dark" ? "dark" : "default";
  const logo = logos.find((l) => l.rel.includes(rel));
  return logo?.href;
}

export async function fetchTeams(seasonYear: number): Promise<FetchedTeam[]> {
  const response = await espnFetch<EspnItemsResponse<EspnRef>>(
    nflTeamsUrl(seasonYear),
  );

  const teams: FetchedTeam[] = [];
  for (const ref of response.items) {
    const team = await espnFetchRef<EspnTeam>(ref);
    teams.push({
      espnId: team.id,
      name: team.name,
      location: team.location,
      abbreviation: team.abbreviation,
      logoUrl: findLogo(team.logos, "default"),
      logoDarkUrl: findLogo(team.logos, "dark"),
    });
  }
  return teams;
}
