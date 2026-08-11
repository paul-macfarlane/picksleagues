import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { cleanup, mintSession, uniqueUsername } from "./setup/session";
import { latestInviteCode } from "./setup/league-seed";
import { SIM_GAME_DURATION_MS } from "../packages/core/src/sim-provider";
import {
  APP_ROLE,
  PICK_OUTCOME,
  SIM_CLOCK_ADJUSTMENT_KIND,
  SIM_RESET_SCOPE,
  SURVIVOR_MEMBER_STATUS,
  SURVIVOR_PICK_STATUS,
} from "../packages/schemas/src/index";

/**
 * A Survivor season end to end (backlog ELM-5; spec §Game Mode 2, §Pick
 * Visibility, §Core User Flows 4): create the league through the real form,
 * fill four weeks of picks against the `survivor-season` fixture, and watch
 * settlement eliminate one member, revive the two who bust together, and crown
 * them co-winners — all through the real SPA/API/Postgres stack, no mocks
 * anywhere (arch D14).
 *
 * **Three members, because two cannot hold all three board states at once.**
 * The board has to show, simultaneously, someone out for the season, someone
 * revived, and — at the end — the co-winners; a two-member league whose entire
 * alive set busts revives both and can never show an elimination beside a
 * revival.
 *
 * **The fixture's four weeks are what makes an ending reachable.** A Survivor
 * league's range is the whole regular season (ADR-0024) and the board names a
 * winner only once every in-range week has played, so an eighteen-week range
 * has no ending a browser test can reach. `survivor-season` ingests weeks 15–18
 * only, and the mid-week resolution rule (ADR-0020) starts the league at the
 * first week still ahead — a four-week range. The first assertion below is that
 * this actually happened, because every later step rests on it.
 *
 * Journeys, not branches. Grading, consumption, the refusal matrix, locking and
 * visibility are pinned in `packages/scoring/src/survivor.test.ts` and
 * `apps/api/test/survivor-*.test.ts`; none of them earns a browser. What is
 * here is either a cross-stack outcome on the spine — create/join, a pick that
 * persists, settlement's verdict reaching the board — or a fact no cheaper
 * layer holds, the eliminated member's week and the season's conclusion being
 * the clearest.
 *
 * `*.sim.spec.ts` + `test.describe.serial`, per playwright.config.ts: this file
 * moves the environment-wide simulated clock, so it must never run concurrently
 * with another spec or with itself.
 *
 * Bindings are `data-testid` plus the machine value beside it, or role and
 * accessible name. Team abbreviations, week labels and member names are domain
 * data, not copy, so binding to those is the point rather than the exception.
 */

type LeagueWeekSummary = { id: string; label: string; startsAt: string };
type SlateGameSummary = { id: string; kickoffAt: string };
type SimSettleBody = { leagues: Array<{ summary: { weeks: number } }> };

/** Past every game of a week: the sim projects `final` at kickoff + the game window. */
const AFTER_GAME_MS = SIM_GAME_DURATION_MS + 60_000;
const HOUR_MS = 60 * 60 * 1000;

async function signInAs(context: BrowserContext, overrides?: Parameters<typeof mintSession>[0]) {
  const { user, cookieForPlaywright } = await mintSession(overrides);
  await context.addCookies([cookieForPlaywright]);
  return user;
}

// One team's control inside one game's row, both addressed by what they are
// rather than by where they sit — `survivor-game-row` and `survivor-team-pick`
// carry the matchup and the team as data for exactly this.
function teamButton(page: Page, awayAbbr: string, homeAbbr: string, teamAbbr: string): Locator {
  return page
    .locator(
      `[data-testid="survivor-game-row"][data-away-team="${awayAbbr}"][data-home-team="${homeAbbr}"]`,
    )
    .locator(`[data-testid="survivor-team-pick"][data-team="${teamAbbr}"]`);
}

function saveControl(page: Page): Locator {
  return page.getByRole("button", { name: "Save pick" });
}

