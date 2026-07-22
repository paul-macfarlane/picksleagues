import { describe, expect, it, vi } from "vitest";
import { GAME_STATUS } from "@picksleagues/schemas";
import { EspnProvider } from "./espn-provider";

const SITE_API_BASE_URL = "https://site.example.com/sports";
const CORE_API_BASE_URL = "https://core.example.com/sports";

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

/** Routes a stubbed fetchImpl by exact URL match; throws on unexpected requests to catch drift. */
function stubFetch(responses: Record<string, Response>): typeof fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input.toString();
    const response = responses[url];
    if (!response) {
      throw new Error(`stubFetch: unexpected request to ${url}`);
    }
    return response;
  }) as unknown as typeof fetch;
}

function makeProvider(fetchImpl: typeof fetch): EspnProvider {
  return new EspnProvider({
    fetchImpl,
    siteApiBaseUrl: SITE_API_BASE_URL,
    coreApiBaseUrl: CORE_API_BASE_URL,
  });
}

function competitor(overrides: {
  homeAway: "home" | "away";
  abbreviation: string;
  displayName: string;
  score?: string;
}) {
  return {
    homeAway: overrides.homeAway,
    score: overrides.score,
    team: {
      abbreviation: overrides.abbreviation,
      displayName: overrides.displayName,
      // Extra field ESPN sends but we don't consume — proves passthrough.
      logo: "https://example.com/logo.png",
    },
  };
}

