import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { cleanup, mintSession, uniqueUsername } from "./setup/session";
import { latestInviteCode } from "./setup/league-seed";
import {
  APP_ROLE,
  ERROR_CODE,
  PICK_SIDE,
  SIM_CLOCK_ADJUSTMENT_KIND,
  SIM_RESET_SCOPE,
} from "../packages/schemas/src/index";

/**
 * The merge-gate journey (backlog PKM-8; arch §Automated Testing): create a
 * Pick'em league, invite and join a second member, both submit picks against
 * a real slate (the simulator's `mixed-week` fixture — an ordinary week with
 * no pushes/ties/cancellations), advance simulated time past one kickoff and
 * then every kickoff, and assert locking, kickoff-gated pick visibility, and
 * settled standings — all through the real SPA/API/Postgres stack (arch D14:
 * no network mocking anywhere).
 *
 * `*.sim.spec.ts` + `test.describe.serial`, per playwright.config.ts's own
 * comment: this file moves the environment-wide simulated clock, so it must
 * never run concurrently with another spec, or with itself — the whole
 * journey lives in this one file rather than split across several.
 *
 * `mixed-week`'s straight-up outcomes (spec §Scoring: +1 correct / 0
 * incorrect), used throughout below to compute the expected standings:
 *   BUF (home) beats MIA (away)   27–17  → home margin +10
 *   DEN (away) beats KC (home)    24–20  → home margin  -4 (an upset)
 *   DAL (home) beats PHI (away)   24–20  → home margin  +4
 *   SF  (home) beats SEA (away)   30–13  → home margin +17
 */

type WeekSummary = { id: string };
type SlateGameSummary = {
  id: string;
  kickoffAt: string;
  homeTeam: { abbreviation: string };
  awayTeam: { abbreviation: string };
};

async function signInAs(context: BrowserContext, overrides?: Parameters<typeof mintSession>[0]) {
  const { user, cookieForPlaywright } = await mintSession(overrides);
  await context.addCookies([cookieForPlaywright]);
  return user;
}

// Selects a pick on the Picks tab by scoping to the game row's own text
// ("<away> @ <home>", `pickem-picks.tsx`'s `GameRow`) rather than a bare
// team-abbreviation button — the abbreviations happen to be unique across
// this fixture's 8 teams, but scoping is what keeps this correct if that ever
// changes.
async function selectPick(page: Page, awayAbbr: string, homeAbbr: string, pickAbbr: string) {
  const row = page.locator("li", { hasText: `${awayAbbr} @ ${homeAbbr}` });
  await row.getByRole("button", { name: pickAbbr, exact: true }).click();
}

// Addressed by the testid `MemberPicksRow` carries for exactly this purpose —
// the row is the unit the visibility assertions care about, and locating it by
// walking up from the display-name text would re-break on any layout change.
function memberRow(scope: Locator, displayName: string): Locator {
  return scope.getByTestId("member-picks-row").filter({ hasText: displayName });
}

