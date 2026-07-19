import { expect, test } from "@playwright/test";

// Proves the full chain: SPA -> Vite proxy -> Hono API -> generated OpenAPI
// client (arch D14 — no network mocks). The health text only reaches "up"
// once the client's /api/health round trip resolves.
test("home page loads and reports the API as up", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Picks Leagues" })).toBeVisible();
  await expect(page.getByText("API: up")).toBeVisible();
});
