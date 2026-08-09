import { describe, expect, it, vi } from "vitest";
import { GAME_STATUS, WEEK_TYPE } from "@picksleagues/schemas";
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
  teamId?: string;
}) {
  return {
    homeAway: overrides.homeAway,
    score: overrides.score,
    team: {
      id: overrides.teamId ?? `${overrides.abbreviation}-id`,
      abbreviation: overrides.abbreviation,
      displayName: overrides.displayName,
      // Extra field ESPN sends but we don't consume — proves passthrough.
      logo: "https://example.com/logo.png",
    },
  };
}

/**
 * Week windows in this file follow the real ESPN shape, verified against the
 * live core API on 2026-08-05 for the 2025 season: an opening regular week
 * anchored to the season-opener Thursday, then contiguous Wednesday →
 * Wednesday windows (07:00Z under EDT, 08:00Z under EST) with no gap between
 * them, postseason rounds included. Dates below are those windows shifted onto
 * the season each case uses. They were previously Thursday-anchored and
 * plausible-looking rather than real, which hid the SIMP-16 odds gap.
 */
const REGULAR_INDEX_URL = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/2/weeks?limit=32`;
const POSTSEASON_INDEX_URL = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/3/weeks?limit=32`;

describe("EspnProvider.fetchNflSeasonStructure", () => {
  it("fetches both season types, tagging regular weeks and mapping label from `text`", async () => {
    const week1Ref = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/2/weeks/1`;
    const week2Ref = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/2/weeks/2`;

    const fetchImpl = stubFetch({
      [REGULAR_INDEX_URL]: jsonResponse({
        items: [{ $ref: week1Ref }, { $ref: week2Ref }],
        // Extra unconsumed field.
        count: 2,
      }),
      // No postseason weeks for this focused case.
      [POSTSEASON_INDEX_URL]: jsonResponse({ items: [] }),
      [week1Ref]: jsonResponse({
        number: 1,
        text: "Week 1",
        startDate: "2026-09-10T07:00Z",
        endDate: "2026-09-16T06:59Z",
      }),
      [week2Ref]: jsonResponse({
        number: 2,
        text: "Week 2",
        startDate: "2026-09-16T07:00Z",
        endDate: "2026-09-23T06:59Z",
      }),
    });

    const provider = makeProvider(fetchImpl);
    const structure = await provider.fetchNflSeasonStructure(2026);

    expect(structure.seasonYear).toBe(2026);
    expect(structure.weeks).toEqual([
      {
        weekType: WEEK_TYPE.REGULAR,
        weekNumber: 1,
        label: "Week 1",
        startsAt: new Date("2026-09-10T07:00Z"),
        endsAt: new Date("2026-09-16T06:59Z"),
      },
      {
        weekType: WEEK_TYPE.REGULAR,
        weekNumber: 2,
        label: "Week 2",
        startsAt: new Date("2026-09-16T07:00Z"),
        endsAt: new Date("2026-09-23T06:59Z"),
      },
    ]);
  });

  it("fetches postseason weeks, excludes the Pro Bowl, and renumbers ESPN's gapped scheme to the contiguous domain (Super Bowl 5 → 4)", async () => {
    const wildCardRef = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/3/weeks/1`;
    const divisionalRef = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/3/weeks/2`;
    const conferenceRef = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/3/weeks/3`;
    const proBowlRef = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/3/weeks/4`;
    const superBowlRef = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/3/weeks/5`;

    const fetchImpl = stubFetch({
      [REGULAR_INDEX_URL]: jsonResponse({ items: [] }),
      [POSTSEASON_INDEX_URL]: jsonResponse({
        items: [
          { $ref: wildCardRef },
          { $ref: divisionalRef },
          { $ref: conferenceRef },
          { $ref: proBowlRef },
          { $ref: superBowlRef },
        ],
      }),
      [wildCardRef]: jsonResponse({
        number: 1,
        text: "Wild Card",
        startDate: "2027-01-06T08:00Z",
        endDate: "2027-01-13T07:59Z",
      }),
      [divisionalRef]: jsonResponse({
        number: 2,
        text: "Divisional Round",
        startDate: "2027-01-13T08:00Z",
        endDate: "2027-01-20T07:59Z",
      }),
      [conferenceRef]: jsonResponse({
        number: 3,
        text: "Conference Championship",
        startDate: "2027-01-20T08:00Z",
        endDate: "2027-01-27T07:59Z",
      }),
      [proBowlRef]: jsonResponse({
        number: 4,
        text: "Pro Bowl",
        startDate: "2027-01-27T08:00Z",
        endDate: "2027-02-03T07:59Z",
      }),
      [superBowlRef]: jsonResponse({
        number: 5,
        text: "Super Bowl",
        startDate: "2027-02-03T08:00Z",
        endDate: "2027-02-10T07:59Z",
      }),
    });

    const provider = makeProvider(fetchImpl);
    const structure = await provider.fetchNflSeasonStructure(2026);

    // Pro Bowl gone; the four real rounds contiguous 1..4 with the Super Bowl's
    // label preserved but its ESPN number 5 translated to the domain 4.
    expect(structure.weeks).toEqual([
      {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 1,
        label: "Wild Card",
        startsAt: new Date("2027-01-06T08:00Z"),
        endsAt: new Date("2027-01-13T07:59Z"),
      },
      {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 2,
        label: "Divisional Round",
        startsAt: new Date("2027-01-13T08:00Z"),
        endsAt: new Date("2027-01-20T07:59Z"),
      },
      {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 3,
        label: "Conference Championship",
        startsAt: new Date("2027-01-20T08:00Z"),
        endsAt: new Date("2027-01-27T07:59Z"),
      },
      {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 4,
        label: "Super Bowl",
        startsAt: new Date("2027-02-03T08:00Z"),
        endsAt: new Date("2027-02-10T07:59Z"),
      },
    ]);
  });

  it("throws on an unexpected ESPN postseason number (not in the translation map)", async () => {
    const rogueRef = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/3/weeks/6`;
    const fetchImpl = stubFetch({
      [REGULAR_INDEX_URL]: jsonResponse({ items: [] }),
      [POSTSEASON_INDEX_URL]: jsonResponse({ items: [{ $ref: rogueRef }] }),
      [rogueRef]: jsonResponse({
        number: 6,
        text: "Some New Round",
        startDate: "2027-02-15T07:00Z",
        endDate: "2027-02-16T06:59Z",
      }),
    });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchNflSeasonStructure(2026)).rejects.toThrow(
      /unexpected ESPN postseason week number 6/,
    );
  });

  it("returns regular and postseason weeks together in one structure", async () => {
    const regRef = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/2/weeks/1`;
    const postRef = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2026/types/3/weeks/1`;

    const fetchImpl = stubFetch({
      [REGULAR_INDEX_URL]: jsonResponse({ items: [{ $ref: regRef }] }),
      [POSTSEASON_INDEX_URL]: jsonResponse({ items: [{ $ref: postRef }] }),
      [regRef]: jsonResponse({
        number: 1,
        text: "Week 1",
        startDate: "2026-09-10T07:00Z",
        endDate: "2026-09-16T06:59Z",
      }),
      [postRef]: jsonResponse({
        number: 1,
        text: "Wild Card",
        startDate: "2027-01-06T08:00Z",
        endDate: "2027-01-13T07:59Z",
      }),
    });

    const provider = makeProvider(fetchImpl);
    const structure = await provider.fetchNflSeasonStructure(2026);

    expect(structure.weeks.map((week) => [week.weekType, week.weekNumber, week.label])).toEqual([
      [WEEK_TYPE.REGULAR, 1, "Week 1"],
      [WEEK_TYPE.POSTSEASON, 1, "Wild Card"],
    ]);
  });

  it("throws naming the endpoint and status on a non-OK response", async () => {
    const fetchImpl = stubFetch({
      [REGULAR_INDEX_URL]: jsonResponse({ error: "nope" }, { status: 500 }),
      [POSTSEASON_INDEX_URL]: jsonResponse({ items: [] }),
    });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchNflSeasonStructure(2026)).rejects.toThrow(
      new RegExp(`${REGULAR_INDEX_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*500`),
    );
  });

  it("maps a 404 on one season type's weeks index to no weeks for that type, not a throw", async () => {
    const wildCardRef = `${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2027/types/3/weeks/1`;
    const fetchImpl = stubFetch({
      // ESPN hasn't published the regular-season schedule for this future
      // year yet (ADR-0009 "upcoming seasons exist before their data").
      [`${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2027/types/2/weeks?limit=32`]:
        jsonResponse({}, { status: 404 }),
      [`${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2027/types/3/weeks?limit=32`]:
        jsonResponse({ items: [{ $ref: wildCardRef }] }),
      [wildCardRef]: jsonResponse({
        number: 1,
        text: "Wild Card",
        startDate: "2028-01-05T08:00Z",
        endDate: "2028-01-12T07:59Z",
      }),
    });

    const provider = makeProvider(fetchImpl);
    const structure = await provider.fetchNflSeasonStructure(2027);

    expect(structure).toEqual({
      seasonYear: 2027,
      weeks: [
        {
          weekType: WEEK_TYPE.POSTSEASON,
          weekNumber: 1,
          label: "Wild Card",
          startsAt: new Date("2028-01-05T08:00Z"),
          endsAt: new Date("2028-01-12T07:59Z"),
        },
      ],
    });
  });

  it("maps a 404 on both season types' weeks indexes to a typed 'nothing yet' with empty weeks", async () => {
    const fetchImpl = stubFetch({
      [`${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2027/types/2/weeks?limit=32`]:
        jsonResponse({}, { status: 404 }),
      [`${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2027/types/3/weeks?limit=32`]:
        jsonResponse({}, { status: 404 }),
    });

    const provider = makeProvider(fetchImpl);
    const structure = await provider.fetchNflSeasonStructure(2027);

    expect(structure).toEqual({ seasonYear: 2027, weeks: [] });
  });

  it("maps zero-items indexes on both season types the same as a 404 — empty weeks, not a throw", async () => {
    const fetchImpl = stubFetch({
      [`${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2027/types/2/weeks?limit=32`]:
        jsonResponse({ items: [] }),
      [`${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2027/types/3/weeks?limit=32`]:
        jsonResponse({ items: [] }),
    });

    const provider = makeProvider(fetchImpl);
    const structure = await provider.fetchNflSeasonStructure(2027);

    expect(structure).toEqual({ seasonYear: 2027, weeks: [] });
  });

  it("still throws on a genuine 5xx even though 404 is now special-cased", async () => {
    const fetchImpl = stubFetch({
      [`${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2027/types/2/weeks?limit=32`]:
        jsonResponse({ error: "boom" }, { status: 503 }),
      [`${CORE_API_BASE_URL}/football/leagues/nfl/seasons/2027/types/3/weeks?limit=32`]:
        jsonResponse({ items: [] }),
    });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchNflSeasonStructure(2027)).rejects.toThrow(/503/);
  });

  it("throws a zod error when the weeks index payload shape is invalid", async () => {
    const fetchImpl = stubFetch({
      [REGULAR_INDEX_URL]: jsonResponse({ items: [{ notARef: "oops" }] }),
      [POSTSEASON_INDEX_URL]: jsonResponse({ items: [] }),
    });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchNflSeasonStructure(2026)).rejects.toThrow();
  });
});