test.describe.serial("Pick'em merge-gate journey (mixed-week scenario)", () => {
  let adminContext: BrowserContext;
  let commishContext: BrowserContext;
  let joinerContext: BrowserContext;
  let pageA: Page; // commissioner
  let pageB: Page; // joiner

  let adminId: string;
  let commishId: string;
  let joinerId: string;
  let commishName: string;
  let joinerName: string;

  let leagueId: string;
  let weekId: string;
  // Only these two games are individually addressed later: game1 to compute
  // the "just past this kickoff" instant, game4 (the latest kickoff) to
  // compute the "every game is final" instant.
  let game1: SlateGameSummary;
  let game4: SlateGameSummary;

  function assertStandingsRows(table: Locator) {
    const commishRow = table.locator("tr", { hasText: commishName });
    const joinerRow = table.locator("tr", { hasText: joinerName });
    return Promise.all([
      expect(commishRow.locator("td").nth(2)).toHaveText("4"),
      expect(commishRow.locator("td").nth(3)).toHaveText("+35"),
      expect(joinerRow.locator("td").nth(2)).toHaveText("0"),
      expect(joinerRow.locator("td").nth(3)).toHaveText("-35"),
    ]);
  }

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    commishContext = await browser.newContext();
    joinerContext = await browser.newContext();

    const admin = await signInAs(adminContext, {
      appRole: APP_ROLE.ADMIN,
      username: uniqueUsername(),
    });
    adminId = admin.id;

    commishName = uniqueUsername();
    joinerName = uniqueUsername();
    const commish = await signInAs(commishContext, {
      username: commishName,
      displayName: commishName,
    });
    const joiner = await signInAs(joinerContext, { username: joinerName, displayName: joinerName });
    commishId = commish.id;
    joinerId = joiner.id;

    pageA = await commishContext.newPage();
    pageB = await joinerContext.newPage();

    // Canonical workflow (docs/simulator-guide.md "The canonical workflow"):
    // reset first — loading a scenario never clears already-ingested data
    // (FK RESTRICT from league_seasons) — then load, then sync so the fixture
    // actually reaches `games`/`weeks` (nothing changes for the app until a
    // sync job runs).
    await adminContext.request.post("/api/sim/reset", {
      data: { scope: SIM_RESET_SCOPE.ENVIRONMENT, dropScenario: true },
    });
    await adminContext.request.post("/api/sim/scenarios/mixed-week/load");
    await adminContext.request.post("/api/admin/jobs/nfl/sync-schedule");
    await adminContext.request.post("/api/admin/jobs/nfl/sync-odds");
  });

  test.afterAll(async () => {
    // Drop the active scenario and return the clock to real time — the offset
    // lives on the DB singleton, not this process, so a later local run must
    // never inherit it.
    await adminContext.request.post("/api/sim/reset", {
      data: { scope: SIM_RESET_SCOPE.ENVIRONMENT, dropScenario: true },
    });
    await cleanup([adminId, commishId, joinerId]);
    await commishContext.close();
    await joinerContext.close();
    await adminContext.close();
  });

  test("commissioner creates a Pick'em league; a second member joins via invite", async () => {
    const leagueName = `E2E Pickem ${commishName.slice(-8)}`;

    // Fresh user ⇒ the dashboard empty state; its CTA reads "Create a league".
    // Defaults are a Pick'em league, Start/End Week 1–18, Straight Up, 5 picks
    // per week (apps/web/src/routes/_authed/leagues/new.tsx) — exactly the
    // shape this journey needs, so nothing on the form is touched.
    await pageA.goto("/");
    await pageA.getByRole("link", { name: "Create a league" }).click();
    await expect(pageA).toHaveURL(/\/leagues\/new/);
    await pageA.locator("#name").fill(leagueName);
    await pageA.getByRole("button", { name: "Create league" }).click();

    await expect(pageA).toHaveURL(/\/leagues\/[0-9a-f-]{36}$/);
    leagueId = new URL(pageA.url()).pathname.split("/").at(-1)!;

    await pageA.getByRole("link", { name: "Members" }).click();
    await pageA.getByRole("button", { name: "Create invite link" }).click();
    await expect(pageA.getByRole("button", { name: "Revoke" }).first()).toBeVisible();
    const code = await latestInviteCode(leagueId);

    await pageB.goto(`/join/${code}`);
    await expect(pageB.getByText(leagueName)).toBeVisible();
    await pageB.getByRole("button", { name: "Join league" }).click();
    await expect(pageB).toHaveURL(new RegExp(`/leagues/${leagueId}$`));

    await pageB.getByRole("link", { name: "Members" }).click();
    await expect(pageB.getByText(`@${commishName}`)).toBeVisible();
    await expect(pageB.getByText(`@${joinerName}`)).toBeVisible();
  });

  test("both members submit picks for week 1 while every game is unstarted", async () => {
    // Arranging state, not a user-facing assertion, so a direct API call is
    // fine here (per PKM-8's instructions) — the UI derives this same week/
    // slate itself via GET .../weeks and GET /weeks/{id}/games.
    const weeksRes = await pageA.request.get(`/api/leagues/${leagueId}/weeks`);
    expect(weeksRes.ok()).toBe(true);
    const { weeks } = (await weeksRes.json()) as { weeks: WeekSummary[] };
    weekId = weeks[0]!.id;

    const gamesRes = await pageA.request.get(`/api/weeks/${weekId}/games`);
    expect(gamesRes.ok()).toBe(true);
    const { games: slateGames } = (await gamesRes.json()) as { games: SlateGameSummary[] };

    function findGame(homeAbbr: string, awayAbbr: string): SlateGameSummary {
      const found = slateGames.find(
        (g) => g.homeTeam.abbreviation === homeAbbr && g.awayTeam.abbreviation === awayAbbr,
      );
      if (!found) throw new Error(`mixed-week fixture is missing ${awayAbbr} @ ${homeAbbr}`);
      return found;
    }

    game1 = findGame("BUF", "MIA");
    game4 = findGame("SF", "SEA");

    // Commissioner: the four actual winners.
    await pageA.goto(`/leagues/${leagueId}/picks`);
    await selectPick(pageA, "MIA", "BUF", "BUF");
    await selectPick(pageA, "DEN", "KC", "DEN");
    await selectPick(pageA, "PHI", "DAL", "DAL");
    await selectPick(pageA, "SEA", "SF", "SF");
    await pageA.getByRole("button", { name: "Save picks" }).click();
    await expect(pageA.getByText("4 / 4 picked")).toBeVisible();
    await expect(pageA.getByRole("button", { name: "Save picks" })).toBeDisabled();

    // Joiner: the four losers — the exact inverse, so the two members' points
    // and differentials end up unambiguously separated rather than merely
    // different (makes the final standings assertion a clean derivation).
    await pageB.goto(`/leagues/${leagueId}/picks`);
    await selectPick(pageB, "MIA", "BUF", "MIA");
    await selectPick(pageB, "DEN", "KC", "KC");
    await selectPick(pageB, "PHI", "DAL", "PHI");
    await selectPick(pageB, "SEA", "SF", "SEA");
    await pageB.getByRole("button", { name: "Save picks" }).click();
    await expect(pageB.getByText("4 / 4 picked")).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Save picks" })).toBeDisabled();
  });

  test("before kickoff, another member's picks are hidden behind a count", async () => {
    await pageA.goto(`/leagues/${leagueId}`);
    // Nothing has settled yet — the season board's own empty state.
    await expect(pageA.getByText("Nothing has settled yet.")).toBeVisible();

    await pageA.getByRole("combobox", { name: "View" }).click();
    await pageA.getByRole("option", { name: "Week 1", exact: true }).click();
    await expect(pageA).toHaveURL(new RegExp(`/leagues/${leagueId}\\?week=`));

    const detail = pageA.locator('[data-slot="card"]', { hasText: "Picks — Week 1" });

    const own = memberRow(detail, commishName);
    await expect(own.locator("li")).toHaveCount(4);
    await expect(own.getByText(/more pick/)).toHaveCount(0);

    const other = memberRow(detail, joinerName);
    await expect(other.getByText("4 more picks in — not yet revealed.")).toBeVisible();
    await expect(other.locator("li")).toHaveCount(0);
  });

  test("advancing the clock past one kickoff locks that pick, and reveals it to other members", async () => {
    const lockInstant = new Date(new Date(game1.kickoffAt).getTime() + 60_000).toISOString();
    await adminContext.request.post("/api/sim/clock", {
      data: { kind: SIM_CLOCK_ADJUSTMENT_KIND.INSTANT, instant: lockInstant },
    });

    // UI: the kicked-off game locks; the rest of the week stays editable.
    await pageA.goto(`/leagues/${leagueId}/picks`);
    const lockedRow = pageA.locator("li", { hasText: "MIA @ BUF" });
    await expect(lockedRow.getByText("Locked")).toBeVisible();
    await expect(lockedRow.getByText("Your pick: BUF")).toBeVisible();
    await expect(lockedRow.getByRole("button", { name: "BUF", exact: true })).toBeDisabled();
    await expect(lockedRow.getByRole("button", { name: "MIA", exact: true })).toBeDisabled();

    const openRow = pageA.locator("li", { hasText: "DEN @ KC" });
    await expect(openRow.getByText("Locked")).toBeHidden();
    await expect(openRow.getByRole("button", { name: "DEN", exact: true })).toBeEnabled();

    // API: resubmitting the now-kicked-off game is refused directly, not a
    // silent no-op (spec §Locking; arch §Locking Model — every pick mutation
    // re-validates the kickoff inside its own transaction).
    const refused = await pageA.request.put(`/api/leagues/${leagueId}/picks/week/${weekId}`, {
      data: { picks: [{ gameId: game1.id, side: PICK_SIDE.AWAY, spread: null }] },
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe(ERROR_CODE.PICK_LOCKED);

    // Visibility: the joiner's pick on the now-kicked-off game is revealed to
    // the commissioner; their other three picks (still unstarted) are not.
    await pageA.goto(`/leagues/${leagueId}`);
    await pageA.getByRole("combobox", { name: "View" }).click();
    await pageA.getByRole("option", { name: "Week 1", exact: true }).click();
    const detail = pageA.locator('[data-slot="card"]', { hasText: "Picks — Week 1" });
    const other = memberRow(detail, joinerName);
    await expect(other.getByText("3 more picks in — not yet revealed.")).toBeVisible();
    await expect(other.locator("li")).toHaveCount(1);
    await expect(other.locator("li").first()).toContainText("MIA");
  });

  test("after every game goes final, settlement produces the expected standings", async () => {
    // Past every game's final threshold (kickoff + 3h15m, docs/simulator-guide.md
    // "How a fixture becomes a status") — game4 kicks off latest, so its
    // threshold is the binding one.
    const finalInstant = new Date(
      new Date(game4.kickoffAt).getTime() + (3 * 60 + 16) * 60 * 1000,
    ).toISOString();
    await adminContext.request.post("/api/sim/clock", {
      data: { kind: SIM_CLOCK_ADJUSTMENT_KIND.INSTANT, instant: finalInstant },
    });
    await adminContext.request.post("/api/admin/jobs/nfl/sync-scores");
    // Not load-bearing (nfl-sync-scores already settles a game's picks as it
    // goes final) — a full rebuild-and-inspect for extra confidence, and to
    // exercise the endpoint this journey's `deps` name (SIM-5).
    const settled = await adminContext.request.post("/api/sim/settle", { data: { leagueId } });
    expect(settled.ok()).toBe(true);

    // Season-cumulative board (the default view).
    await pageA.goto(`/leagues/${leagueId}`);
    const seasonTable = pageA.locator('[data-slot="card"]', { hasText: "Standings" }).first();
    await assertStandingsRows(seasonTable);
    await expect(pageA.getByText(/^Last updated/)).toBeVisible();

    // Weekly board — the only week played, so it matches the season totals.
    await pageA.getByRole("combobox", { name: "View" }).click();
    await pageA.getByRole("option", { name: "Week 1", exact: true }).click();
    const weekTable = pageA.locator('[data-slot="card"]', { hasText: "Standings" }).first();
    await assertStandingsRows(weekTable);

    // Every game is final now, so both members' full picks are revealed.
    const detail = pageA.locator('[data-slot="card"]', { hasText: "Picks — Week 1" });
    await expect(memberRow(detail, commishName).locator("li")).toHaveCount(4);
    await expect(memberRow(detail, joinerName).locator("li")).toHaveCount(4);
    await expect(detail.getByText(/more pick/)).toHaveCount(0);
  });
});
