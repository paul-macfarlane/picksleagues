import { devices, expect, test, webkit } from "@playwright/test";
import { cleanup, signInAs, uniqueUsername } from "./setup/session";
import { json, loadScenario, resetSim } from "./setup/sim";
import { APP_ROLE, LEAGUE_MODE, LEAGUE_VISIBILITY, PICK_TYPE } from "../packages/schemas/src/index";
import { E2E_BASE_URL } from "./setup/e2e-env";

// Real local data, phone input, and a scrolled sheet. Desktop engines do not
// emulate the collapsing Chrome iOS toolbar; that still needs a physical phone.
test.skip(
  !process.env.BOTTOM_BAR_CAPTURE && !process.env.REVIEW_CAPTURE,
  "opt-in bottom bar evidence",
);
test("capture My Picks bottom bars during scroll", async ({ browser }) => {
  test.setTimeout(120_000);
  const safari = process.env.BOTTOM_BAR_WEBKIT ? await webkit.launch() : undefined;
  const engine = safari ?? browser;
  const admin = await engine.newContext({ baseURL: E2E_BASE_URL });
  const user = await signInAs(admin, { appRole: APP_ROLE.ADMIN, username: uniqueUsername() });
  try {
    await loadScenario(admin, "survivor-season", ["sync-schedule", "sync-odds"]);
    for (const mode of [LEAGUE_MODE.PICKEM, LEAGUE_MODE.SURVIVOR]) {
      const league = await json<{ id: string }>(
        admin.request.post("/api/leagues", {
          data: {
            mode,
            name: "Sunday Regulars",
            visibility: LEAGUE_VISIBILITY.PRIVATE,
            settings:
              mode === LEAGUE_MODE.PICKEM
                ? { pickType: PICK_TYPE.STRAIGHT_UP, picksPerWeek: 1 }
                : {},
          },
        }),
      );
      for (const width of [390, 1024]) {
        for (const colorScheme of ["light", "dark"] as const) {
          const context = await engine.newContext({
            ...(width === 390 ? devices["iPhone 13"] : devices["Desktop Chrome"]),
            viewport: { width, height: 844 },
            baseURL: E2E_BASE_URL,
            colorScheme,
            reducedMotion: "reduce",
            storageState: await admin.storageState(),
          });
          try {
            const page = await context.newPage();
            await page.goto(`/leagues/${league.id}/my-picks`);
            await expect(
              page.getByRole("button", { name: /matchup stats:/i }).first(),
            ).toBeVisible();
            await page.evaluate(() => document.fonts.ready);
            const prefix = `test-results/review-screenshots/bottom-bar/${safari ? "webkit" : "chromium"}-${mode}-${width}-${colorScheme}`;
            // Scroll in both directions, then grow the viewport as a toolbar
            // collapse would. This checks reflow, not native iOS toolbar paint.
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(() => window.scrollBy(0, -180));
            await page.waitForTimeout(250);
            await page.screenshot({ path: `${prefix}-scrolled.png` });
          } finally {
            await context.close();
          }
        }
      }
    }
  } finally {
    await resetSim(admin);
    await cleanup([user.id]);
    await admin.close();
    await safari?.close();
  }
});
