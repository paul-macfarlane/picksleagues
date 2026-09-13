import { test, expect } from "@playwright/test";
import { cleanup, signInAs, uniqueUsername } from "./setup/session";
import { json, loadScenario, resetSim, setSimClock } from "./setup/sim";
import { APP_ROLE, LEAGUE_MODE, LEAGUE_VISIBILITY, PICK_TYPE } from "../packages/schemas/src/index";

// Opt-in evidence uses real local ingestion so future opponents cannot be
// supplied by a browser mock that hides an incomplete API read.
test.skip(!process.env.SCHEDULE_CAPTURE && !process.env.REVIEW_CAPTURE, "opt-in schedule evidence");
test("capture matchup schedule in both league modes", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ reducedMotion: "reduce" });
  context.setDefaultTimeout(15_000);
  const user = await signInAs(context, { appRole: APP_ROLE.ADMIN, username: uniqueUsername() });
  try {
    await loadScenario(context, "survivor-season", ["sync-schedule", "sync-odds", "sync-stats"]);
    const leagues: { id: string; mode: string }[] = [];
    for (const mode of [LEAGUE_MODE.SURVIVOR, LEAGUE_MODE.PICKEM]) {
      const league = await json<{ id: string }>(
        context.request.post("/api/leagues", {
          data: {
            mode,
            name: mode === LEAGUE_MODE.SURVIVOR ? "Last One Standing" : "Sunday Regulars",
            visibility: LEAGUE_VISIBILITY.PRIVATE,
            settings:
              mode === LEAGUE_MODE.SURVIVOR
                ? {}
                : { pickType: PICK_TYPE.STRAIGHT_UP, picksPerWeek: 4 },
          },
        }),
      );
      leagues.push({ id: league.id, mode });
    }
    const { weeks } = await json<{ weeks: { id: string; startsAt: string }[] }>(
      context.request.get(`/api/leagues/${leagues[0]!.id}/weeks`),
    );
    const firstSlate = await json<{
      games: { id: string; homeTeam: { id: string; abbreviation: string } }[];
    }>(context.request.get(`/api/weeks/${weeks[0]!.id}/games`));
    const survivorPick = firstSlate.games.find((game) => game.homeTeam.abbreviation === "BUF")!;
    await json(
      context.request.put(`/api/leagues/${leagues[0]!.id}/survivor/weeks/${weeks[0]!.id}/pick`, {
        data: { gameId: survivorPick.id, teamId: survivorPick.homeTeam.id },
      }),
    );
    const { games } = await json<{ games: { kickoffAt: string }[] }>(
      context.request.get(`/api/weeks/${weeks[1]!.id}/games`),
    );
    await setSimClock(context, Date.parse(games[1]!.kickoffAt) + 60 * 60 * 1000);
    await json(context.request.post("/api/admin/jobs/nfl/sync-scores"));
    const page = await context.newPage();
    for (const league of leagues) {
      for (const width of [390, 1024]) {
        for (const colorScheme of ["light", "dark"] as const) {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme });
          await page.goto(`/leagues/${league.id}/my-picks?weekId=${weeks[2]!.id}`);
          await page.getByRole("button", { name: "Matchup stats: DEN @ KC", exact: true }).click();
          const sheet = page.getByRole("dialog");
          await sheet.getByRole("button", { name: /^schedule$/i }).click();
          await expect(page.getByTestId("nfl-matchup-schedule-body")).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          // Let the tab underline transition finish before freezing the frame.
          await page.waitForTimeout(300);
          await page.screenshot({
            path: `test-results/review-screenshots/matchup-schedule/${league.mode}-${width}-${colorScheme}.png`,
          });
        }
      }
    }
  } finally {
    await resetSim(context);
    await cleanup([user.id]);
    await context.close();
  }
});
