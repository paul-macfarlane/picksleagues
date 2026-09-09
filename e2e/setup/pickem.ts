import { expect, type Locator, type Page } from "@playwright/test";

/** Addresses a matchup by its teams on the pick sheet. */
export function gameRow(page: Page, awayAbbr: string, homeAbbr: string): Locator {
  return page.locator(
    `[data-testid="game-row"][data-away-team="${awayAbbr}"][data-home-team="${homeAbbr}"]`,
  );
}

/** Selects a team within its own matchup, even when that team appears in multiple rows. */
export async function selectPick(page: Page, awayAbbr: string, homeAbbr: string, pickAbbr: string) {
  await gameRow(page, awayAbbr, homeAbbr)
    .getByRole("button", { name: new RegExp(`^${pickAbbr}(?:\\s|$)`) })
    .click();
}

/** Resolve only with the dialog closed: its confirmation has the same button name. */
export function submitControl(page: Page): Locator {
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
export async function submitSheet(page: Page) {
  const submit = submitControl(page);
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit picks" }).click();
  await expect(submit).toHaveCount(0);
}