describe("EspnProvider.fetchSeasonStructure", () => {
  it("fetches the weeks index then each week's detail, mapping to ProviderWeek", async () => {
    const indexUrl = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/2/weeks?limit=32`;
    const week1Ref = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/2/weeks/1`;
    const week2Ref = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/2/weeks/2`;

    const fetchImpl = stubFetch({
      [indexUrl]: jsonResponse({
        items: [{ $ref: week1Ref }, { $ref: week2Ref }],
        // Extra unconsumed field.
        count: 2,
      }),
      [week1Ref]: jsonResponse({
        number: 1,
        startDate: "2026-09-10T07:00Z",
        endDate: "2026-09-17T06:59Z",
        // Extra unconsumed field.
        text: "Week 1",
      }),
      [week2Ref]: jsonResponse({
        number: 2,
        startDate: "2026-09-17T07:00Z",
        endDate: "2026-09-24T06:59Z",
      }),
    });

    const provider = makeProvider(fetchImpl);
    const structure = await provider.fetchSeasonStructure(2026);

    expect(structure.seasonYear).toBe(2026);
    expect(structure.weeks).toEqual([
      { weekNumber: 1, startsAt: new Date("2026-09-10T07:00Z"), endsAt: new Date("2026-09-17T06:59Z") },
      { weekNumber: 2, startsAt: new Date("2026-09-17T07:00Z"), endsAt: new Date("2026-09-24T06:59Z") },
    ]);
  });

  it("throws naming the endpoint and status on a non-OK response", async () => {
    const indexUrl = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/2/weeks?limit=32`;
    const fetchImpl = stubFetch({ [indexUrl]: jsonResponse({ error: "nope" }, { status: 500 }) });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchSeasonStructure(2026)).rejects.toThrow(
      new RegExp(`${indexUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*500`),
    );
  });

  it("throws a zod error when the weeks index payload shape is invalid", async () => {
    const indexUrl = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/2/weeks?limit=32`;
    const fetchImpl = stubFetch({ [indexUrl]: jsonResponse({ items: [{ notARef: "oops" }] }) });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchSeasonStructure(2026)).rejects.toThrow();
  });
});

describe("EspnProvider.fetchWeekGames", () => {
  const scoreboardUrl = `${SITE_API_BASE_URL}/football/nfl/scoreboard?seasontype=2&week=1&dates=2026`;

  it("maps a scheduled game with odds: spread captured, scores null", async () => {
    const fetchImpl = stubFetch({
      [scoreboardUrl]: jsonResponse({
        events: [
          {
            id: "401",
            // Extra unconsumed field.
            name: "Cowboys at Eagles",
            competitions: [
              {
                id: "401",
                date: "2026-09-14T17:00Z",
                status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
                competitors: [
                  competitor({ homeAway: "home", abbreviation: "PHI", displayName: "Philadelphia Eagles", score: "0" }),
                  competitor({ homeAway: "away", abbreviation: "DAL", displayName: "Dallas Cowboys", score: "0" }),
                ],
                odds: [{ spread: -3.5, provider: { name: "ESPN BET" } }],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const games = await provider.fetchWeekGames(2026, 1);

    expect(games).toEqual([
      {
        providerGameId: "401",
        weekNumber: 1,
        homeTeamAbbr: "PHI",
        homeTeamName: "Philadelphia Eagles",
        awayTeamAbbr: "DAL",
        awayTeamName: "Dallas Cowboys",
        kickoffAt: new Date("2026-09-14T17:00Z"),
        status: GAME_STATUS.SCHEDULED,
        homeScore: null,
        awayScore: null,
        spread: -3.5,
      },
    ]);
  });

  it("parses scores for an in-progress game", async () => {
    const fetchImpl = stubFetch({
      [scoreboardUrl]: jsonResponse({
        events: [
          {
            id: "402",
            competitions: [
              {
                id: "402",
                date: "2026-09-14T17:00Z",
                status: { type: { name: "STATUS_IN_PROGRESS", state: "in" } },
                competitors: [
                  competitor({ homeAway: "home", abbreviation: "BUF", displayName: "Buffalo Bills", score: "14" }),
                  competitor({ homeAway: "away", abbreviation: "NYJ", displayName: "New York Jets", score: "7" }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchWeekGames(2026, 1);

    expect(game).toMatchObject({ status: GAME_STATUS.IN_PROGRESS, homeScore: 14, awayScore: 7, spread: null });
  });

  it("parses scores for a final game", async () => {
    const fetchImpl = stubFetch({
      [scoreboardUrl]: jsonResponse({
        events: [
          {
            id: "403",
            competitions: [
              {
                id: "403",
                date: "2026-09-14T17:00Z",
                status: { type: { name: "STATUS_FINAL", state: "post" } },
                competitors: [
                  competitor({ homeAway: "home", abbreviation: "KC", displayName: "Kansas City Chiefs", score: "24" }),
                  competitor({ homeAway: "away", abbreviation: "DEN", displayName: "Denver Broncos", score: "20" }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchWeekGames(2026, 1);

    expect(game).toMatchObject({ status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 20 });
  });

  it("maps STATUS_POSTPONED to postponed regardless of state", async () => {
    const fetchImpl = stubFetch({
      [scoreboardUrl]: jsonResponse({
        events: [
          {
            id: "404",
            competitions: [
              {
                id: "404",
                date: "2026-09-14T17:00Z",
                status: { type: { name: "STATUS_POSTPONED", state: "pre" } },
                competitors: [
                  competitor({ homeAway: "home", abbreviation: "MIA", displayName: "Miami Dolphins" }),
                  competitor({ homeAway: "away", abbreviation: "NE", displayName: "New England Patriots" }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchWeekGames(2026, 1);

    expect(game?.status).toBe(GAME_STATUS.POSTPONED);
  });

  it.each(["STATUS_CANCELED", "STATUS_CANCELLED"])("maps %s to cancelled", async (statusName) => {
    const fetchImpl = stubFetch({
      [scoreboardUrl]: jsonResponse({
        events: [
          {
            id: "405",
            competitions: [
              {
                id: "405",
                date: "2026-09-14T17:00Z",
                status: { type: { name: statusName, state: "post" } },
                competitors: [
                  competitor({ homeAway: "home", abbreviation: "SF", displayName: "San Francisco 49ers" }),
                  competitor({ homeAway: "away", abbreviation: "SEA", displayName: "Seattle Seahawks" }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchWeekGames(2026, 1);

    expect(game?.status).toBe(GAME_STATUS.CANCELLED);
  });

  it("falls back to scheduled for an unrecognized status name and state", async () => {
    const fetchImpl = stubFetch({
      [scoreboardUrl]: jsonResponse({
        events: [
          {
            id: "406",
            competitions: [
              {
                id: "406",
                date: "2026-09-14T17:00Z",
                status: { type: { name: "STATUS_SOME_FUTURE_ESPN_VALUE", state: "weird" } },
                competitors: [
                  competitor({ homeAway: "home", abbreviation: "GB", displayName: "Green Bay Packers" }),
                  competitor({ homeAway: "away", abbreviation: "CHI", displayName: "Chicago Bears" }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchWeekGames(2026, 1);

    expect(game?.status).toBe(GAME_STATUS.SCHEDULED);
  });

  it("returns a null spread when odds are missing", async () => {
    const fetchImpl = stubFetch({
      [scoreboardUrl]: jsonResponse({
        events: [
          {
            id: "407",
            competitions: [
              {
                id: "407",
                date: "2026-09-14T17:00Z",
                status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
                competitors: [
                  competitor({ homeAway: "home", abbreviation: "LAR", displayName: "Los Angeles Rams" }),
                  competitor({ homeAway: "away", abbreviation: "ARI", displayName: "Arizona Cardinals" }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchWeekGames(2026, 1);

    expect(game?.spread).toBeNull();
  });

  it("throws when a competition is missing the home competitor", async () => {
    const fetchImpl = stubFetch({
      [scoreboardUrl]: jsonResponse({
        events: [
          {
            id: "408",
            competitions: [
              {
                id: "408",
                date: "2026-09-14T17:00Z",
                status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
                competitors: [competitor({ homeAway: "away", abbreviation: "ARI", displayName: "Arizona Cardinals" })],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchWeekGames(2026, 1)).rejects.toThrow(/missing a home or away competitor/);
  });

  it("throws naming the endpoint and status on a non-OK response", async () => {
    const fetchImpl = stubFetch({ [scoreboardUrl]: jsonResponse({}, { status: 503 }) });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchWeekGames(2026, 1)).rejects.toThrow(/503/);
  });

  it("throws a zod error when the scoreboard payload shape is invalid", async () => {
    const fetchImpl = stubFetch({ [scoreboardUrl]: jsonResponse({ notEvents: [] }) });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchWeekGames(2026, 1)).rejects.toThrow();
  });
});
