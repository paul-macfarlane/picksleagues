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
// by the _authed layout, so it would never reach the simulator surface at all.
async function signInAsAdmin(context: BrowserContext) {
  const { user, cookieForPlaywright } = await mintSession({
    appRole: APP_ROLE.ADMIN,
    username: uniqueUsername(),
  });
  await context.addCookies([cookieForPlaywright]);
  return user;
}

test.describe("simulator", () => {
  test("an admin reaches the simulator section and every tab renders its cards", async ({
    page,
    context,
  }) => {
    const user = await signInAsAdmin(context);

    try {
      await page.goto("/");

      // The link is rendered off `me.isAdmin && me.simEnabled`, so its presence
      // also proves the API reported a sim-enabled environment (.env / CI both
      // set SIM_ENABLED=true). Scoped to the primary nav: SimClockBanner
      // renders a link with the same accessible name whenever the environment
      // happens to have a scenario loaded or a non-zero offset — an unscoped
      // locator would be a strict-mode violation on exactly the machines where
      // someone has been using the simulator.
      const simNavLink = page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Simulator" });
      await expect(simNavLink).toBeVisible();
      await simNavLink.click();
      await expect(page).toHaveURL(/\/sim$/);

      // The tab bar, scoped to its own labelled nav for the same reason as above.
      const simTabs = page.getByRole("navigation", { name: "Simulator sections" });
      await expect(simTabs.getByRole("link", { name: "Clock" })).toBeVisible();
      await expect(simTabs.getByRole("link", { name: "Scenarios" })).toBeVisible();
      await expect(simTabs.getByRole("link", { name: "Fixtures" })).toBeVisible();
      await expect(simTabs.getByRole("link", { name: "Reset" })).toBeVisible();

      // /sim (Clock tab, default): the clock card's status block is fed by
      // GET /api/sim/state — proving it rendered proves the whole SPA -> proxy
      // -> admin-gated sim route chain, which is the thing a mock would have
      // hidden (arch D14).
      await expect(page.getByText("Simulated now")).toBeVisible();
      await expect(page.getByText("Offset")).toBeVisible();

      // /sim/scenarios: the edge-case library plus the replay importer, both
      // on one page (importing a season is how you get a scenario to load).
      await simTabs.getByRole("link", { name: "Scenarios" }).click();
      await expect(page).toHaveURL(/\/sim\/scenarios$/);
      // `CardTitle` is styled text, not an `<h*>` (components/ui/card.tsx), so
      // these match by text — only the `<h3>` section headings inside the
      // scenarios card carry a heading role.
      await expect(page.getByText("Scenarios", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Edge-case scenarios" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Load" }).first()).toBeVisible();
      await expect(page.getByText("Import a replay season", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Import" })).toBeVisible();

      // /sim/fixtures: renders its card and controls regardless of whether a
      // scenario happens to be loaded in this shared environment — no scenario
      // is loaded here, so this doesn't drive the "load one" path itself.
      await simTabs.getByRole("link", { name: "Fixtures" }).click();
      await expect(page).toHaveURL(/\/sim\/fixtures$/);
      await expect(page.getByText("Fixtures", { exact: true })).toBeVisible();

      // /sim/reset: both destructive controls, asserted by role so this fails
      // if either stops rendering, without pinning the confirmation copy.
      await simTabs.getByRole("link", { name: "Reset" }).click();
      await expect(page).toHaveURL(/\/sim\/reset$/);
      await expect(page.getByText("Reset", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reset league" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reset environment" })).toBeVisible();
    } finally {
      await cleanup([user.id]);
    }
  });

  test("a non-admin cannot see the simulator route", async ({ page, context }) => {
    const { user, cookieForPlaywright } = await mintSession({ username: uniqueUsername() });
    await context.addCookies([cookieForPlaywright]);

    try {
      // Deep-linked, not navigated: the nav link is already invisible to a
      // non-admin, so the guard worth proving is the one on the route itself.
      await page.goto("/sim");
      await expect(page.getByText("Page not found.")).toBeVisible();
      await expect(page.getByText("Simulated now")).toBeHidden();
    } finally {
      await cleanup([user.id]);
    }
  });
});
