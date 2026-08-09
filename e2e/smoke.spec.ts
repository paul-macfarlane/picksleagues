import { expect, test } from "@playwright/test";

// Proves the full chain: SPA -> Vite proxy -> Hono API -> generated OpenAPI
// client (arch D14 — no network mocks). Unauthenticated "/" is gated by the
// `_authed` layout route's beforeLoad, which sends a bare "/" to the public
// splash (LNCH-11) — real OAuth can't run headlessly with placeholder creds,
// so the signed-in shell is verified by typecheck + manual testing (see
// FND-11 report). The API's reachability is asserted directly against the
// health endpoint rather than through UI text.
test("unauthenticated visit lands on the splash and reaches sign-in; the API is reachable", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { name: "Picks Leagues" })).toBeVisible();

  // The splash's job is to route a visitor onward (LNCH-11): follow its CTA
  // to the real sign-in options.
  await page.getByRole("link", { name: "Sign in to play" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Discord" })).toBeVisible();

  const res = await page.request.get("/api/health");
  expect(res.ok()).toBe(true);
  await expect(res.json()).resolves.toMatchObject({ status: "ok" });
});
