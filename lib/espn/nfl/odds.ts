import { espnFetch } from "@/lib/espn/shared/client";

export interface EspnTeamOdds {
  spreadOdds?: number;
  moneyLine?: number;
  favorite?: boolean;
}

export interface EspnOddsItem {
  provider: {
    id: string;
    name: string;
  };
  homeTeamOdds: EspnTeamOdds;
  awayTeamOdds: EspnTeamOdds;
  overUnder?: number;
  spread?: number;
}

export interface EspnOddsResponse {
  items: EspnOddsItem[];
}

export interface FetchedOdds {
  providerId: string;
  providerName: string;
  homeSpread: number | null;
  awaySpread: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  overUnder: number | null;
}

export async function fetchOdds(oddsRef: string): Promise<FetchedOdds | null> {
  const response = await espnFetch<EspnOddsResponse>(oddsRef);
  const item = response.items?.[0];
  if (!item) return null;

  // ESPN's `spread` is the home-team spread (negative when home is favored).
  // Verified against the 2024 Week 1 KC-vs-BAL opener: ESPN returned `spread: -2.5`
  // with `details: "KC -2.5"` and home team KC flagged `favorite: true`.
  const homeSpread = item.spread ?? null;
  const awaySpread = homeSpread === null ? null : -homeSpread;

  return {
    providerId: item.provider.id,
    providerName: item.provider.name,
    homeSpread,
    awaySpread,
    homeMoneyline: item.homeTeamOdds?.moneyLine ?? null,
    awayMoneyline: item.awayTeamOdds?.moneyLine ?? null,
    overUnder: item.overUnder ?? null,
  };
}