describe("EspnProvider.fetchNflWeekGames", () => {
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
                  competitor({
                    homeAway: "home",
                    abbreviation: "PHI",
                    displayName: "Philadelphia Eagles",
                    score: "0",
                  }),
                  competitor({
                    homeAway: "away",
                    abbreviation: "DAL",
                    displayName: "Dallas Cowboys",
                    score: "0",
                  }),
                ],
                odds: [{ spread: -3.5, provider: { name: "ESPN BET" } }],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const games = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);

    expect(games).toEqual([
      {
        providerGameId: "401",
        weekType: WEEK_TYPE.REGULAR,
        weekNumber: 1,
        homeTeamAbbr: "PHI",
        homeTeamName: "Philadelphia Eagles",
        homeTeamProviderId: "PHI-id",
        awayTeamAbbr: "DAL",
        awayTeamName: "Dallas Cowboys",
        awayTeamProviderId: "DAL-id",
        kickoffAt: new Date("2026-09-14T17:00Z"),
        status: GAME_STATUS.SCHEDULED,
        homeScore: null,
        awayScore: null,
        period: null,
        clockSeconds: null,
        spread: -3.5,
        spreadSource: "ESPN BET",
      },
    ]);
  });

  it("captures the book from odds[0].provider.name, and null when odds carry no provider", async () => {
    const noProviderUrl = `${SITE_API_BASE_URL}/football/nfl/scoreboard?seasontype=2&week=2&dates=2026`;
    const fetchImpl = stubFetch({
      [noProviderUrl]: jsonResponse({
        events: [
          {
            id: "411",
            competitions: [
              {
                id: "411",
                date: "2026-09-14T17:00Z",
                status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
                competitors: [
                  competitor({ homeAway: "home", abbreviation: "PHI", displayName: "Eagles" }),
                  competitor({ homeAway: "away", abbreviation: "DAL", displayName: "Cowboys" }),
                ],
                // A spread with no attributed book — ESPN sometimes omits it.
                odds: [{ spread: -3.5 }],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 2);

    expect(game).toMatchObject({ spread: -3.5, spreadSource: null });
  });

  it("returns a null spreadSource alongside a null spread when odds are missing entirely", async () => {
    const [game] = await (async () => {
      const url = `${SITE_API_BASE_URL}/football/nfl/scoreboard?seasontype=2&week=3&dates=2026`;
      const fetchImpl = stubFetch({
        [url]: jsonResponse({
          events: [
            {
              id: "412",
              competitions: [
                {
                  id: "412",
                  date: "2026-09-14T17:00Z",
                  status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
                  competitors: [
                    competitor({ homeAway: "home", abbreviation: "PHI", displayName: "Eagles" }),
                    competitor({ homeAway: "away", abbreviation: "DAL", displayName: "Cowboys" }),
                  ],
                },
              ],
            },
          ],
        }),
      });
      return makeProvider(fetchImpl).fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 3);
    })();

    expect(game).toMatchObject({ spread: null, spreadSource: null });
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
                  competitor({
                    homeAway: "home",
                    abbreviation: "BUF",
                    displayName: "Buffalo Bills",
                    score: "14",
                  }),
                  competitor({
                    homeAway: "away",
                    abbreviation: "NYJ",
                    displayName: "New York Jets",
                    score: "7",
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);

    expect(game).toMatchObject({
      status: GAME_STATUS.IN_PROGRESS,
      homeScore: 14,
      awayScore: 7,
      spread: null,
    });
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
                  competitor({
                    homeAway: "home",
                    abbreviation: "KC",
                    displayName: "Kansas City Chiefs",
                    score: "24",
                  }),
                  competitor({
                    homeAway: "away",
                    abbreviation: "DEN",
                    displayName: "Denver Broncos",
                    score: "20",
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);

    expect(game).toMatchObject({ status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 20 });
  });

  it("throws when a started game's score is present but unparseable", async () => {
    const fetchImpl = stubFetch({
      [scoreboardUrl]: jsonResponse({
        events: [
          {
            id: "409",
            competitions: [
              {
                id: "409",
                date: "2026-09-14T17:00Z",
                status: { type: { name: "STATUS_IN_PROGRESS", state: "in" } },
                competitors: [
                  competitor({
                    homeAway: "home",
                    abbreviation: "BUF",
                    displayName: "Buffalo Bills",
                    score: "abc",
                  }),
                  competitor({
                    homeAway: "away",
                    abbreviation: "NYJ",
                    displayName: "New York Jets",
                    score: "7",
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1)).rejects.toThrow(
      /invalid score "abc"/,
    );
  });

  /**
   * Live in-game state (DATA-8). ESPN carries `period`/`clock` as siblings of
   * `status.type`, alongside a preformatted `displayClock` this adapter must
   * never read — every case below ships that string to prove it doesn't.
   */
  describe("live period and clock", () => {
    function liveScoreboard(status: Record<string, unknown>) {
      return stubFetch({
        [scoreboardUrl]: jsonResponse({
          events: [
            {
              id: "410",
              competitions: [
                {
                  id: "410",
                  date: "2026-09-14T17:00Z",
                  status,
                  competitors: [
                    competitor({ homeAway: "home", abbreviation: "BUF", displayName: "Bills" }),
                    competitor({ homeAway: "away", abbreviation: "NYJ", displayName: "Jets" }),
                  ],
                },
              ],
            },
          ],
        }),
      });
    }

    const IN_PROGRESS = { name: "STATUS_IN_PROGRESS", state: "in" };

    it.each([
      {
        name: "an in-progress game carries its period and seconds remaining",
        status: { type: IN_PROGRESS, period: 3, clock: 421, displayClock: "7:01" },
        expected: { period: 3, clockSeconds: 421 },
      },
      {
        name: "a fractional clock rounds to whole seconds",
        status: { type: IN_PROGRESS, period: 2, clock: 60.6, displayClock: "1:00" },
        expected: { period: 2, clockSeconds: 61 },
      },
      {
        name: "overtime periods pass through — nothing caps at 4",
        status: { type: IN_PROGRESS, period: 5, clock: 0, displayClock: "0:00" },
        expected: { period: 5, clockSeconds: 0 },
      },
      {
        name: "an in-progress game whose status carries neither key",
        status: { type: IN_PROGRESS },
        expected: { period: null, clockSeconds: null },
      },
      {
        name: "ESPN's pre-game period 0 is not a period",
        status: { type: IN_PROGRESS, period: 0, clock: 900, displayClock: "15:00" },
        expected: { period: null, clockSeconds: 900 },
      },
      {
        name: "a scheduled game has no live state, even when ESPN sends one",
        status: {
          type: { name: "STATUS_SCHEDULED", state: "pre" },
          period: 0,
          clock: 900,
          displayClock: "15:00",
        },
        expected: { period: null, clockSeconds: null },
      },
      {
        name: "a scheduled game whose status carries neither key",
        status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
        expected: { period: null, clockSeconds: null },
      },
      {
        // A finished game's frozen 0:00 is not live state: the app would render
        // it as a running clock beside "Final".
        name: "a final game reports no live state",
        status: {
          type: { name: "STATUS_FINAL", state: "post" },
          period: 4,
          clock: 0,
          displayClock: "0:00",
        },
        expected: { period: null, clockSeconds: null },
      },
    ])("$name", async ({ status, expected }) => {
      const provider = makeProvider(liveScoreboard(status));

      const [game] = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);

      expect(game).toMatchObject(expected);
    });
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
                  competitor({
                    homeAway: "home",
                    abbreviation: "MIA",
                    displayName: "Miami Dolphins",
                  }),
                  competitor({
                    homeAway: "away",
                    abbreviation: "NE",
                    displayName: "New England Patriots",
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);

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
                  competitor({
                    homeAway: "home",
                    abbreviation: "SF",
                    displayName: "San Francisco 49ers",
                  }),
                  competitor({
                    homeAway: "away",
                    abbreviation: "SEA",
                    displayName: "Seattle Seahawks",
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);

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
                  competitor({
                    homeAway: "home",
                    abbreviation: "GB",
                    displayName: "Green Bay Packers",
                  }),
                  competitor({
                    homeAway: "away",
                    abbreviation: "CHI",
                    displayName: "Chicago Bears",
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);

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
                  competitor({
                    homeAway: "home",
                    abbreviation: "LAR",
                    displayName: "Los Angeles Rams",
                  }),
                  competitor({
                    homeAway: "away",
                    abbreviation: "ARI",
                    displayName: "Arizona Cardinals",
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);

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
                competitors: [
                  competitor({
                    homeAway: "away",
                    abbreviation: "ARI",
                    displayName: "Arizona Cardinals",
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1)).rejects.toThrow(
      /missing a home or away competitor/,
    );
  });

  it("throws naming the endpoint and status on a non-OK response", async () => {
    const fetchImpl = stubFetch({ [scoreboardUrl]: jsonResponse({}, { status: 503 }) });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1)).rejects.toThrow(/503/);
  });

  it("throws a zod error when the scoreboard payload shape is invalid", async () => {
    const fetchImpl = stubFetch({ [scoreboardUrl]: jsonResponse({ notEvents: [] }) });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1)).rejects.toThrow();
  });

  it("hits the seasontype=3 scoreboard for a postseason week and tags the game", async () => {
    const postseasonScoreboardUrl = `${SITE_API_BASE_URL}/football/nfl/scoreboard?seasontype=3&week=1&dates=2026`;
    const fetchImpl = stubFetch({
      [postseasonScoreboardUrl]: jsonResponse({
        events: [
          {
            id: "500",
            competitions: [
              {
                id: "500",
                date: "2027-01-10T18:00Z",
                status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
                competitors: [
                  competitor({
                    homeAway: "home",
                    abbreviation: "KC",
                    displayName: "Kansas City Chiefs",
                  }),
                  competitor({
                    homeAway: "away",
                    abbreviation: "HOU",
                    displayName: "Houston Texans",
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchNflWeekGames(2026, WEEK_TYPE.POSTSEASON, 1);

    expect(game).toMatchObject({
      providerGameId: "500",
      weekType: WEEK_TYPE.POSTSEASON,
      weekNumber: 1,
    });
  });

  it("translates the domain Super Bowl (postseason 4) to ESPN's week=5 for the scoreboard query, tagging the game with the domain number", async () => {
    // Domain 4 must hit ESPN's gapped week=5 (its 4 is the Pro Bowl) — assert
    // the URL so the translation can't silently regress.
    const superBowlScoreboardUrl = `${SITE_API_BASE_URL}/football/nfl/scoreboard?seasontype=3&week=5&dates=2026`;
    const fetchImpl = stubFetch({
      [superBowlScoreboardUrl]: jsonResponse({
        events: [
          {
            id: "600",
            competitions: [
              {
                id: "600",
                date: "2027-02-08T23:30Z",
                status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
                competitors: [
                  competitor({
                    homeAway: "home",
                    abbreviation: "KC",
                    displayName: "Kansas City Chiefs",
                  }),
                  competitor({
                    homeAway: "away",
                    abbreviation: "SF",
                    displayName: "San Francisco 49ers",
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const provider = makeProvider(fetchImpl);
    const [game] = await provider.fetchNflWeekGames(2026, WEEK_TYPE.POSTSEASON, 4);

    // Game carries the domain number, not ESPN's 5.
    expect(game).toMatchObject({
      providerGameId: "600",
      weekType: WEEK_TYPE.POSTSEASON,
      weekNumber: 4,
    });
  });

  it("throws on a domain postseason number outside the translation map", async () => {
    const provider = makeProvider(stubFetch({}));

    await expect(provider.fetchNflWeekGames(2026, WEEK_TYPE.POSTSEASON, 9)).rejects.toThrow(
      /unexpected domain postseason week number 9/,
    );
  });

  describe("unseeded playoff rounds (ADR-0021)", () => {
    const divisionalUrl = `${SITE_API_BASE_URL}/football/nfl/scoreboard?seasontype=3&week=2&dates=2026`;

    /**
     * The real shape of an unseeded round: ESPN reuses one placeholder pair
     * across every game in it, so the two competitors below carry the same
     * provider ids in each event — verified 2026-08-06 against the ticket's
     * live observation.
     */
    function placeholderCompetitors(): unknown[] {
      return [
        competitor({
          homeAway: "home",
          abbreviation: "TBD",
          displayName: "TBD",
          teamId: "-1",
        }),
        competitor({
          homeAway: "away",
          abbreviation: "TBD",
          displayName: "TBD",
          teamId: "-2",
        }),
      ];
    }

    function scoreboardOf(competitions: { id: string; competitors: unknown[] }[]): Response {
      return jsonResponse({
        events: competitions.map(({ id, competitors }) => ({
          id,
          competitions: [
            {
              id,
              date: "2027-01-17T18:00Z",
              status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
              competitors,
            },
          ],
        })),
      });
    }

    const seededHome = competitor({
      homeAway: "home",
      abbreviation: "KC",
      displayName: "Kansas City Chiefs",
      teamId: "12",
    });
    const seededAway = competitor({
      homeAway: "away",
      abbreviation: "BUF",
      displayName: "Buffalo Bills",
      teamId: "2",
    });

    it.each([
      { name: "both competitors are placeholders", competitors: placeholderCompetitors() },
      {
        name: "only the home competitor is a placeholder",
        competitors: [placeholderCompetitors()[0], seededAway],
      },
      {
        name: "only the away competitor is a placeholder",
        competitors: [seededHome, placeholderCompetitors()[1]],
      },
      {
        name: "a negative provider id carries a non-TBD abbreviation",
        competitors: [
          competitor({
            homeAway: "home",
            abbreviation: "AFC",
            displayName: "AFC Champion",
            teamId: "-1",
          }),
          seededAway,
        ],
      },
      {
        name: "a TBD abbreviation carries a positive provider id",
        competitors: [
          competitor({ homeAway: "home", abbreviation: "TBD", displayName: "TBD", teamId: "99" }),
          seededAway,
        ],
      },
      {
        name: "a TBD abbreviation arrives lowercased",
        competitors: [
          competitor({ homeAway: "home", abbreviation: "tbd", displayName: "TBD", teamId: "99" }),
          seededAway,
        ],
      },
    ])("excludes a competition where $name", async ({ competitors }) => {
      const fetchImpl = stubFetch({
        [divisionalUrl]: scoreboardOf([{ id: "700", competitors }]),
      });

      const provider = makeProvider(fetchImpl);

      await expect(provider.fetchNflWeekGames(2026, WEEK_TYPE.POSTSEASON, 2)).resolves.toEqual([]);
    });

    it("returns only the seeded games of a round that is partly seeded", async () => {
      const fetchImpl = stubFetch({
        [divisionalUrl]: scoreboardOf([
          { id: "701", competitors: [seededHome, seededAway] },
          { id: "702", competitors: placeholderCompetitors() },
          { id: "703", competitors: placeholderCompetitors() },
        ]),
      });

      const provider = makeProvider(fetchImpl);
      const games = await provider.fetchNflWeekGames(2026, WEEK_TYPE.POSTSEASON, 2);

      expect(games.map((game) => game.providerGameId)).toEqual(["701"]);
    });

    it("passes a fully seeded round through unchanged", async () => {
      const fetchImpl = stubFetch({
        [divisionalUrl]: scoreboardOf([{ id: "704", competitors: [seededHome, seededAway] }]),
      });

      const provider = makeProvider(fetchImpl);
      const games = await provider.fetchNflWeekGames(2026, WEEK_TYPE.POSTSEASON, 2);

      expect(games).toMatchObject([
        {
          providerGameId: "704",
          weekType: WEEK_TYPE.POSTSEASON,
          weekNumber: 2,
          homeTeamAbbr: "KC",
          homeTeamProviderId: "12",
          awayTeamAbbr: "BUF",
          awayTeamProviderId: "2",
        },
      ]);
    });
  });
});

describe("EspnProvider.fetchNflTeams", () => {
  const teamsUrl = `${SITE_API_BASE_URL}/football/nfl/teams?limit=40`;

  // Trimmed, quote-accurate fixture from the real endpoint (verified
  // 2026-07-23): https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40
  // — the nested sports[0].leagues[0].teams[] shape, one team's `logos[]`
  // including both a "default"/"dark" pair and their scoreboard-specific
  // siblings (which must NOT be picked).
  const ARIZONA_TEAM = {
    team: {
      abbreviation: "ARI",
      alternateColor: "ffffff",
      color: "a40227",
      displayName: "Arizona Cardinals",
      id: "22",
      isActive: true,
      location: "Arizona",
      logos: [
        {
          alt: "",
          height: 500,
          href: "https://a.espncdn.com/i/teamlogos/nfl/500/ari.png",
          rel: ["full", "default"],
          width: 500,
        },
        {
          alt: "",
          height: 500,
          href: "https://a.espncdn.com/i/teamlogos/nfl/500-dark/ari.png",
          rel: ["full", "dark"],
          width: 500,
        },
        {
          alt: "",
          height: 500,
          href: "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ari.png",
          rel: ["full", "scoreboard"],
          width: 500,
        },
        {
          alt: "",
          height: 500,
          href: "https://a.espncdn.com/i/teamlogos/nfl/500-dark/scoreboard/ari.png",
          rel: ["full", "scoreboard", "dark"],
          width: 500,
        },
      ],
    },
  };

  function teamsListing(teams: unknown[]): unknown {
    return {
      sports: [
        {
          id: "20",
          leagues: [
            {
              abbreviation: "NFL",
              id: "28",
              teams,
            },
          ],
        },
      ],
    };
  }

  it("maps location and the non-scoreboard default/dark logos from the real ESPN shape", async () => {
    const fetchImpl = stubFetch({ [teamsUrl]: jsonResponse(teamsListing([ARIZONA_TEAM])) });

    const provider = makeProvider(fetchImpl);
    const [team] = await provider.fetchNflTeams();

    expect(team).toEqual({
      providerTeamId: "22",
      abbreviation: "ARI",
      name: "Arizona Cardinals",
      location: "Arizona",
      logoLightUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/ari.png",
      logoDarkUrl: "https://a.espncdn.com/i/teamlogos/nfl/500-dark/ari.png",
    });
  });

  it("maps null logos when a team's listing has no logos array", async () => {
    const noLogosTeam = {
      team: {
        id: "1",
        abbreviation: "ATL",
        displayName: "Atlanta Falcons",
        location: "Atlanta",
      },
    };
    const fetchImpl = stubFetch({ [teamsUrl]: jsonResponse(teamsListing([noLogosTeam])) });

    const provider = makeProvider(fetchImpl);
    const [team] = await provider.fetchNflTeams();

    expect(team).toMatchObject({ logoLightUrl: null, logoDarkUrl: null });
  });

  it("maps null for a rel that's only present as the scoreboard-specific variant", async () => {
    const scoreboardOnlyTeam = {
      team: {
        id: "2",
        abbreviation: "BUF",
        displayName: "Buffalo Bills",
        location: "Buffalo",
        logos: [
          {
            href: "https://example.com/scoreboard-default.png",
            rel: ["full", "scoreboard", "default"],
          },
        ],
      },
    };
    const fetchImpl = stubFetch({ [teamsUrl]: jsonResponse(teamsListing([scoreboardOnlyTeam])) });

    const provider = makeProvider(fetchImpl);
    const [team] = await provider.fetchNflTeams();

    expect(team).toMatchObject({ logoLightUrl: null, logoDarkUrl: null });
  });

  it("throws a zod error when the teams listing payload shape is invalid", async () => {
    const fetchImpl = stubFetch({ [teamsUrl]: jsonResponse({ sports: [] }) });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchNflTeams()).rejects.toThrow();
  });

  it("throws naming the endpoint and status on a non-OK response", async () => {
    const fetchImpl = stubFetch({ [teamsUrl]: jsonResponse({}, { status: 503 }) });

    const provider = makeProvider(fetchImpl);

    await expect(provider.fetchNflTeams()).rejects.toThrow(/503/);
  });
});