/**
 * Takes a team and commits it — the whole of a Survivor week (spec §Game Mode 2:
 * one team, changeable until it kicks off), with none of Pick'em's
 * irreversible-submission ceremony.
 *
 * Ends on "there is nothing left to save": once the write lands, the sheet is
 * holding exactly what the server holds, so the control disables itself. A
 * refusal leaves the selection unsaved and the control live, which is what the
 * wait fails on — and the toast rule means a refusal also raises the error toast
 * asserted after it.
 */
async function savePick(page: Page, awayAbbr: string, homeAbbr: string, teamAbbr: string) {
  const button = teamButton(page, awayAbbr, homeAbbr, teamAbbr);
  await expect(button).toBeEnabled();
  await button.click();

  const save = saveControl(page);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toBeDisabled();
  // Sonner exposes no handle of our own, so its own attributes are the binding
  // (as e2e/identity.spec.ts does) — the type, never the words.
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
}

test.describe.serial("Survivor season journey (survivor-season scenario)", () => {
  let adminContext: BrowserContext;
  let contexts: BrowserContext[] = [];
  // M1 is the commissioner and survives throughout; M2 survives with them; M3
  // goes out in the first week and stays out.
  let page1: Page;
  let page2: Page;
  let page3: Page;

  let userIds: string[] = [];
  let name1: string;
  let name2: string;
  let name3: string;

  let leagueId: string;
  let weeks: LeagueWeekSummary[] = [];
  const lastKickoffMs = new Map<string, number>();

  async function setClock(instantMs: number) {
    const res = await adminContext.request.post("/api/sim/clock", {
      data: {
        kind: SIM_CLOCK_ADJUSTMENT_KIND.INSTANT,
        instant: new Date(instantMs).toISOString(),
      },
    });
    expect(res.ok()).toBe(true);
  }

  /** Early in a week: every game of it is still ahead, so every member can pick. */
  async function openWeek(index: number) {
    await setClock(new Date(weeks[index]!.startsAt).getTime() + HOUR_MS);
  }

  /**
   * Past the week's last game, then pull the finals through and grade. The score
   * sync already settles a game's picks as it goes final; `/sim/settle` is the
   * full rebuild on top (SIM-5), and its summary is how many weeks the replay
   * got through — the prefix rule (ADR-0025) makes that the season's progress.
   */
  async function playOutWeek(index: number, expectedSettledWeeks: number) {
    await setClock(lastKickoffMs.get(weeks[index]!.id)! + AFTER_GAME_MS);
    const scores = await adminContext.request.post("/api/admin/jobs/nfl/sync-scores");
    expect(scores.ok()).toBe(true);

    const settled = await adminContext.request.post("/api/sim/settle", { data: { leagueId } });
    expect(settled.ok()).toBe(true);
    const body = (await settled.json()) as SimSettleBody;
    expect(body.leagues[0]?.summary.weeks).toBe(expectedSettledWeeks);
  }

  /**
   * The member's own week, opened the way they open it — the tab, then whatever
   * week the server considers current. Asserting which week landed is not
   * decoration: every pick below is placed on the week this resolves to, and a
   * sheet silently showing the wrong one would write picks nobody notices are
   * misfiled.
   */
  async function openMyPicks(page: Page, index: number) {
    await page.goto(`/leagues/${leagueId}/my-picks`);
    await expect(page.locator("#my-picks-week-select")).toContainText(weeks[index]!.label);
  }

  async function openBoard(page: Page): Promise<Locator> {
    await page.goto(`/leagues/${leagueId}`);
    const board = page.getByTestId("survivor-board");
    await expect(board).toBeVisible();
    return board;
  }

  function boardRow(board: Locator, displayName: string): Locator {
    return board.getByTestId("survivor-board-row").filter({ hasText: displayName });
  }

  // A member's pick for a week, wherever the board put it: the current week
  // lives at the row level (FB-26), previous weeks behind the history
  // disclosure — both carry the same data-week/data-team identity.
  function pickEntry(row: Locator, weekIndex: number): Locator {
    const week = weeks[weekIndex]!.id;
    return row.locator(
      `[data-testid="survivor-history-entry"][data-week="${week}"], [data-testid="survivor-current-pick"][data-week="${week}"]`,
    );
  }

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    const memberContexts = [
      await browser.newContext(),
      await browser.newContext(),
      await browser.newContext(),
    ];
    contexts = [adminContext, ...memberContexts];

    const admin = await signInAs(adminContext, {
      appRole: APP_ROLE.ADMIN,
      username: uniqueUsername(),
    });

    [name1, name2, name3] = [uniqueUsername(), uniqueUsername(), uniqueUsername()];
    const members = await Promise.all(
      [name1, name2, name3].map((username, index) =>
        signInAs(memberContexts[index]!, { username, displayName: username }),
      ),
    );
    userIds = [admin.id, ...members.map((member) => member.id)];

    [page1, page2, page3] = [
      await memberContexts[0]!.newPage(),
      await memberContexts[1]!.newPage(),
      await memberContexts[2]!.newPage(),
    ];

    // Canonical workflow (docs/simulator-guide.md): reset first — loading never
    // clears already-ingested data — then load, then sync so the fixture reaches
    // `weeks`/`games`. No odds sync: Survivor is straight-up only (ADR-0026), so
    // nothing here reads a spread.
    await adminContext.request.post("/api/sim/reset", {
      data: { scope: SIM_RESET_SCOPE.ENVIRONMENT, dropScenario: true },
    });
    await adminContext.request.post("/api/sim/scenarios/survivor-season/load");
    await adminContext.request.post("/api/admin/jobs/nfl/sync-schedule");
  });

  test.afterAll(async () => {
    // Drop the scenario and return the clock to real time — the offset lives on
    // the DB singleton, not this process, so a later local run must not inherit it.
    await adminContext.request.post("/api/sim/reset", {
      data: { scope: SIM_RESET_SCOPE.ENVIRONMENT, dropScenario: true },
    });
    await cleanup(userIds);
    await Promise.all(contexts.map((context) => context.close()));
  });

  test("a Survivor league created through the form resolves to the four ingested weeks; two members join", async () => {
    const leagueName = `E2E Survivor ${name1.slice(-8)}`;

    await page1.goto("/");
    await page1.getByRole("link", { name: "Create a league" }).click();
    // By role and accessible name. The ids the radio group builds from the wire
    // value (`mode-survivor`) land on Base UI's visually-hidden form input, not
    // on the control a member clicks, so addressing those clicks nothing.
    await page1.getByRole("radio", { name: "NFL Survivor" }).click();
    // The mode's fieldset appearing is how this knows the radio took. Survivor
    // offers no settings at all — no season range (ADR-0024), no pick type
    // (ADR-0026), no push/tie rule (ADR-0033) — so the read-only range line is
    // what proves the fieldset swapped.
    await expect(page1.getByRole("heading", { name: "Survivor settings" })).toBeVisible();

    await page1.locator("#name").fill(leagueName);
    await page1.getByRole("button", { name: "Create league" }).click();

    await expect(page1).toHaveURL(/\/leagues\/[0-9a-f-]{36}$/);
    leagueId = new URL(page1.url()).pathname.split("/").at(-1)!;

    // The resolved range, and the premise of everything below: the nominal
    // range is weeks 1–18, and the league gets 15–18 because those are the only
    // weeks still ahead of it (ADR-0020 §The mid-week resolution rule).
    const weeksRes = await page1.request.get(`/api/leagues/${leagueId}/weeks`);
    expect(weeksRes.ok()).toBe(true);
    weeks = ((await weeksRes.json()) as { weeks: LeagueWeekSummary[] }).weeks;
    expect(weeks.map((week) => week.label)).toEqual(["Week 15", "Week 16", "Week 17", "Week 18"]);

    // Arranging state rather than asserting it: each week's last kickoff is the
    // instant past which every one of its games has gone final.
    for (const week of weeks) {
      const gamesRes = await page1.request.get(`/api/weeks/${week.id}/games`);
      expect(gamesRes.ok()).toBe(true);
      const { games } = (await gamesRes.json()) as { games: SlateGameSummary[] };
      expect(games).toHaveLength(4);
      lastKickoffMs.set(
        week.id,
        Math.max(...games.map((game) => new Date(game.kickoffAt).getTime())),
      );
    }

    await page1.getByRole("link", { name: "Members" }).click();
    await page1.getByRole("button", { name: "Create invite link" }).click();
    await expect(page1.getByRole("button", { name: "Revoke" }).first()).toBeVisible();
    // Left uncapped on the form, so one link admits both — the code itself is
    // only reachable from the database, since the UI copies it to the clipboard.
    const code = await latestInviteCode(leagueId);

    for (const page of [page2, page3]) {
      await page.goto(`/join/${code}`);
      await page.getByRole("button", { name: "Join league" }).click();
      await expect(page).toHaveURL(new RegExp(`/leagues/${leagueId}$`));
    }
  });

  test("week 15: all three pick, and settlement puts the one who backed a loser out", async () => {
    await openMyPicks(page1, 0);
    await savePick(page1, "MIA", "BUF", "BUF");
    await openMyPicks(page2, 0);
    await savePick(page2, "DEN", "KC", "KC");
    await openMyPicks(page3, 0);
    await savePick(page3, "SEA", "SF", "SF");

    // Before kickoff the league knows M3 is in, not who they took (spec §Pick
    // Visibility) — and the board has never been written.
    const preBoard = await openBoard(page1);
    await expect(page1.getByTestId("survivor-board-updated-at")).toHaveAttribute(
      "data-settled",
      "false",
    );
    await expect(pickEntry(boardRow(preBoard, name3), 0)).not.toHaveAttribute("data-team", /./);

    await playOutWeek(0, 1);

    const board = await openBoard(page1);
    await expect(page1.getByTestId("survivor-board-updated-at")).toHaveAttribute(
      "data-settled",
      "true",
    );

    // The verdict: SF lost, so M3's season is over, and the board says which
    // week ended it.
    const out = boardRow(board, name3);
    await expect(out).toHaveAttribute("data-status", SURVIVOR_MEMBER_STATUS.ELIMINATED);
    await expect(out.getByTestId("survivor-eliminated-week")).toHaveAttribute(
      "data-week",
      weeks[0]!.id,
    );
    for (const name of [name1, name2]) {
      await expect(boardRow(board, name)).toHaveAttribute(
        "data-status",
        SURVIVOR_MEMBER_STATUS.ALIVE,
      );
    }

    // Every game has kicked off, so every pick is revealed — including the two
    // the viewer doesn't own, which is the reveal this week exists to show.
    await expect(pickEntry(out, 0)).toHaveAttribute("data-team", "SF");
    await expect(pickEntry(boardRow(board, name2), 0)).toHaveAttribute("data-team", "KC");
    const own = boardRow(board, name1);
    await expect(pickEntry(own, 0)).toHaveAttribute("data-team", "BUF");
    await expect(
      own.locator('[data-testid="survivor-consumed-team"][data-team="BUF"]'),
    ).toBeVisible();

    // The same settlement on the member's own sheet, which is the other half of
    // the round trip: their pick's game has kicked off, so the week shows the
    // one game they were in — graded — rather than a slate they can't act on.
    await page1.goto(`/leagues/${leagueId}/my-picks?weekId=${weeks[0]!.id}`);
    const gradedRow = page1.getByTestId("survivor-game-row");
    await expect(gradedRow).toHaveCount(1);
    await expect(gradedRow).toHaveAttribute("data-picked-team", "BUF");
    await expect(gradedRow.getByTestId("pick-outcome")).toHaveAttribute(
      "data-outcome",
      PICK_OUTCOME.CORRECT,
    );

    // The same verdict on the surface M3 actually lands on first (ELM-6).
    await page3.goto("/");
    await expect(page3.getByTestId("survivor-pick-status")).toHaveAttribute(
      "data-status",
      SURVIVOR_PICK_STATUS.ELIMINATED,
    );
  });

  test("week 16: the eliminated member gets a verdict, not a sheet, and a change of pick sticks", async () => {
    await openWeek(1);

    // Elimination is for the season, so there is nothing to offer M3 — a
    // disabled sheet would imply a pick that could still be made.
    await openMyPicks(page3, 1);
    await expect(page3.getByTestId("survivor-eliminated")).toBeVisible();
    await expect(saveControl(page3)).toHaveCount(0);

    await openMyPicks(page1, 1);
    // The ledger, not the game: BUF is spent for the season while its opponent
    // in the very same game is still there to take (spec §Game Mode 2 — team reuse).
    await expect(teamButton(page1, "MIA", "BUF", "BUF")).toBeDisabled();
    await expect(teamButton(page1, "MIA", "BUF", "MIA")).toBeEnabled();

    // Change of mind before either game kicks off. PHI loses this week and DEN
    // wins, so a change that failed to persist ends M1's season two steps later
    // rather than passing quietly here.
    await savePick(page1, "PHI", "DAL", "PHI");
    await savePick(page1, "DEN", "KC", "DEN");

    // Reloaded, so what the sheet holds is what the server stored.
    await openMyPicks(page1, 1);
    await expect(teamButton(page1, "DEN", "KC", "DEN")).toHaveAttribute("aria-pressed", "true");
    await expect(teamButton(page1, "PHI", "DAL", "PHI")).toHaveAttribute("aria-pressed", "false");

    // And the same fact on the dashboard glance (ELM-6), which is where a
    // member checks whether they still owe a pick without opening the league.
    await page1.goto("/");
    await expect(page1.getByTestId("survivor-pick-status")).toHaveAttribute(
      "data-status",
      SURVIVOR_PICK_STATUS.PICK_IN,
    );

    await openMyPicks(page2, 1);
    await savePick(page2, "SEA", "SF", "SF");

    await playOutWeek(1, 2);
  });

  test("week 17: the whole alive set busts, and the revival rule brings them back", async () => {
    await openWeek(2);

    // DAL and BUF both lose this week, so the two members still alive go out
    // together — the case the spec answers by restoring both (spec §Game Mode 2
    // — Everyone eliminated in the same week).
    await openMyPicks(page1, 2);
    await savePick(page1, "PHI", "DAL", "DAL");
    await openMyPicks(page2, 2);
    await savePick(page2, "MIA", "BUF", "BUF");

    await playOutWeek(2, 3);

    const board = await openBoard(page1);
    for (const name of [name1, name2]) {
      const row = boardRow(board, name);
      await expect(row).toHaveAttribute("data-status", SURVIVOR_MEMBER_STATUS.ALIVE);
      await expect(row.getByTestId("survivor-revived")).toBeVisible();
    }
    // Only the life comes back, and only for the set that busted together: M3
    // was already out when the week started, so the rule never reaches them.
    const out = boardRow(board, name3);
    await expect(out).toHaveAttribute("data-status", SURVIVOR_MEMBER_STATUS.ELIMINATED);
    await expect(out.getByTestId("survivor-revived")).toHaveCount(0);
  });

  test("week 18: the season concludes and the survivors share first", async () => {
    await openWeek(3);

    await openMyPicks(page1, 3);
    await savePick(page1, "SEA", "SF", "SF");
    await openMyPicks(page2, 3);
    await savePick(page2, "PHI", "DAL", "DAL");

    await playOutWeek(3, 4);

    // Every in-range week has now played, which is the whole of "the league has
    // concluded" (spec §End of League) — so everyone still standing is a winner,
    // several at once being the answer rather than a tie to break.
    const board = await openBoard(page1);
    for (const name of [name1, name2]) {
      const row = boardRow(board, name);
      await expect(row).toHaveAttribute("data-winner", "true");
      await expect(row).toHaveAttribute("data-status", SURVIVOR_MEMBER_STATUS.ALIVE);
      await expect(row.getByTestId("survivor-member-status")).toBeVisible();
    }
    const out = boardRow(board, name3);
    await expect(out).toHaveAttribute("data-winner", "false");
    await expect(out).toHaveAttribute("data-status", SURVIVOR_MEMBER_STATUS.ELIMINATED);

    // And the pick screen agrees: a decided season is a result, not a sheet —
    // every Save on one is a refusal the server has already made.
    await page1.goto(`/leagues/${leagueId}/my-picks`);
    await expect(page1.getByTestId("survivor-season-over")).toHaveAttribute("data-won", "true");
    await expect(saveControl(page1)).toHaveCount(0);
  });
});
