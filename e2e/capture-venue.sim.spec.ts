import { test, expect } from "@playwright/test";
import { cleanup, signInAs, uniqueUsername } from "./setup/session";
import { json, loadScenario, resetSim } from "./setup/sim";
import { APP_ROLE, LEAGUE_MODE, LEAGUE_VISIBILITY, PICK_TYPE } from "../packages/schemas/src/index";

// Opt-in evidence for FB-46: both pick sheets before kickoff, where `mixed-week`
// plays DEN vs KC at a neutral site and the other three games at home, plus the
// neutral-site game's Stats sheet naming its venue.
test.skip(!process.env.VENUE_CAPTURE && !process.env.REVIEW_CAPTURE, "opt-in venue evidence");
test("capture matchup venue on both pick sheets", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ reducedMotion: "reduce" });
  context.setDefaultTimeout(15_000);
  const user = await signInAs(context, { appRole: APP_ROLE.ADMIN, username: uniqueUsername() });
  try {
    await loadScenario(context, "mixed-week", ["sync-schedule", "sync-odds", "sync-stats"]);
    const leagues: { id: string; mode: string }[] = [];
    for (const mode of [LEAGUE_MODE.PICKEM, LEAGUE_MODE.SURVIVOR]) {
      const league = await json<{ id: string }>(
        context.request.post("/api/leagues", {
          data: {
            mode,
            name: mode === LEAGUE_MODE.SURVIVOR ? "Last One Standing" : "Sunday Regulars",
            visibility: LEAGUE_VISIBILITY.PRIVATE,
            settings:
              mode === LEAGUE_MODE.SURVIVOR
                ? {}
                : { pickType: PICK_TYPE.AGAINST_THE_SPREAD, picksPerWeek: 4 },
          },
        }),
      );
      leagues.push({ id: league.id, mode });
    }

    const page = await context.newPage();
    const dir = "test-results/review-screenshots/matchup-venue";
    for (const league of leagues) {
      for (const width of [390, 1024]) {
        for (const colorScheme of ["light", "dark"] as const) {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme });
          await page.goto(`/leagues/${league.id}/my-picks`);
          const venue = page.getByTestId("game-venue");
          await expect(venue).toBeVisible();
          // Viewport, not full-page: the sticky action and tab bars would
          // paint over the rows in a stitched capture at phone width, and
          // `scrollIntoViewIfNeeded` counts a row behind them as in view.
          await venue.evaluate((el) => el.closest("li")?.scrollIntoView({ block: "center" }));
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({
            path: `${dir}/${league.mode}-sheet-${width}-${colorScheme}.png`,
          });
          if (league.mode !== LEAGUE_MODE.PICKEM) continue;
          await page.getByRole("button", { name: "Matchup stats: DEN vs KC", exact: true }).click();
          await expect(page.getByTestId("nfl-matchup-venue")).toBeVisible();
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${dir}/stats-sheet-${width}-${colorScheme}.png` });
        }
      }
    }
  } finally {
    await resetSim(context);
    await cleanup([user.id]);
    await context.close();
  }
});
