import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signInAs, uniqueUsername, cleanup } from "./setup/session";
import { json, loadScenario, resetSim, setSimClock } from "./setup/sim";
import { latestInviteCode } from "./setup/league-seed";
import { gameRow, selectPick, submitControl, submitSheet } from "./setup/pickem";
import { ATS_MATCHUPS, seedAtsSeason } from "./setup/ats-season";
import { SIM_GAME_DURATION_MS } from "../packages/core/src/sim-provider";
import {
  APP_ROLE,
  PICK_OUTCOME,
  type LeagueWeeksResponse,
  type LeagueWeek,
  type WeekSlateResponse,
  type PickemWeekPicksResponse,
  type PickemStandingsResponse,
  type SimFixtureGamesResponse,
  type SimStateResponse,
} from "../packages/schemas/src/index";

/**
 * The ATS weekly spine absent from the SU journey: five picks through a stale
 * line refusal, accepted-line grading, and two distinct weekly totals summing
 * on the season board. Syncs settle before any sweep can repair their output.
 * Three members distinguish a missed week from a submitted losing week.
 */
test.describe.serial("ATS five-pick weekly journey", () => {
  let admin: BrowserContext;
  const contexts: BrowserContext[] = [];
  const users: { id: string; name: string }[] = [];
  const pages: Page[] = [];
  let adminId: string;
  let leagueId: string;
  let weeks: LeagueWeek[];
  let fixtures: SimFixtureGamesResponse["games"];

  const picksUrl = (week: LeagueWeek) => `/api/leagues/${leagueId}/pickem/weeks/${week.id}/picks`;
  const sheetUrl = (week: LeagueWeek) => `/leagues/${leagueId}/my-picks?weekId=${week.id}`;
  const job = (name: string) => json(admin.request.post(`/api/admin/jobs/${name}`));
  const picks = (member: number, week: LeagueWeek) =>
    json<PickemWeekPicksResponse>(contexts[member]!.request.get(picksUrl(week)));

  async function selectFive(page: Page, home: boolean) {
    for (const [away, host] of ATS_MATCHUPS.slice(0, 4)) {
      await selectPick(page, away, host, home ? host : away);
    }
    await expect(submitControl(page)).toBeDisabled();
    const [away, host] = ATS_MATCHUPS[4];
    await selectPick(page, away, host, home ? host : away);
    await expect(submitControl(page)).toBeEnabled();
  }

  async function standings(week?: LeagueWeek) {
    const result = await json<PickemStandingsResponse>(
      contexts[0]!.request.get(
        `/api/leagues/${leagueId}/pickem/standings${week ? `?week=${week.id}` : ""}`,
      ),
    );
    // Timestamps legitimately change on reconciliation; compare the domain state.
    return result.rows
      .map(({ userId, points, wins, losses, pushes, rank }) => ({
        userId,
        points,
        wins,
        losses,
        pushes,
        rank,
      }))
      .sort((a, b) => a.userId.localeCompare(b.userId));
  }

  async function expectBoard(points: number[], records: string[]) {
    await pages[0]!.goto(`/leagues/${leagueId}`);
    const board = pages[0]!.getByTestId("standings-card");
    for (const [index, user] of users.entries()) {
      const row = board.getByRole("row").filter({ hasText: user.name });
      await expect(row.getByTestId("standings-points")).toHaveText(String(points[index]));
      await expect(row.getByTestId("standings-record")).toHaveText(records[index]!);
    }
  }

  async function finishWeek(weekNumber: number) {
    const latest = Math.max(
      ...fixtures
        .filter((g) => g.weekNumber === weekNumber)
        .map((g) => new Date(g.kickoffAt).getTime()),
    );
    await setSimClock(admin, latest + SIM_GAME_DURATION_MS + 60_000);
    await job("nfl/sync-scores");
  }

  test.beforeAll(async ({ browser }) => {
    admin = await browser.newContext();
    adminId = (await signInAs(admin, { appRole: APP_ROLE.ADMIN, username: uniqueUsername() })).id;
    await resetSim(admin);
    const slug = await seedAtsSeason();
    await loadScenario(admin, slug, ["sync-schedule", "sync-odds"]);
    const state = await json<SimStateResponse>(admin.request.get("/api/sim/state"));
    fixtures = (
      await json<SimFixtureGamesResponse>(
        admin.request.get(`/api/sim/fixtures/games?scenarioId=${state.activeScenario!.id}`),
      )
    ).games;
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext(i === 1 ? devices["iPhone 13"] : {});
      contexts.push(context);
      const name = uniqueUsername();
      const user = await signInAs(context, { username: name, displayName: name });
      users.push({ id: user.id, name });
      pages.push(await context.newPage());
    }
  });

  test.afterAll(async () => {
    if (admin) await resetSim(admin);
    await cleanup([...users.map((u) => u.id), ...(adminId ? [adminId] : [])]);
    for (const context of contexts) await context.close();
    if (admin) await admin.close();
  });

  test("creates a private ATS league with three members and two priced weeks", async () => {
    const page = pages[0]!;
    await page.goto("/leagues/new");
    await page.locator("#name").fill(`E2E weekly ATS ${users[0]!.name}`);
    await page.getByRole("radio", { name: "Against the Spread" }).click();
    await page.getByRole("button", { name: "Create league" }).click();
    await expect(page).toHaveURL(/\/leagues\/[0-9a-f-]{36}$/);
    leagueId = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.getByRole("link", { name: "Members" }).click();
    await page.getByRole("button", { name: "Create invite link" }).click();
    await expect(page.getByRole("button", { name: "Revoke" }).first()).toBeVisible();
    const code = await latestInviteCode(leagueId);
    for (const member of pages.slice(1)) {
      await member.goto(`/join/${code}`);
      await member.getByRole("button", { name: "Join league" }).click();
      await expect(member).toHaveURL(new RegExp(`/leagues/${leagueId}$`));
    }
    weeks = (await json<LeagueWeeksResponse>(page.request.get(`/api/leagues/${leagueId}/weeks`)))
      .weeks;
    expect(weeks.map((w) => w.label)).toEqual(["Week 1", "Week 2"]);
    for (const week of weeks) {
      const slate = await json<WeekSlateResponse>(page.request.get(`/api/weeks/${week.id}/games`));
      expect(slate.games).toHaveLength(6);
      expect(slate.games.every((g) => g.spread !== null)).toBe(true);
    }
  });

  test("recovers a stale five-pick submission and persists the accepted lines", async () => {
    const page = pages[0]!;
    const week = weeks[0]!;
    await page.goto(sheetUrl(week));
    await selectFive(page, true);
    await submitControl(page).click();
    const opening = fixtures.find((g) => g.weekNumber === 1 && g.homeTeamAbbr === "BUF")!;
    // An API-side fixture edit leaves the browser's open confirmation untouched.
    await json(
      admin.request.patch(`/api/sim/fixtures/games/${opening.id}`, { data: { spread: -7 } }),
    );
    await job("nfl/sync-odds");
    const response = page.waitForResponse(
      (r) => r.url().endsWith(picksUrl(week)) && r.request().method() === "PUT",
    );
    await page.getByRole("alertdialog").getByRole("button", { name: "Submit picks" }).click();
    const refused = await response;
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "spread_stale" });
    expect((await picks(0, week)).members.find((m) => m.isViewer)!.picks).toEqual([]);
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(gameRow(page, "MIA", "BUF")).toContainText("-7");
    // Enabled without reselecting proves the recovery preserved all five choices.
    await submitSheet(page);
    const accepted = (await picks(0, week)).members.find((m) => m.isViewer)!.picks;
    expect(accepted).toHaveLength(5);
    const slate = await json<WeekSlateResponse>(page.request.get(`/api/weeks/${week.id}/games`));
    const game = slate.games.find((g) => g.homeTeam.abbreviation === "BUF")!;
    expect(accepted.find((p) => p.gameId === game.id)).toMatchObject({ spread: -7 });

    await pages[1]!.goto(sheetUrl(week));
    await selectFive(pages[1]!, false);
    await submitSheet(pages[1]!);
    await json(
      admin.request.patch(`/api/sim/fixtures/games/${opening.id}`, { data: { spread: -14 } }),
    );
    await job("nfl/sync-odds");
    await page.reload();
    await expect(submitControl(page)).toHaveCount(0);
    await expect(gameRow(page, "MIA", "BUF")).toContainText("-7");
    expect((await picks(0, week)).members.find((m) => m.isViewer)!.picks).toEqual(accepted);
  });

  test("reveals only kicked-off picks while the next week remains closed", async () => {
    const week = weeks[0]!;
    await pages[2]!.goto(`/leagues/${leagueId}`);
    await pages[2]!.getByRole("link", { name: "All Picks" }).click();
    const row = pages[2]!.getByTestId("member-picks-row").filter({ hasText: users[0]!.name });
    await expect(row.getByTestId("member-pick")).toHaveCount(0);
    expect((await picks(2, week)).members.find((m) => m.userId === users[0]!.id)).toMatchObject({
      picks: [],
      hiddenPickCount: 5,
    });
    expect((await picks(0, weeks[1]!)).pickWindowOpen).toBe(false);
    const firstKickoff = Math.min(
      ...fixtures.filter((g) => g.weekNumber === 1).map((g) => new Date(g.kickoffAt).getTime()),
    );
    await setSimClock(admin, firstKickoff + 60_000);
    await job("nfl/sync-scores");
    await pages[2]!.reload();
    await expect(row.getByTestId("member-pick")).toHaveCount(1);
    const revealed = (await picks(2, week)).members.find((m) => m.userId === users[0]!.id)!;
    expect(revealed.picks).toHaveLength(1);
    expect(revealed.hiddenPickCount).toBe(4);
  });

  test("score sync grades accepted spreads and opens Week 2 for submitters", async () => {
    const fifth = fixtures.find((g) => g.weekNumber === 1 && g.homeTeamAbbr === "ATL")!;
    // The unselected sixth game has not kicked off: eligibility follows the
    // member's completed set, not completion of the entire NFL slate.
    await setSimClock(admin, new Date(fifth.kickoffAt).getTime() + SIM_GAME_DURATION_MS + 60_000);
    await job("nfl/sync-scores");
    // No /sim/settle or sweep precedes these assertions: sync-scores must grade.
    await expectBoard([3.5, 1.5, 0], ["3-1-1", "1-3-1", "0-0-0"]);
    await pages[0]!.goto(sheetUrl(weeks[0]!));
    await expect(gameRow(pages[0]!, "MIA", "BUF").getByTestId("pick-outcome")).toHaveAttribute(
      "data-outcome",
      PICK_OUTCOME.CORRECT,
    );
    expect((await picks(0, weeks[1]!)).pickWindowOpen).toBe(true);
    expect((await picks(2, weeks[1]!)).pickWindowOpen).toBe(false);
    const before = await standings(weeks[0]);
    for (let i = 0; i < 2; i++) {
      await job("settle-sweep");
      expect(await standings(weeks[0])).toEqual(before);
    }
    await pages[0]!.goto(sheetUrl(weeks[1]!));
    await selectFive(pages[0]!, true);
    await submitSheet(pages[0]!);
    await pages[1]!.goto(sheetUrl(weeks[1]!));
    await selectFive(pages[1]!, false);
    await submitSheet(pages[1]!);
    await finishWeek(1);
  });

  test("Week 2 keeps weekly history separate and sums the season without double-counting", async () => {
    await setSimClock(admin, new Date(weeks[1]!.startsAt).getTime() + 60_000);
    expect((await picks(2, weeks[1]!)).pickWindowOpen).toBe(true);
    await finishWeek(2);
    await expectBoard([5, 5, 0], ["4-4-2", "4-4-2", "0-0-0"]);
    const board = pages[0]!.getByTestId("standings-card");
    for (const user of users.slice(0, 2)) {
      await expect(
        board.getByRole("row").filter({ hasText: user.name }).getByTestId("standings-rank"),
      ).toHaveText("T-1");
    }
    const snapshots = [];
    for (const [index, week] of weeks.entries()) {
      const rows = await standings(week);
      expect(users.map((u) => rows.find((r) => r.userId === u.id)!.points)).toEqual(
        index === 0 ? [3.5, 1.5, 0] : [1.5, 3.5, 0],
      );
      snapshots.push(rows);
    }
    // Week 1 remains readable after the default week has changed.
    await pages[0]!.goto(sheetUrl(weeks[0]!));
    await expect(gameRow(pages[0]!, "MIA", "BUF").getByTestId("pick-outcome")).toHaveAttribute(
      "data-outcome",
      PICK_OUTCOME.CORRECT,
    );
    const season = await standings();
    await job("settle-sweep");
    expect(await standings()).toEqual(season);
    for (const [index, week] of weeks.entries())
      expect(await standings(week)).toEqual(snapshots[index]);
  });
});
