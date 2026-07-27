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
      // The clock's own controls, not just its readout — this is the
      // simulator's primary surface and its buttons could otherwise stop
      // rendering with the suite still green.
      await expect(page.getByRole("button", { name: "+1 week" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Jump" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Back to real time" })).toBeVisible();

      // /sim/scenarios: the edge-case library plus the replay importer, both
      // on one page (importing a season is how you get a scenario to load).
      await simTabs.getByRole("link", { name: "Scenarios" }).click();
      await expect(page).toHaveURL(/\/sim\/scenarios$/);
      // Asserted via the card's own `<h3>`s and controls, never
      // `getByText("Scenarios")`: the tab bar lives in the layout route, so a
      // link with that exact text is mounted on every child page and a bare
      // text locator resolves to two elements. It only *passed* before because
      // it raced the card's mount and matched the tab.
      await expect(page.getByRole("heading", { name: "Edge-case scenarios" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Imported seasons" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Load" }).first()).toBeVisible();
      await expect(page.getByText("Import a replay season", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Import" })).toBeVisible();

      // /sim/fixtures: renders its card and controls regardless of whether a
      // scenario happens to be loaded in this shared environment — no scenario
      // is loaded here, so this doesn't drive the "load one" path itself.
      await simTabs.getByRole("link", { name: "Fixtures" }).click();
      await expect(page).toHaveURL(/\/sim\/fixtures$/);
      // Same collision rule: assert the card's controls, not its title.
      // By id, not label: `SimFixtureRow`'s edit form has a "Week type" select
      // too, so a label locator is 1 match only while every row's <details> is
      // collapsed — the same latent collision this file just fixed elsewhere.
      await expect(page.locator("#sim-fixtures-week-type")).toBeVisible();
      await expect(page.locator("#sim-fixtures-week-number")).toBeVisible();

      // /sim/reset: both destructive controls, asserted by role so this fails
      // if either stops rendering, without pinning the confirmation copy.
      await simTabs.getByRole("link", { name: "Reset" }).click();
      await expect(page).toHaveURL(/\/sim\/reset$/);
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
