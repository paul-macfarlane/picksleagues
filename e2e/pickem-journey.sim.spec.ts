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
 * The merge-gate journey (backlog PKM-8, SIMP-14; arch §Automated Testing):
 * create a Pick'em league, invite and join a second member, both commit one
 * week as a single irreversible submission (ADR-0018 decision 1) against a real
 * slate (the simulator's `mixed-week` fixture — an ordinary week with no
 * pushes/ties/cancellations), advance simulated time past one kickoff and then
 * every kickoff, and assert the freeze, locking, kickoff-gated pick visibility,
 * and settled standings — all through the real SPA/API/Postgres stack (arch
 * D14: no network mocking anywhere).
 *
 * Journeys, not branches. The refusal and sizing matrices
 * (`pick_set_incomplete`, `too_many_picks`, the post-first-kickoff submitter,
 * the ATS unpriced game) are pinned in `apps/api/test/pickem-picks.test.ts`,
 * and scoring is pinned in `packages/scoring` — none of them earns a browser.
 * The one refusal asserted here is `already_submitted`, because "the week is
 * one submission" is the premise every other assertion below rests on.
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
 *
 * The two members take opposite sides of all four: the commissioner wins the
 * first two and loses the last two, the joiner the reverse. That lands them
 * level at 2 points with opposite margins (-7 and +7) — the exact pair the
 * deleted `Diff` column used to separate, and therefore the pair that proves
 * ties now share a rank with nothing rendered behind it (ADR-0018 decision 4).
 * Taking opposite sides also keeps every member's picks distinguishable from
 * the other's, which the visibility assertions depend on.
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
// ("<away> @ <home>", `pickem-game-row.tsx`'s `Matchup`) rather than a bare
// team-abbreviation button — the abbreviations happen to be unique across
// this fixture's 8 teams, but scoping is what keeps this correct if that ever
// changes.
async function selectPick(page: Page, awayAbbr: string, homeAbbr: string, pickAbbr: string) {
  const row = page.locator("li", { hasText: `${awayAbbr} @ ${homeAbbr}` });
  await row.getByRole("button", { name: pickAbbr, exact: true }).click();
}

// The sheet's submit control (`pickem-picks.tsx`'s sticky action bar). Named
// identically to the confirmation's own action, so it is only ever resolved
// while the dialog is closed — see `submitSheet`.
function submitControl(page: Page): Locator {
  return page.getByRole("button", { name: "Submit picks" });
}

/**
 * Commits the assembled sheet the only way a member can (ADR-0018 decision 1):
 * the action bar's button opens an irreversibility confirmation, and the PUT
 * fires from inside it. Clicking the trigger submits nothing.
 *
 * Ends on the freeze rather than on a toast: once the submission lands there is
 * no submit control on the screen at all, which is both how the test knows the
 * write happened and the member-visible shape of "a week can't be resubmitted".
 */
async function submitSheet(page: Page) {
  const submit = submitControl(page);
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit picks" }).click();
  await expect(submit).toHaveCount(0);
}

// Tab away and come back, without navigating. TanStack Query refetches its
// stale queries on regaining visibility, which is how an already-open screen
// takes in state that changed while the member wasn't looking — the only way
// to exercise a re-render against a *new* slate, since every `goto` remounts
// the week and re-seeds it from scratch. The flag has to actually flip:
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

