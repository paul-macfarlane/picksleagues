import {
  devices,
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { cleanup, signInAs, uniqueUsername } from "./setup/session";
import { loadScenario, resetSim, setSimClock } from "./setup/sim";
import { latestInviteCode } from "./setup/league-seed";
import {
  APP_ROLE,
  GAME_STATUS,
  PICKEM_PICK_STATUS,
  PICK_OUTCOME,
  type PickOutcome,
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
 * That rule has been applied to this file itself, so what reads as sparseness
 * here is deliberate and adding breadth back needs the same test. What survives
 * is either a cross-stack outcome on the spine — create/join, the submit-once
 * freeze, lock and reveal at kickoff, settlement, standings — or a rule no
 * cheaper layer can hold, the app clock's "Today"/"Tomorrow" reading being the
 * clearest example.
 * Badge slots, disclosure defaults, column counts, `?week=` routing and
 * provisional phrasing were deleted rather than relocated: they are
 * presentation, which the engineering rules leave to the owner's judgement and
 * explicitly decline to freeze in tests.
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
 * ties now share a rank (ADR-0018 decision 4).
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

/**
 * Locators for the contracts the SPA carries for this suite.
 *
 * A row is addressed by *which teams it is between* and a value by *which value
 * it is* — never by the sentence either is printed in. The facelift is free to
 * reword every string on these screens, and a merge gate that fell over when it
 * did would be a veto on the redesign rather than a check on the product. Team
 * abbreviations, week labels and member names are domain data rather than copy,
 * so binding to those is the point and not the exception.
 */
function gameRow(page: Page, awayAbbr: string, homeAbbr: string): Locator {
  return page.locator(
    `[data-testid="game-row"][data-away-team="${awayAbbr}"][data-home-team="${homeAbbr}"]`,
  );
}

// One member's row for one game, inside their section of the league-wide pick
// detail — the join this suite has to check, since a pick attached to the wrong
// member is invisible to any per-member count.
function memberPickFor(member: Locator, awayAbbr: string, homeAbbr: string): Locator {
  return member.locator(
    `[data-testid="member-pick"][data-away-team="${awayAbbr}"][data-home-team="${homeAbbr}"]`,
  );
}

// Graded picks, by the grade settlement actually wrote (`PICK_OUTCOME`) rather
// than by the badge's word for it — which also sidesteps "Correct" being a
// substring of "Incorrect".
function gradedPicks(scope: Locator, outcome: PickOutcome): Locator {
  return scope.locator(`[data-testid="pick-outcome"][data-outcome="${outcome}"]`);
}

// A value element is on screen and carries the data claimed of it — the
// abbreviations and numbers inside the line, never the line.
async function expectValue(value: Locator, ...fragments: (string | RegExp)[]) {
  await expect(value).toBeVisible();
  for (const fragment of fragments) {
    await expect(value).toContainText(fragment);
  }
}

// Selects a pick on the Picks tab, scoped to the game's own row rather than a
// bare team-abbreviation button — the abbreviations happen to be unique across
// this fixture's 8 teams, but scoping is what keeps this correct if that ever
// changes.
async function selectPick(page: Page, awayAbbr: string, homeAbbr: string, pickAbbr: string) {
  await gameRow(page, awayAbbr, homeAbbr)
    .getByRole("button", { name: pickAbbr, exact: true })
    .click();
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

// Members are collapsed by default (e5b7110), so anything asserted as
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
  // tab. Which URL that tab lands on is routing; what matters to every
  // caller below is that the card mounts and that it is the *current* week's,
  // rather than one inherited from whichever surface the member came from.
  async function openLeaguePicks() {
    await pageA.getByRole("link", { name: "All Picks" }).click();
    const detail = pageA.getByTestId("week-picks-card");
    await expect(detail).toBeVisible();
    // The week it opened on — the whole point of the assertion — read off the
    // card's own contract rather than out of its title's phrasing.
    await expect(detail).toHaveAttribute("data-week-label", "Week 1");
    return detail;
  }

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    commishContext = await browser.newContext();
    // The joiner drives the whole journey at phone width with a touch
    // pointer: the pick sheet is where nearly every pick is actually made, so
    // the merge gate proves it reaches Submit under the bottom tab bar (MOB-2)
    // and with `touch-hit`'s coarse-pointer expansion live, not only at the
    // desktop width both projects default to.
    joinerContext = await browser.newContext(devices["iPhone 13"]);

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
    await loadScenario(adminContext, "mixed-week", ["sync-schedule", "sync-odds"]);
  });

  test.afterAll(async () => {
    await resetSim(adminContext);
    await cleanup([adminId, commishId, joinerId]);
    await commishContext.close();
    await joinerContext.close();
    await adminContext.close();
  });

  test("commissioner creates a Pick'em league; a second member joins via invite", async () => {
    const leagueName = `E2E Pickem ${commishName.slice(-8)}`;

    // Fresh user ⇒ the dashboard empty state; its CTA reads "Create a league".
    // Defaults are a Pick'em league — regular season (ADR-0031), Straight Up,
    // 5 picks per week (apps/web/src/routes/_authed/leagues/new.tsx) —
    // exactly the shape this journey needs, so nothing on the form is touched.
    await pageA.goto("/");
    await pageA.getByRole("link", { name: "Create a league" }).click();
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
    // Landing inside the league is the join. That both handles then appear on
    // the Members tab is `e2e/league-lifecycle.spec.ts`'s claim ("create →
    // invite → second user joins → both appear on league home") and asserting
    // it again here would buy a duplicate at the one place wall-clock is
    // scarcest — this file is serial and blocks the whole run. Membership is
    // re-proved far harder below anyway: the joiner submits a week into this
    // league and lands on its standings.
    await expect(pageB).toHaveURL(new RegExp(`/leagues/${leagueId}$`));
  });

  // The one assertion in this file about a *displayed* value rather than a
  // journey outcome, and it earns the browser for a reason the header's rule
  // allows: no cheaper layer can hold it. The book travels sim fixture →
  // `SimulatedProvider` → the `sync-odds` job → `games.spread_source` → the
  // slate DTO → this line, and only the full stack proves that chain end to
  // end. The API halves are pinned in `apps/api/test/pickem-picks.test.ts` and
  // `nfl-sync-odds.test.ts`; the render is presentation, which the engineering
  // rules decline to freeze in a unit test — so this is its only home.
  //
  // A second league because the journey's own is Straight Up, which shows no
  // spread and therefore no credit. Created before the clock advances: the
  // credit is drawn from the *open* games on the pick sheet, and by the end of
  // this file every game is final.
  test("an ATS league names the book behind the spreads it shows", async () => {
    await pageA.goto("/leagues/new");
    await pageA.locator("#name").fill(`E2E ATS ${commishName.slice(-8)}`);
    await pageA.getByRole("radio", { name: "Against the Spread" }).click();
    await pageA.getByRole("button", { name: "Create league" }).click();
    await expect(pageA).toHaveURL(/\/leagues\/[0-9a-f-]{36}$/);
    const atsLeagueId = new URL(pageA.url()).pathname.split("/").at(-1)!;

    await pageA.goto(`/leagues/${atsLeagueId}/my-picks`);
    // Bound to the testid, not the sentence: the wording is the owner's to
    // change, the book's name is the product claim being made.
    await expect(pageA.getByTestId("spread-source-credit")).toContainText("DraftKings");
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
    const submitted = gameRow(pageA, "MIA", "BUF");
    await expect(submitted.getByRole("button", { name: "BUF", exact: true })).toBeDisabled();
    await expect(submitted.getByRole("button", { name: "MIA", exact: true })).toBeDisabled();

    // The dashboard is where a member checks whether they still owe picks
    // without opening the league (PKM-10), and the glance is resolved from the
    // API's clock against the API's slate — so this before/after pair is the
    // only place the whole chain (sim clock → slate → glance → card) is proved.
    // Bound to the machine state, never the pill's copy. The joiner rather than
    // the commissioner because this is their only league, so the card the
    // assertion lands on isn't in question.
    await pageB.goto("/");
    await expect(pageB.getByTestId("pickem-pick-status")).toHaveAttribute(
      "data-status",
      PICKEM_PICK_STATUS.PICKS_NEEDED,
    );

    // Joiner: the exact opposite side of all four — at phone width, with the
    // tab bar on screen the whole time (MOB-2: the action bar stacks above it,
    // never replaces it).
    await pageB.goto(`/leagues/${leagueId}/my-picks`);
    await expect(pageB.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await selectPick(pageB, "MIA", "BUF", "MIA");
    await selectPick(pageB, "DEN", "KC", "KC");
    await selectPick(pageB, "PHI", "DAL", "DAL");
    await selectPick(pageB, "SEA", "SF", "SF");
    await submitSheet(pageB);
    await expect(pageB.getByRole("navigation", { name: "Primary" })).toBeVisible();

    // One irreversible submission (ADR-0018), so the same glance now reads as
    // the week being done rather than as one pick among several still to make.
    await pageB.goto("/");
    await expect(pageB.getByTestId("pickem-pick-status")).toHaveAttribute(
      "data-status",
      PICKEM_PICK_STATUS.PICKS_IN,
    );
  });

  test("before kickoff, another member's picks are hidden behind a count", async () => {
    await pageA.goto(`/leagues/${leagueId}`);
    // Nothing has settled yet — the season board's own "never been written"
    // state, read off the stamp's contract rather than its sentence. The
    // "written" half is asserted after settlement runs, and this is what stops
    // that one passing against a board that was never blank to begin with.
    await expect(pageA.getByTestId("standings-updated-at")).toHaveAttribute(
      "data-settled",
      "false",
    );

    const detail = await openLeaguePicks();

    // The weekly leaderboard carries the same stamp (PKM-12), read the same
    // way — its "written" half is likewise asserted after settlement runs.
    await expect(detail.getByTestId("week-standings-updated-at")).toHaveAttribute(
      "data-settled",
      "false",
    );

    // The viewer's own submission comes back attached to them, with nothing
    // withheld from them. Counting locators read the DOM rather than the
    // screen, so a member collapsed by default still measures what was
    // rendered — which is why nothing here expands the viewer's own row.
    const own = memberRow(detail, commishName);
    await expect(own.getByTestId("member-pick")).toHaveCount(4);
    await expect(own.getByTestId("hidden-pick-count")).toHaveCount(0);

    const other = await expandMember(detail, joinerName);
    // The count is the value; the sentence around it is copy.
    await expectValue(other.getByTestId("hidden-pick-count"), /\b4\b/);
    await expect(other.getByTestId("member-pick")).toHaveCount(0);
  });

  test("past one kickoff: that pick locks, is revealed, and the week refuses a second submission", async () => {
    // Open the week *before* the kickoff, so the screen has to absorb the lock
    // without a remount — the position a member is in whenever they leave the
    // picks tab open through a Sunday.
    await pageA.goto(`/leagues/${leagueId}/my-picks`);
    await expect(gameRow(pageA, "MIA", "BUF")).toBeVisible();

    await setSimClock(adminContext, new Date(game1.kickoffAt).getTime() + 60_000);

    // Pull the started game's live state through, so the row renders what a
    // member actually sees mid-Sunday rather than a still-"Scheduled" row that
    // happens to be locked.
    await adminContext.request.post("/api/admin/jobs/nfl/sync-scores");

    await tabAwayAndBack(pageA);

    // The kicked-off game's new state reaches an already-open screen: simulated
    // clock → sync job → Postgres → API → refetch, with no remount anywhere in
    // that chain. Which badge a started game takes is presentation; that the
    // row now reads as *in progress* is the fact the rest of this test stands
    // on; the refusal behind it is pinned in apps/api/test/pickem-picks.test.ts.
    const lockedRow = gameRow(pageA, "MIA", "BUF");
    await expect(lockedRow.getByTestId("game-status")).toHaveAttribute(
      "data-status",
      GAME_STATUS.IN_PROGRESS,
    );

    // Read the rest only *after* the row above proves the new slate has landed.
    // The refetch is asynchronous, so asserting straight after the visibility
    // event would pass against the pre-refetch render every time — green for
    // the wrong reason.
    //
    // Kickoffs read relative to the *app* clock (arch D13), not the browser's.
    // This is the assertion that tells the two apart: simulated time has jumped
    // three days ahead, so the last game is ~12h away — zero or one local day
    // out — while a browser-clock label would still put it three days out.
    // Bound to the day count the label is worded from, never to the wording.
    await expect(gameRow(pageA, "SEA", "SF").getByTestId("game-state")).toHaveAttribute(
      "data-kickoff-days",
      /^[01]$/,
    );

    // The week is still frozen mid-Sunday: immutability is a property of having
    // submitted, not of the games locking, and a refetch must not hand any of
    // it back.
    await expect(submitControl(pageA)).toHaveCount(0);

    // Visibility: the joiner's pick on the now-kicked-off game is revealed to
    // the commissioner; their other three picks (still unstarted) are not.
    await pageA.goto(`/leagues/${leagueId}`);
    const detail = await openLeaguePicks();
    const other = await expandMember(detail, joinerName);
    await expectValue(other.getByTestId("hidden-pick-count"), /\b3\b/);
    await expect(other.getByTestId("member-pick")).toHaveCount(1);
    await expect(other.getByTestId("member-pick")).toHaveAttribute("data-picked-team", "MIA");
  });

  test("after every game goes final, settlement produces the expected standings", async () => {
    // Past every game's final threshold (kickoff + 3h15m, docs/simulator-guide.md
    // "How a fixture becomes a status") — game4 kicks off latest, so its
    // threshold is the binding one.
    await setSimClock(
      adminContext,
      new Date(game4.kickoffAt).getTime() + (3 * 60 + 16) * 60 * 1000,
    );
    await adminContext.request.post("/api/admin/jobs/nfl/sync-scores");
    // Not load-bearing (nfl-sync-scores already settles a game's picks as it
    // goes final) — a full rebuild-and-inspect for extra confidence, and to
    // exercise the endpoint this journey's `deps` name (SIM-5).
    const settled = await adminContext.request.post("/api/sim/settle", { data: { leagueId } });
    expect(settled.ok()).toBe(true);

    /**
     * The journey's payoff, on the season-cumulative board (the default view):
     * both members level after a real settlement, sharing a rank with the same
     * record and points (ADR-0018 decision 4).
     *
     * Addressed by role and testid rather than by column index — the cells
     * carry no accessible name of their own, so `pickem-standings-table.tsx`
     * states the contract explicitly instead of letting a `td` position stand
     * in for it. How many columns the board has is layout, and is pinned
     * nowhere on purpose.
     *
     * Only this board is read. The weekly one carries identical numbers here
     * (one week played), so asserting it too could not tell a weekly board from
     * a season one; that distinction is pinned where it can actually fail, in
     * `apps/api/test/pickem-standings.test.ts` ("weekly board carries only that
     * week's points, while the season board sums across weeks").
     */
    await pageA.goto(`/leagues/${leagueId}`);
    const seasonTable = pageA.getByTestId("standings-card");
    for (const name of [commishName, joinerName]) {
      const row = seasonTable.getByRole("row").filter({ hasText: name });
      await expect(row.getByTestId("standings-rank")).toHaveText("T-1");
      await expect(row.getByTestId("standings-record")).toHaveText("2-2-0");
      await expect(row.getByTestId("standings-points")).toHaveText("2");
    }
    // The board has been written now — the stamp's fact, not its wording.
    await expect(pageA.getByTestId("standings-updated-at")).toHaveAttribute("data-settled", "true");

    // Every game is final now, so both members' full picks are revealed.
    const detail = await openLeaguePicks();
    // The weekly leaderboard's stamp reports written too (PKM-12).
    await expect(detail.getByTestId("week-standings-updated-at")).toHaveAttribute(
      "data-settled",
      "true",
    );
    const commishPicks = memberRow(detail, commishName);
    const joinerPicks = memberRow(detail, joinerName);
    await expect(commishPicks.getByTestId("member-pick")).toHaveCount(4);
    await expect(joinerPicks.getByTestId("member-pick")).toHaveCount(4);
    await expect(detail.getByTestId("hidden-pick-count")).toHaveCount(0);

    // Each pick's grade reaches the UI, and each member's four split two-two —
    // a badge means precisely "this graded", which is why none appears before a
    // pick settles. Addressed by the grade itself rather than by its word, so
    // relabelling the badge can't fail this.
    for (const member of [commishPicks, joinerPicks]) {
      await expect(gradedPicks(member, PICK_OUTCOME.CORRECT)).toHaveCount(2);
      await expect(gradedPicks(member, PICK_OUTCOME.INCORRECT)).toHaveCount(2);
    }

    // The two members graded on the *same* game, which is what the symmetric
    // counts above can't see: they took opposite sides of it, so a pick joined
    // to the wrong member shows up here.
    const openingGame = (member: Locator) => memberPickFor(member, "MIA", "BUF");
    await expect(gradedPicks(openingGame(commishPicks), PICK_OUTCOME.CORRECT)).toHaveCount(1);
    await expect(gradedPicks(openingGame(joinerPicks), PICK_OUTCOME.INCORRECT)).toHaveCount(1);

    // The same settled grade on the member's *own* week — a second surface,
    // fed by a different query, and the one the member actually returns to. On
    // this game BUF won, so a `correct` grade here is also what identifies the
    // side they hold as having survived the lock.
    await pageA.goto(`/leagues/${leagueId}/my-picks`);
    const settledRow = gameRow(pageA, "MIA", "BUF");
    await expect(settledRow.getByTestId("pick-outcome")).toHaveAttribute(
      "data-outcome",
      PICK_OUTCOME.CORRECT,
    );
    // The final score reaches the row it belongs to. Each number is named by
    // its own team, so this never depends on knowing that the away side comes
    // first (spec §UI conventions).
    await expectValue(settledRow.getByTestId("game-state"), "MIA 17", "BUF 27");
  });
});
