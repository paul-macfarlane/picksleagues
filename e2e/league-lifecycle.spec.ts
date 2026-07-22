import { expect, test, type BrowserContext } from "@playwright/test";
import { cleanup, mintSession, uniqueUsername } from "./setup/session";
import { cleanupFutureSeason, latestInviteCode, seedFutureSeason } from "./setup/league-seed";

async function signInAs(context: BrowserContext, overrides?: Parameters<typeof mintSession>[0]) {
  const { user, cookieForPlaywright } = await mintSession(overrides);
  await context.addCookies([cookieForPlaywright]);
  return user;
}

test.describe("league lifecycle", () => {
  test("create → invite → second user joins → both appear on league home", async ({ browser }) => {
    await seedFutureSeason();
    const leagueName = `E2E League ${uniqueUsername().slice(-8)}`;

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const commishName = uniqueUsername();
    const joinerName = uniqueUsername();
    const commish = await signInAs(contextA, { username: commishName });
    const joiner = await signInAs(contextB, { username: joinerName });

    try {
      // Commissioner: create the league (Pick'em defaults) from the dashboard.
      const pageA = await contextA.newPage();
      await pageA.goto("/");
      // Fresh user ⇒ the dashboard empty state; its CTA reads "Create a league".
      await pageA.getByRole("link", { name: "Create a league" }).click();
      await expect(pageA).toHaveURL(/\/leagues\/new/);
      await pageA.locator("#name").fill(leagueName);
      await pageA.getByRole("button", { name: "Create league" }).click();

      // Success navigates to the dashboard; the new card links to league home.
      await expect(pageA).toHaveURL("/");
      await pageA.getByRole("link", { name: leagueName }).click();
      await expect(pageA).toHaveURL(/\/leagues\/[0-9a-f-]{36}$/);
      const leagueId = new URL(pageA.url()).pathname.split("/").at(-1)!;
      await expect(pageA.getByText(`@${commishName}`)).toBeVisible();

      // Commissioner: mint an invite link. The UI only offers copy-to-
      // clipboard (unavailable headless), so the code is read from the DB.
      await pageA.getByRole("button", { name: "Create invite link" }).click();
      await expect(pageA.getByRole("button", { name: "Revoke" }).first()).toBeVisible();
      const code = await latestInviteCode(leagueId);

      // Joiner: land on the invite link, see the preview, join.
      const pageB = await contextB.newPage();
      await pageB.goto(`/join/${code}`);
      await expect(pageB.getByText(leagueName)).toBeVisible();
      await pageB.getByRole("button", { name: "Join league" }).click();

      // Joining navigates into the league; both members are on the roster.
      await expect(pageB).toHaveURL(new RegExp(`/leagues/${leagueId}$`));
      await expect(pageB.getByText(`@${commishName}`)).toBeVisible();
      await expect(pageB.getByText(`@${joinerName}`)).toBeVisible();

      // And the commissioner sees the join reflected after a reload.
      await pageA.reload();
      await expect(pageA.getByText(`@${joinerName}`)).toBeVisible();
    } finally {
      await cleanupFutureSeason();
      await cleanup([commish.id, joiner.id]);
      await contextA.close();
      await contextB.close();
    }
  });
});