// Addressed by the testid `MemberPicksSection` carries for exactly this purpose
// — the row is the unit the visibility assertions care about, and locating it by
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

  /**
   * Both members level, and the board with nothing to separate them (ADR-0018
   * decision 4): a shared rank, identical record and points, and no column past
   * Pts where the differential used to sit.
   *
   * Addressed by role and testid rather than by column index — the cells carry
   * no accessible name of their own, so `pickem-standings-table.tsx` states the
   * contract explicitly instead of letting a `td` position stand in for it.
   */
  async function assertTiedStandings(card: Locator) {
    for (const name of [commishName, joinerName]) {
      const row = card.getByRole("row").filter({ hasText: name });
      await expect(row.getByTestId("standings-rank")).toHaveText("T-1");
      await expect(row.getByTestId("standings-record")).toHaveText("2-2-0");
      await expect(row.getByTestId("standings-points")).toHaveText("2");
    }
    await expect(card.getByRole("columnheader")).toHaveCount(4);
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
    // Defaults are a Pick'em league over the Regular Season preset, Straight
    // Up, 5 picks per week (apps/web/src/routes/_authed/leagues/new.tsx) —
    // exactly the shape this journey needs, so nothing on the form is touched.
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

  test("both members commit week 1 as one irreversible full set", async () => {
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

    // Commissioner: the winners of the first two games, the losers of the last
    // two (see the file header for why the split is what it is).
    await pageA.goto(`/leagues/${leagueId}/my-picks`);
    await selectPick(pageA, "MIA", "BUF", "BUF");
    await selectPick(pageA, "DEN", "KC", "DEN");
    await selectPick(pageA, "PHI", "DAL", "PHI");
    // Save-gating is the member-visible half of "a week is a full set"
    // (ADR-0018 decision 2), and the only layer that can show it: three of four
    // is not a submission, and the control says so before the API has to.
    await expect(submitControl(pageA)).toBeDisabled();
    await selectPick(pageA, "SEA", "SF", "SEA");
    await submitSheet(pageA);

    // Read-only from the moment it lands, with every game still unstarted: the
    // freeze is a property of having submitted, not of the games locking, which
    // is the whole difference between ADR-0018 and the editable rules it
    // replaced. `submitSheet` already asserted the submit control is gone.
    const submitted = pageA.locator("li", { hasText: "MIA @ BUF" });
    await expect(submitted.getByRole("button", { name: "BUF", exact: true })).toBeDisabled();
    await expect(submitted.getByRole("button", { name: "MIA", exact: true })).toBeDisabled();

    // Joiner: the exact opposite side of all four.
    await pageB.goto(`/leagues/${leagueId}/my-picks`);
    await selectPick(pageB, "MIA", "BUF", "MIA");
    await selectPick(pageB, "DEN", "KC", "KC");
    await selectPick(pageB, "PHI", "DAL", "DAL");
    await selectPick(pageB, "SEA", "SF", "SF");
    await submitSheet(pageB);
  });

  /**
   * A second league over the *same* slate, with a cap of 2 — the two states the
   * league above structurally cannot reach, because it has exactly as many
   * games as picks allowed.
   *
   * 1. A sheet that asks for fewer picks than it shows. "A game is on the
   *    sheet" and "the sheet is asking for it" only diverge here, and under
   *    ADR-0018 that difference is what separates a submission the API accepts
   *    from one it refuses as `too_many_picks`.
   * 2. A submitted week that is a strict subset of its slate.
   *
   * Only the commissioner joins it; one member is enough for a per-member
   * sheet, and it never needs to settle.
   */
  test("a cap shorter than the slate asks for the cap, then freezes to what was picked", async () => {
    const created = await pageA.request.post("/api/leagues", {
      data: {
        mode: "pickem",
        name: `E2E Cap2 ${commishName.slice(-8)}`,
        visibility: "private",
        // The wire shape carries the preset only (ADR-0020): the server
        // resolves the week refs it stores, so naming them here would be
        // ignored rather than honoured.
        settings: {
          seasonRangePreset: "regular_season",
          pickType: "straight_up",
          picksPerWeek: 2,
        },
      },
    });
    expect(created.ok()).toBe(true);
    const capLeagueId = ((await created.json()) as { id: string }).id;

    await pageA.goto(`/leagues/${capLeagueId}/my-picks`);

    // Every open game is on the sheet — the member chooses which two of the
    // four to spend the cap on, so hiding any of them would decide it for them.
    for (const matchup of ["MIA @ BUF", "DEN @ KC", "PHI @ DAL", "SEA @ SF"]) {
      await expect(pageA.locator("li", { hasText: matchup })).toBeVisible();
    }

    await expect(submitControl(pageA)).toBeDisabled();
    await selectPick(pageA, "DEN", "KC", "DEN");
    await expect(submitControl(pageA)).toBeDisabled();
    await selectPick(pageA, "PHI", "DAL", "DAL");
    // Complete at two, not at four: the required set is the cap, not the number
    // of rows on screen (ADR-0018 decision 2), and a third selection has no
    // slot left to take.
    await expect(
      pageA.locator("li", { hasText: "SEA @ SF" }).getByRole("button", { name: "SF", exact: true }),
    ).toBeDisabled();
    await submitSheet(pageA);

    // The submitted week is the member's own picks, not the slate: the two they
    // passed on are gone, at every clock position from here on, because nothing
    // about this week can change again.
    await expect(pageA.locator("li", { hasText: "DEN @ KC" })).toBeVisible();
    await expect(pageA.locator("li", { hasText: "PHI @ DAL" })).toBeVisible();
    await expect(pageA.locator("li", { hasText: "MIA @ BUF" })).toHaveCount(0);
    await expect(pageA.locator("li", { hasText: "SEA @ SF" })).toHaveCount(0);
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

  test("past one kickoff: that pick locks, is revealed, and the week refuses a second submission", async () => {
    // Open the week *before* the kickoff, so the screen has to absorb the lock
    // without a remount — the position a member is in whenever they leave the
    // picks tab open through a Sunday.
    await pageA.goto(`/leagues/${leagueId}/my-picks`);
    await expect(pageA.locator("li", { hasText: "MIA @ BUF" })).toBeVisible();

    const lockInstant = new Date(new Date(game1.kickoffAt).getTime() + 60_000).toISOString();
    await adminContext.request.post("/api/sim/clock", {
      data: { kind: SIM_CLOCK_ADJUSTMENT_KIND.INSTANT, instant: lockInstant },
    });

    // Pull the started game's live state through, so the row renders what a
    // member actually sees mid-Sunday rather than a still-"Scheduled" row that
    // happens to be locked.
    await adminContext.request.post("/api/admin/jobs/nfl/sync-scores");

    await tabAwayAndBack(pageA);

    // UI: the kicked-off game reads as being played. A game in progress takes
    // the badge slot from "Locked" — it has kicked off by definition, and which
    // of the three states the row is in is the more useful fact (feedback round
    // 4). The lock itself is asserted below, by the API's own refusal.
    const lockedRow = pageA.locator("li", { hasText: "MIA @ BUF" });
    await expect(lockedRow.getByText("In progress")).toBeVisible();
    await expect(lockedRow.getByText("Locked")).toHaveCount(0);

    // Read the rest only *after* the row above proves the new slate has landed.
    // The refetch is asynchronous, so asserting straight after the visibility
    // event would pass against the pre-refetch render every time — green for
    // the wrong reason.
    //
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

    // A game that has *not* kicked off is just as frozen as the one that has:
    // immutability is the submission's property, and a refetch mid-week must
    // not hand any of it back.
    const unstartedRow = pageA.locator("li", { hasText: "DEN @ KC" });
    await expect(unstartedRow.getByRole("button", { name: "DEN", exact: true })).toBeDisabled();
    await expect(submitControl(pageA)).toHaveCount(0);

    // API: the refusal that makes this whole journey's premise true. A week is
    // one immutable submission (ADR-0018 decision 1), so a second call is
    // refused on that ground alone — `already_submitted` is checked ahead of
    // every per-game rule (`services/pickem/picks.ts`), which is why this body
    // never reaches the lock it would otherwise have tripped.
    const refused = await pageA.request.put(
      `/api/leagues/${leagueId}/pickem/weeks/${weekId}/picks`,
      {
        data: { picks: [{ gameId: game1.id, side: PICKEM_PICK_SIDE.AWAY, spread: null }] },
      },
    );
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe(ERROR_CODE.ALREADY_SUBMITTED);

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
    await assertTiedStandings(seasonTable);
    await expect(pageA.getByText(/^Last updated/)).toBeVisible();

    // Weekly board — the only week played, so it matches the season totals.
    await pageA.getByRole("combobox", { name: "View" }).click();
    await pageA.getByRole("option", { name: "Week 1", exact: true }).click();
    const weekTable = pageA.locator('[data-slot="card"]', { hasText: "Standings" }).first();
    await assertTiedStandings(weekTable);

    // Every game is final now, so both members' full picks are revealed.
    const detail = await openLeaguePicks();
    const commishPicks = memberRow(detail, commishName);
    const joinerPicks = memberRow(detail, joinerName);
    await expect(commishPicks.locator("li")).toHaveCount(4);
    await expect(joinerPicks.locator("li")).toHaveCount(4);
    await expect(detail.getByText(/more pick/)).toHaveCount(0);

    // Each pick's grade reaches the UI, and each member's four split two-two —
    // a check mark means precisely "this graded correct", which is why it
    // appears nowhere before a pick settles. `exact` matters: an inexact
    // "Correct" is a case-insensitive substring of "Incorrect".
    for (const member of [commishPicks, joinerPicks]) {
      await expect(member.getByText("Correct", { exact: true })).toHaveCount(2);
      await expect(member.getByText("Incorrect", { exact: true })).toHaveCount(2);
      // Every graded pick pairs its badge with the size of the result — none of
      // these pushed, so all four carry a magnitude (round 5).
      await expect(member.getByText(/^won by \d/)).toHaveCount(2);
      await expect(member.getByText(/^lost by \d/)).toHaveCount(2);
    }

    // The two members graded on the *same* game, which is what the symmetric
    // counts above can't see: they took opposite sides of it, so a pick joined
    // to the wrong member shows up here.
    const openingGame = (member: Locator) => member.locator("li", { hasText: "(MIA @ BUF)" });
    await expect(openingGame(commishPicks).getByText("Correct", { exact: true })).toHaveCount(1);
    await expect(openingGame(joinerPicks).getByText("Incorrect", { exact: true })).toHaveCount(1);

    // Same grades on the member's own week, where the outcome takes the badge
    // slot the in-progress state held before the game finished.
    await pageA.goto(`/leagues/${leagueId}/my-picks`);
    const settledRow = pageA.locator("li", { hasText: "MIA @ BUF" });
    await expect(settledRow.getByText("Correct", { exact: true })).toBeVisible();
    await expect(settledRow.getByText("Locked")).toHaveCount(0);
    // BUF (home) beat MIA (away) 27–17 — named, and in away-home order.
    await expect(settledRow.getByText("MIA 17 – BUF 27")).toBeVisible();
    // The magnitude survives the grade but the provisional *phrasing* must not:
    // the badge above owns the verdict, so the line states only how big the
    // result was (round 5).
    await expect(settledRow.getByText("Your pick: BUF · won by 10")).toBeVisible();
    await expect(settledRow.getByText(/tied|up \d|down \d/)).toHaveCount(0);

    // Still no submit control — the week was frozen from the moment it was
    // submitted and finishing changes nothing about that.
    await expect(submitControl(pageA)).toHaveCount(0);
  });
});
