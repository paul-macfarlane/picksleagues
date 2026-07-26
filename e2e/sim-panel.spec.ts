import { expect, test, type BrowserContext } from "@playwright/test";
import { cleanup, mintSession, uniqueUsername } from "./setup/session";
import { APP_ROLE } from "../packages/schemas/src/app-role";

// Read-only by design. Every mutating sim control (load a scenario, move the
// clock, reset) writes the *environment-wide* `app_state` singleton — the
// simulated now that every other spec's join cutoffs and lock checks resolve
// against. Playwright runs `fullyParallel` against one shared local database
// (playwright.config.ts), so driving those here would silently corrupt the
// suite running beside it. The mutating paths are verified manually through
// the panel instead (SIM-7 report).
// A username is minted too: an unclaimed session is gated to /claim-username
// by the _authed layout, so it would never reach the admin surface at all.
async function signInAsAdmin(context: BrowserContext) {
  const { user, cookieForPlaywright } = await mintSession({
    appRole: APP_ROLE.ADMIN,
    username: uniqueUsername(),
  });
  await context.addCookies([cookieForPlaywright]);
  return user;
}

test.describe("simulator control panel", () => {
  test("an admin reaches the simulator tab and every control card renders", async ({
    page,
    context,
  }) => {
    const user = await signInAsAdmin(context);

    try {
      await page.goto("/admin");

      // The tab is rendered off `me.simEnabled`, so its presence also proves
      // the API reported a sim-enabled environment (.env / CI both set
      // SIM_ENABLED=true). Scoped to the tab bar: SimClockBanner's deep link
      // carries the same accessible name, and it renders whenever the
      // environment happens to have a scenario loaded or a non-zero offset —
      // an unscoped locator would be a strict-mode violation on exactly the
      // machines where someone has been using the simulator.
      const simTab = page
        .getByRole("navigation", { name: "Admin sections" })
        .getByRole("link", { name: "Simulator" });
      await expect(simTab).toBeVisible();
      await simTab.click();
      await expect(page).toHaveURL(/\/admin\/sim$/);

      // `CardTitle` is styled text, not an `<h*>` (components/ui/card.tsx), so
      // these match by text — only the `<h3>` section headings inside the
      // scenarios card carry a heading role.
      await expect(page.getByText("Simulated clock", { exact: true })).toBeVisible();
      await expect(page.getByText("Scenarios", { exact: true })).toBeVisible();
      await expect(page.getByText("Import a replay season", { exact: true })).toBeVisible();
      await expect(page.getByText("Reset", { exact: true })).toBeVisible();

      // The clock card's status block is fed by GET /api/sim/state — proving
      // it rendered proves the whole SPA -> proxy -> admin-gated sim route
      // chain, which is the thing a mock would have hidden (arch D14).
      await expect(page.getByText("Simulated now")).toBeVisible();
      await expect(page.getByText("Offset")).toBeVisible();

      // Every clause of the task has a control: jump/advance the clock, load a
      // scenario, pick a replay season, reset. Asserted by role so this fails
      // if a control silently stops rendering, without pinning copy or counts.
      await expect(page.getByRole("button", { name: "+1 week" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Jump" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Edge-case scenarios" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Load" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Import" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reset environment" })).toBeVisible();
    } finally {
      await cleanup([user.id]);
    }
  });

  test("a non-admin cannot see the simulator route", async ({ page, context }) => {
    const { user, cookieForPlaywright } = await mintSession({ username: uniqueUsername() });
    await context.addCookies([cookieForPlaywright]);

    try {
      // Deep-linked, not navigated: the tab is already invisible to a
      // non-admin, so the guard worth proving is the one on the route itself.
      await page.goto("/admin/sim");
      await expect(page.getByText("Page not found.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Simulated clock" })).toBeHidden();
    } finally {
      await cleanup([user.id]);
    }
  });
});
