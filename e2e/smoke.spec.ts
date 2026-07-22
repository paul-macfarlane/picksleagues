import { expect, test } from "@playwright/test";

// Proves the full chain: SPA -> Vite proxy -> Hono API -> generated OpenAPI
// client (arch D14 — no network mocks). The health text only reaches "up"
// once the client's /api/health round trip resolves. Unauthenticated "/" is
// gated by the `_authed` layout route's beforeLoad, so it redirects to
// /sign-in — real OAuth can't run headlessly with placeholder creds, so the
// signed-in shell is verified by typecheck + manual testing (see FND-11 report).
test("unauthenticated visit redirects to sign-in and reports the API as up", async ({ page }) => {
  await page.goto("/");

  // beforeLoad always threads the current location through as `?redirect=`
  // (ID-1's deep-link preservation, e2e/identity.spec.ts covers the
  // claim-username leg of that) — match the path, not the exact query.
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Picks Leagues" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Discord" })).toBeVisible();
  await expect(page.getByText("API: up")).toBeVisible();
});
