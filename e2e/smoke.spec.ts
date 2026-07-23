import { expect, test } from "@playwright/test";

// Proves the full chain: SPA -> Vite proxy -> Hono API -> generated OpenAPI
// client (arch D14 — no network mocks). Unauthenticated "/" is gated by the
// `_authed` layout route's beforeLoad, so it redirects to /sign-in — real
// OAuth can't run headlessly with placeholder creds, so the signed-in shell
// is verified by typecheck + manual testing (see FND-11 report). The API's
// reachability is asserted directly against the health endpoint rather than
// through UI text (sign-in no longer surfaces a health line).
test("unauthenticated visit redirects to sign-in and the API is reachable", async ({ page }) => {
  await page.goto("/");

  // beforeLoad always threads the current location through as `?redirect=`
  // (ID-1's deep-link preservation, e2e/identity.spec.ts covers the
  // claim-username leg of that) — match the path, not the exact query.
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Picks Leagues" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Discord" })).toBeVisible();

  const res = await page.request.get("/api/health");
  expect(res.ok()).toBe(true);
  await expect(res.json()).resolves.toMatchObject({ status: "ok" });
});
