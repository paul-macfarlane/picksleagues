import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cleanup, mintSession, uniqueUsername } from "./setup/session";

const USERNAME_ERROR =
  "Username must be 3-20 characters and contain only letters, numbers, and underscores";

// Mints a session and drops it straight into the browser's cookie jar —
// every spec below authenticates this way instead of driving real OAuth
// (there's no headless IdP to drive; see e2e/smoke.spec.ts).
async function signInAs(context: BrowserContext, overrides?: Parameters<typeof mintSession>[0]) {
  const { user, cookieForPlaywright } = await mintSession(overrides);
  await context.addCookies([cookieForPlaywright]);
  return user;
}

async function openAccountMenu(page: Page) {
  await page.getByRole("button", { name: "Open account menu" }).click();
}

test.describe("identity", () => {
  test("unclaimed session is gated to /claim-username; invalid submit errors inline; a valid claim reaches the dashboard", async ({
    page,
    context,
  }) => {
    const username = uniqueUsername();
    const user = await signInAs(context, { username: null });

    try {
      await page.goto("/");
      await expect(page).toHaveURL(/\/claim-username/);

      await page.locator("#username").fill("ab");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.locator("#username-error")).toHaveText(USERNAME_ERROR);

      await page.locator("#username").fill(username);
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(page).toHaveURL("/");
      await openAccountMenu(page);
      await expect(page.getByText(`@${username}`)).toBeVisible();
    } finally {
      await cleanup([user.id]);
    }
  });

  test("preserves the intended destination through the claim-username gate", async ({
    page,
    context,
  }) => {
    const username = uniqueUsername();
    const user = await signInAs(context, { username: null });

    try {
      await page.goto("/profile");
      await expect(page).toHaveURL(/\/claim-username/);
      // ParsedLocation#href (what beforeLoad threads through as `redirect`) is
      // path+search+hash with no origin — assert via URLSearchParams rather
      // than a raw string match so this doesn't depend on the search
      // serializer's encoding choices.
      expect(new URL(page.url()).searchParams.get("redirect")).toBe("/profile");

      await page.locator("#username").fill(username);
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(page).toHaveURL("/profile");
    } finally {
      await cleanup([user.id]);
    }
  });

  test("profile edit: Save gates on a real change, success toasts and updates the account menu, a taken username errors inline", async ({
    page,
    context,
  }) => {
    const newDisplayName = "New Display Name";
    const conflictingUsername = uniqueUsername();

    const user = await signInAs(context, {
      username: uniqueUsername(),
      displayName: "Original Name",
    });
    // Never signed into the browser — only needs to exist so its username is
    // already taken when the first user tries to claim it below.
    const { user: otherUser } = await mintSession({ username: conflictingUsername });

    try {
      await page.goto("/profile");
      const saveButton = page.getByRole("button", { name: "Save changes" });
      await expect(saveButton).toBeDisabled();

      await page.locator("#displayName").fill(newDisplayName);
      await expect(saveButton).toBeEnabled();
      await saveButton.click();

      await expect(page.getByText("Profile updated")).toBeVisible();
      // The form remounts on a fresh server value once the "me" query
      // refetches; disabled-again is the signal that's landed before the
      // next edit.
      await expect(saveButton).toBeDisabled();

      await page.locator("#username").fill(conflictingUsername);
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(page.locator("#username-error")).toHaveText("That username is already taken.");

      await openAccountMenu(page);
      await expect(page.getByText(newDisplayName)).toBeVisible();
    } finally {
      await cleanup([user.id, otherUser.id]);
    }
  });

  test("delete account signs out immediately and the session cannot return", async ({
    page,
    context,
  }) => {
    const user = await signInAs(context, { username: uniqueUsername() });

    try {
      await page.goto("/profile");
      await page.getByRole("button", { name: "Delete account" }).click();

      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Delete account" }).click();

      await expect(page).toHaveURL("/sign-in");

      // Revisit while signed out: `_authed`'s beforeLoad threads the current
      // location through as `?redirect=` (ID-1 deep-link preservation), so
      // match the path rather than an exact "/sign-in" with no query.
      await page.goto("/");
      await expect(page).toHaveURL(/\/sign-in/);
    } finally {
      // Delete-account anonymizes rather than removing the row (mvp-spec
      // §Users & Identity) — cleanup hard-deletes it so runs don't leak rows.
      await cleanup([user.id]);
    }
  });
});
