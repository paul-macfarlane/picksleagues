import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { cleanup, mintSession, uniqueUsername } from "./setup/session";
import { latestInviteCode } from "./setup/league-seed";
import {
  APP_ROLE,
  ERROR_CODE,
  PICKEM_PICK_SIDE,
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

// Tab away and come back, without navigating. TanStack Query refetches its
// stale queries on regaining visibility, which is how an already-open screen
// takes in state that changed while the member wasn't looking — the only way
// to exercise a re-render against a *new* slate, since every `goto` remounts
// the editor and re-seeds it from scratch. The flag has to actually flip:
// the focus manager fires on change, not on every event.
async function tabAwayAndBack(page: Page) {
  await page.evaluate(() => {
    const visit = (value: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", { value, configurable: true });
      // Dispatched on `window`, where the query client's focus manager
      // listens. A real `visibilitychange` fires on `document` and reaches
      // `window` by bubbling, which a hand-built Event does not do by default.
      window.dispatchEvent(new Event("visibilitychange"));
    };
    visit("hidden");
    visit("visible");
  });
}

// Addressed by the testid `MemberPicksRow` carries for exactly this purpose —
// the row is the unit the visibility assertions care about, and locating it by
// walking up from the display-name text would re-break on any layout change.
function memberRow(scope: Locator, displayName: string): Locator {
  return scope.getByTestId("member-picks-row").filter({ hasText: displayName });
}

// Members are collapsed by default (feedback round 6), so anything asserted as
// *visible* inside one has to be opened first — through the summary, the way a
// reader opens it. Counting assertions deliberately do not call this: a closed
// `<details>` keeps its children in the DOM, so those still measure what was
// rendered rather than what is on screen.
async function expandMember(scope: Locator, displayName: string): Promise<Locator> {
  const row = memberRow(scope, displayName);
  await row.locator("summary").click();
  return row;
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
  // A second league over the *same* slate with a cap of 2 (feedback round 5).
  // The league above has exactly as many games as picks allowed, so "a game is
  // open" and "the member can reach it" never diverge there — which is why the
  // action-bar bug shipped and why the My Picks slate filter would be untested
  // without this. Only the commissioner joins it; one member is enough to
  // exercise a per-member view.
  let capLeagueId: string;
  let weekId: string;
  // Only these two games are individually addressed later: game1 to compute
  // the "just past this kickoff" instant, game4 (the latest kickoff) to
  // compute the "every game is final" instant.
  let game1: SlateGameSummary;
  let game4: SlateGameSummary;

  // Reaches the league-wide pick detail the way a member does — through its own
  // tab (round 5) — and asserts the two things that move gave it: the tab is a
  // real destination, and it opens on the *current* week without inheriting one
  // from whichever surface the member came from.
  async function openLeaguePicks() {
    await pageA.getByRole("link", { name: "League Picks" }).click();
    await expect(pageA).toHaveURL(new RegExp(`/leagues/${leagueId}/league-picks`));
    const detail = pageA.locator('[data-slot="card"]', { hasText: "Picks — Week 1" });
    await expect(detail).toBeVisible();
    return detail;
  }

  // Columns, in order: Rank, Member, W-L-P, Pts, Diff (pickem-standings-table.tsx).
  function assertStandingsRows(table: Locator) {
    const commishRow = table.locator("tr", { hasText: commishName });
    const joinerRow = table.locator("tr", { hasText: joinerName });
    return Promise.all([
      expect(commishRow.locator("td").nth(2)).toHaveText("4-0-0"),
      expect(commishRow.locator("td").nth(3)).toHaveText("4"),
      expect(commishRow.locator("td").nth(4)).toHaveText("+35"),
      expect(joinerRow.locator("td").nth(2)).toHaveText("0-4-0"),
      expect(joinerRow.locator("td").nth(3)).toHaveText("0"),
      expect(joinerRow.locator("td").nth(4)).toHaveText("-35"),
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
    await pageA.goto(`/leagues/${leagueId}/my-picks`);
    await selectPick(pageA, "MIA", "BUF", "BUF");
    await selectPick(pageA, "DEN", "KC", "DEN");
    await selectPick(pageA, "PHI", "DAL", "DAL");
    await selectPick(pageA, "SEA", "SF", "SF");
    await pageA.getByRole("button", { name: "Save picks" }).click();
    await expect(pageA.getByText("4 of 4 picks")).toBeVisible();
    await expect(pageA.getByRole("button", { name: "Save picks" })).toBeDisabled();

    // Joiner: the four losers — the exact inverse, so the two members' points
    // and differentials end up unambiguously separated rather than merely
    // different (makes the final standings assertion a clean derivation).
    await pageB.goto(`/leagues/${leagueId}/my-picks`);
    await selectPick(pageB, "MIA", "BUF", "MIA");
    await selectPick(pageB, "DEN", "KC", "KC");
    await selectPick(pageB, "PHI", "DAL", "PHI");
    await selectPick(pageB, "SEA", "SF", "SEA");
    await pageB.getByRole("button", { name: "Save picks" }).click();
    await expect(pageB.getByText("4 of 4 picks")).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Save picks" })).toBeDisabled();

    // The cap-2 league, arranged over the API — it exists to be *read* at two
    // later clock positions, so nothing here is a user-facing assertion. Picks
    // go on games 2 and 3, leaving game1 (the first kickoff) deliberately
    // unpicked: that is the game the slate filter has to drop.
    const created = await pageA.request.post("/api/leagues", {
      data: {
        mode: "pickem",
        name: `E2E Cap2 ${commishName.slice(-8)}`,
        visibility: "private",
        settings: {
          startWeek: { type: "regular", number: 1 },
          endWeek: { type: "regular", number: 18 },
          pickType: "straight_up",
          picksPerWeek: 2,
          pushTieResolution: "half_point",
        },
      },
    });
    expect(created.ok()).toBe(true);
    capLeagueId = ((await created.json()) as { id: string }).id;

    const capPicks = await pageA.request.put(
      `/api/leagues/${capLeagueId}/pickem/weeks/${weekId}/picks`,
      {
        data: {
          picks: [
            { gameId: findGame("KC", "DEN").id, side: PICKEM_PICK_SIDE.AWAY, spread: null },
            { gameId: findGame("DAL", "PHI").id, side: PICKEM_PICK_SIDE.HOME, spread: null },
          ],
        },
      },
    );
    expect(capPicks.ok()).toBe(true);
  });

  // The two states the equal-cap league structurally cannot reach.
  test("with fewer picks than games, the slate keeps only what the member can still reach", async () => {
    await pageA.goto(`/leagues/${capLeagueId}/my-picks`);

    // Both picks are still unlocked, so the member can give one up and switch —
    // every open game has to stay, including the two they passed on. Hiding
    // these is the trap that defeated the earlier "show only my picks" designs.
    await expect(pageA.getByText("2 of 2 picks")).toBeVisible();
    for (const matchup of ["MIA @ BUF", "DEN @ KC", "PHI @ DAL", "SEA @ SF"]) {
      await expect(pageA.locator("li", { hasText: matchup })).toBeVisible();
    }
  });

  test("before kickoff, another member's picks are hidden behind a count", async () => {
    await pageA.goto(`/leagues/${leagueId}`);
    // Nothing has settled yet — the season board's own empty state.
    await expect(pageA.getByText("Nothing has settled yet.")).toBeVisible();

    await pageA.getByRole("combobox", { name: "View" }).click();
    await pageA.getByRole("option", { name: "Week 1", exact: true }).click();
    await expect(pageA).toHaveURL(new RegExp(`/leagues/${leagueId}\\?week=`));

    // A tab marks the section, and the section is the path: picking a
    // standings period writes `?week=` into this route's own URL and must not
    // read as having navigated away from it (feedback round 4).
    await expect(pageA.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // ...and that scope selector governs the board alone. The league's picks
    // are their own tab now (round 5), so changing the period here must not
    // conjure a second card underneath it.
    await expect(pageA.getByText(/^Picks — /)).toHaveCount(0);

    const detail = await openLeaguePicks();

    // Every member starts collapsed, the viewer included — the page opens as a
    // weekly leaderboard and a reader expands the member they came for.
    const own = memberRow(detail, commishName);
    await expect(own.locator("li").first()).toBeHidden();
    await expect(own.locator("li")).toHaveCount(4);
    await expect(own.getByText(/more pick/)).toHaveCount(0);

    const other = await expandMember(detail, joinerName);
    await expect(other.getByText("4 more picks in — not yet revealed.")).toBeVisible();
    await expect(other.locator("li")).toHaveCount(0);
  });

  test("advancing the clock past one kickoff locks that pick, and reveals it to other members", async () => {
    // Open the editor *before* the kickoff, so the screen has to absorb the
    // lock without a remount — the position a member is in whenever they leave
    // the picks tab open through a Sunday.
    await pageA.goto(`/leagues/${leagueId}/my-picks`);
    await expect(pageA.getByText("4 of 4 picks")).toBeVisible();

    const lockInstant = new Date(new Date(game1.kickoffAt).getTime() + 60_000).toISOString();
    await adminContext.request.post("/api/sim/clock", {
      data: { kind: SIM_CLOCK_ADJUSTMENT_KIND.INSTANT, instant: lockInstant },
    });

    // Pull the started game's live state through, so the row renders what a
    // member actually sees mid-Sunday rather than a still-"Scheduled" row that
    // happens to be locked.
    await adminContext.request.post("/api/admin/jobs/nfl/sync-scores");

    await tabAwayAndBack(pageA);

    // UI: the kicked-off game locks; the rest of the week stays editable. A
    // game being played takes the badge slot from "Locked" — it has kicked off
    // by definition, and which of the three states the row is in is the more
    // useful fact (feedback round 4). The lock itself is asserted below, by the
    // controls and by the API's own refusal.
    const lockedRow = pageA.locator("li", { hasText: "MIA @ BUF" });
    await expect(lockedRow.getByText("In progress")).toBeVisible();
    await expect(lockedRow.getByText("Locked")).toHaveCount(0);

    // Read the count only *after* the row above proves the new slate has
    // landed. The refetch is asynchronous, so asserting straight after the
    // visibility event would pass against the pre-refetch render every time —
    // green for the wrong reason, and blind to exactly the bug below.
    //
    // The count must survive the slate changing underneath an open editor: a
    // pick whose game just locked moves from the editable selection into the
    // retained set, and must not be counted by both. It was — the selection map
    // was filtered only at mount — which is the reported "8 of 5 picks", and
    // remounting on every navigation is what hid it. Nor is any of this an edit
    // the member made, so nothing reads as unsaved.
    await expect(pageA.getByText("4 of 4 picks")).toBeVisible();
    await expect(pageA.getByText("unsaved")).toHaveCount(0);

    // Each number names its own team, so reading the score never depends on
    // knowing that the away side comes first (spec §UI conventions). The
    // simulator holds an in-progress game at 0–0 for its whole window by
    // design, so the value here is fixed rather than merely unasserted.
    await expect(lockedRow.getByText("MIA 0 – BUF 0")).toBeVisible();

    // The provisional standing: a reading of the last sync, phrased as a
    // magnitude and never as a verdict (spec §Provisional pick standing).
    // Straight-up league, level at 0–0, so the pick is "tied".
    await expect(lockedRow.getByText("Your pick: BUF · tied")).toBeVisible();
    const lockedPicked = lockedRow.getByRole("button", { name: "BUF", exact: true });
    const lockedUnpicked = lockedRow.getByRole("button", { name: "MIA", exact: true });
    await expect(lockedPicked).toBeDisabled();
    await expect(lockedUnpicked).toBeDisabled();
    // Locking must not erase *which* side is held: both sides disabled and
    // rendered identically was the reported defect, and the pressed state is
    // the assertable half of the fix (the fill and the check ride on the same
    // `held` flag).
    await expect(lockedPicked).toHaveAttribute("aria-pressed", "true");
    await expect(lockedUnpicked).toHaveAttribute("aria-pressed", "false");

    // Kickoffs read relative to the *app* clock (arch D13), not the browser's.
    // This is the assertion that tells the two apart: simulated time has jumped
    // three days ahead, so the last game is ~12h away and reads "Today"/
    // "Tomorrow", while a browser-clock label would still call it three days
    // out and print a weekday. Nothing else in the suite can distinguish them.
    await expect(
      pageA.locator("li", { hasText: "SEA @ SF" }).getByText(/Kickoff (Today|Tomorrow) /),
    ).toBeVisible();

    const openRow = pageA.locator("li", { hasText: "DEN @ KC" });
    await expect(openRow.getByText("Locked")).toBeHidden();
    await expect(openRow.getByRole("button", { name: "DEN", exact: true })).toBeEnabled();

    // API: resubmitting the now-kicked-off game is refused directly, not a
    // silent no-op (spec §Locking; arch §Locking Model — every pick mutation
    // re-validates the kickoff inside its own transaction).
    const refused = await pageA.request.put(
      `/api/leagues/${leagueId}/pickem/weeks/${weekId}/picks`,
      {
        data: { picks: [{ gameId: game1.id, side: PICKEM_PICK_SIDE.AWAY, spread: null }] },
      },
    );
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe(ERROR_CODE.PICK_LOCKED);

    // Cap-2 league: the game that kicked off without a pick on it is gone from
    // the member's own slate, while the games they could still switch into stay
    // — their two picks are unlocked, so the cap has not trapped them yet.
    await pageA.goto(`/leagues/${capLeagueId}/my-picks`);
    await expect(pageA.locator("li", { hasText: "DEN @ KC" })).toBeVisible();
    await expect(pageA.locator("li", { hasText: "SEA @ SF" })).toBeVisible();
    await expect(pageA.locator("li", { hasText: "MIA @ BUF" })).toHaveCount(0);

    // Visibility: the joiner's pick on the now-kicked-off game is revealed to
    // the commissioner; their other three picks (still unstarted) are not.
    await pageA.goto(`/leagues/${leagueId}`);
    const detail = await openLeaguePicks();
    const other = await expandMember(detail, joinerName);
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
    const detail = await openLeaguePicks();
    await expect(memberRow(detail, commishName).locator("li")).toHaveCount(4);
    await expect(memberRow(detail, joinerName).locator("li")).toHaveCount(4);
    await expect(detail.getByText(/more pick/)).toHaveCount(0);

    // Each pick's grade reaches the UI. The commissioner took all four winners
    // and the joiner took all four losers, so a mis-joined outcome can't pass
    // by coincidence — and a check mark now means precisely this, which is why
    // it appears nowhere before a pick settles.
    await expect(memberRow(detail, commishName).getByText("Correct")).toHaveCount(4);
    await expect(memberRow(detail, joinerName).getByText("Incorrect")).toHaveCount(4);
    // Every graded pick pairs its badge with the size of the result — none of
    // these four pushed, so all four carry a magnitude (round 5).
    await expect(memberRow(detail, commishName).getByText(/^won by \d/)).toHaveCount(4);
    await expect(memberRow(detail, joinerName).getByText(/^lost by \d/)).toHaveCount(4);

    // Same grades on the pick editor, where the outcome takes the badge slot
    // "Locked" held before the game finished.
    await pageA.goto(`/leagues/${leagueId}/my-picks`);
    const settledRow = pageA.locator("li", { hasText: "MIA @ BUF" });
    await expect(settledRow.getByText("Correct")).toBeVisible();
    await expect(settledRow.getByText("Locked")).toHaveCount(0);
    // BUF (home) beat MIA (away) 27–17 — named, and in away-home order.
    await expect(settledRow.getByText("MIA 17 – BUF 27")).toBeVisible();
    // The magnitude survives the grade but the provisional *phrasing* must not:
    // the badge above owns the verdict, so the line states only how big the
    // result was — the same number the standings' Diff column sums (round 5).
    await expect(settledRow.getByText("Your pick: BUF · won by 10")).toBeVisible();
    await expect(settledRow.getByText(/tied|up \d|down \d/)).toHaveCount(0);

    // Nothing in the week can be changed any more, so the save bar retires
    // rather than pinning a permanently-disabled button to the screen, and
    // hands its count to the card header (feedback round 4).
    await expect(pageA.getByRole("button", { name: "Save picks" })).toHaveCount(0);
    await expect(pageA.getByText("4 of 4 picks · this week is locked.")).toBeVisible();

    // Cap-2 league, the week in review: nothing is operable any more, so the
    // slate collapses to the two games the member actually picked. The two they
    // passed on are gone — the whole point of the filter, and a state the
    // equal-cap league above can never produce.
    await pageA.goto(`/leagues/${capLeagueId}/my-picks`);
    await expect(pageA.getByText("2 of 2 picks · this week is locked.")).toBeVisible();
    await expect(pageA.locator("li", { hasText: "DEN @ KC" })).toBeVisible();
    await expect(pageA.locator("li", { hasText: "PHI @ DAL" })).toBeVisible();
    await expect(pageA.locator("li", { hasText: "MIA @ BUF" })).toHaveCount(0);
    await expect(pageA.locator("li", { hasText: "SEA @ SF" })).toHaveCount(0);
  });
});
