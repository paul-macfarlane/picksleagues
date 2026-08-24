import { expect, test } from "@playwright/test";
import { cleanup, signInAs, uniqueUsername } from "./setup/session";
import { cleanupFutureSeason, latestInviteCode, seedFutureSeason } from "./setup/league-seed";

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

      // Success lands directly on the new league's home page (Overview tab).
      await expect(pageA).toHaveURL(/\/leagues\/[0-9a-f-]{36}$/);
      const leagueId = new URL(pageA.url()).pathname.split("/").at(-1)!;

      // The roster lives on the Members tab now.
      await pageA.getByRole("link", { name: "Members" }).click();
      await expect(pageA).toHaveURL(new RegExp(`/leagues/${leagueId}/members$`));
      await expect(pageA.getByText(`@${commishName}`)).toBeVisible();

      // The dashboard card links back to it (Overview tab).
      await pageA.goto("/");
      await pageA.getByRole("link", { name: leagueName }).click();
      await expect(pageA).toHaveURL(new RegExp(`/leagues/${leagueId}$`));

      // Commissioner: mint an invite link from the Members tab. The UI only
      // offers copy-to-clipboard (unavailable headless), so the code is read
      // from the DB.
      await pageA.getByRole("link", { name: "Members" }).click();
      await expect(pageA).toHaveURL(new RegExp(`/leagues/${leagueId}/members$`));
      await pageA.getByRole("button", { name: "Create invite link" }).click();
      await expect(pageA.getByRole("button", { name: "Revoke" }).first()).toBeVisible();
      const code = await latestInviteCode(leagueId);

      // Joiner: land on the invite link, see the preview, join.
      const pageB = await contextB.newPage();
      await pageB.goto(`/join/${code}`);
      await expect(pageB.getByText(leagueName)).toBeVisible();
      await pageB.getByRole("button", { name: "Join league" }).click();

      // Joining navigates into the league (Overview tab); both members are on
      // the roster once the Members tab is opened.
      await expect(pageB).toHaveURL(new RegExp(`/leagues/${leagueId}$`));
      await pageB.getByRole("link", { name: "Members" }).click();
      await expect(pageB).toHaveURL(new RegExp(`/leagues/${leagueId}/members$`));
      await expect(pageB.getByText(`@${commishName}`)).toBeVisible();
      await expect(pageB.getByText(`@${joinerName}`)).toBeVisible();

      // And the commissioner sees the join reflected after a reload, still on
      // the Members tab.
      await pageA.reload();
      await expect(pageA.getByText(`@${joinerName}`)).toBeVisible();

      // Dues are off until a commissioner sets an amount (ADR-0045), so no
      // row carries a mark control yet — and no dues surface renders for the
      // member at all (DUES-3).
      const markControl = pageA.getByRole("button", { name: /^Mark (paid|unpaid)$/ });
      await expect(markControl).toHaveCount(0);
      await expect(pageB.getByTestId("dues-amount")).toHaveCount(0);
      await expect(pageB.getByTestId("dues-status")).toHaveCount(0);

      // Commissioner: turn dues on from Settings, then mark the joiner paid.
      await pageA.getByRole("link", { name: "Settings" }).click();
      await pageA.getByLabel("Amount per member (USD)").fill("50");
      await pageA.getByRole("button", { name: "Save dues" }).click();
      await expect(pageA.getByRole("button", { name: "Stop tracking" })).toBeVisible();

      await pageA.getByRole("link", { name: "Members" }).click();
      const joinerRow = pageA.getByRole("listitem").filter({ hasText: `@${joinerName}` });
      await joinerRow.getByRole("button", { name: "Mark paid" }).click();
      await expect(joinerRow.getByRole("button", { name: "Mark unpaid" })).toBeVisible();

      // Persisted, not merely rendered: a fresh load reads the mark back.
      await pageA.reload();
      await expect(joinerRow.getByRole("button", { name: "Mark unpaid" })).toBeVisible();
      await expect(
        pageA
          .getByRole("listitem")
          .filter({ hasText: `@${commishName}` })
          .getByRole("button", { name: "Mark paid" }),
      ).toBeVisible();

      // DUES-3: the non-commissioner member sees the amount, the paid rollup,
      // and each row's status — asserted on the machine value (data-paid), not
      // the pill's word — while the mark control stays commissioner-only.
      await pageB.reload();
      await expect(pageB.getByTestId("dues-amount")).toHaveText("$50");
      await expect(pageB.getByTestId("dues-paid-count")).toHaveText("1 of 2");
      await expect(
        pageB
          .getByRole("listitem")
          .filter({ hasText: `@${joinerName}` })
          .getByTestId("dues-status"),
      ).toHaveAttribute("data-paid", "true");
      await expect(
        pageB
          .getByRole("listitem")
          .filter({ hasText: `@${commishName}` })
          .getByTestId("dues-status"),
      ).toHaveAttribute("data-paid", "false");
      await expect(pageB.getByRole("button", { name: /^Mark (paid|unpaid)$/ })).toHaveCount(0);
    } finally {
      await cleanupFutureSeason();
      await cleanup([commish.id, joiner.id]);
      await contextA.close();
      await contextB.close();
    }
  });
});
