import { test, type BrowserContext, type Page } from "@playwright/test";
import { cleanup, mintSession, uniqueUsername } from "./setup/session";
import { json, loadScenario, resetSim, setSimClock } from "./setup/sim";
import { latestInviteCode } from "./setup/league-seed";
import {
  APP_ROLE,
  LEAGUE_MODE,
  LEAGUE_VISIBILITY,
  PICKEM_PICK_SIDE,
  PICK_TYPE,
} from "../packages/schemas/src/index";

/**
 * The visual-identity evidence capture (VIS-8): every route at 390px and
 * 1024px in both themes, written to `docs/evidence/test-results/vis-8/`.
 *
 * Opt-in, never part of the merge gate — it asserts nothing, and screenshots
 * are the owner's evidence, not a test's. Run it with
 * `VIS_CAPTURE=1 pnpm test:e2e --grep capture`. It is a `*.sim.spec.ts` because
 * it drives the environment-wide simulated clock through two scenarios, and the
 * `simulated` project is what keeps that serial with the journeys.
 *
 * Every state is arranged through the API, not the SPA: the journeys already
 * prove the screens do their job, and this file only needs the screens to have
 * something on them. The two member states per mode are the ones the audit
 * cares about — before the first kickoff (the pick sheet open, a selection in
 * orange) and fully settled (graded picks, a leader, revealed rivals).
 */
const OUT = process.env.VIS_CAPTURE_OUT ?? "docs/evidence/test-results/vis-8";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Variant = { width: 390 | 1024; scheme: "light" | "dark" };
const VARIANTS: Variant[] = [
  { width: 390, scheme: "light" },
  { width: 390, scheme: "dark" },
  { width: 1024, scheme: "light" },
  { width: 1024, scheme: "dark" },
];

type SlateGame = {
  id: string;
  kickoffAt: string;
  homeTeam: { id: string; abbreviation: string };
  awayTeam: { id: string; abbreviation: string };
};

test.skip(!process.env.VIS_CAPTURE, "opt-in evidence capture; set VIS_CAPTURE=1");

async function shoot(
  page: Page,
  name: string,
  path: string,
  prepare?: (page: Page) => Promise<void>,
) {
  for (const { width, scheme } of VARIANTS) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await prepare?.(page);
    await page.waitForTimeout(400);
    // The tab bar and the pick-sheet action bar are fixed to the viewport, so a
    // full-page capture of a taller page paints them over the content at the
    // 900px mark. Growing the viewport to the document first puts them where
    // a member scrolled to the bottom would see them.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width, height: Math.max(900, height) });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${OUT}/${name}-${width}-${scheme}.png`, fullPage: true });
  }
}

async function slate(ctx: BrowserContext, leagueId: string) {
  const { weeks } = await json<{ weeks: { id: string; label: string; startsAt: string }[] }>(
    ctx.request.get(`/api/leagues/${leagueId}/weeks`),
  );
  const week = weeks[0]!;
  const { games } = await json<{ games: SlateGame[] }>(
    ctx.request.get(`/api/weeks/${week.id}/games`),
  );
  return { week, games };
}

async function settle(admin: BrowserContext, leagueId: string) {
  await json(admin.request.post("/api/admin/jobs/nfl/sync-scores"));
  await json(admin.request.post("/api/sim/settle", { data: { leagueId } }));
}

async function createLeague(ctx: BrowserContext, body: Record<string, unknown>): Promise<string> {
  const league = await json<{ id: string }>(ctx.request.post("/api/leagues", { data: body }));
  return league.id;
}

async function invite(ctx: BrowserContext, leagueId: string): Promise<string> {
  await json(ctx.request.post(`/api/leagues/${leagueId}/invites`));
  return latestInviteCode(leagueId);
}

async function join(ctx: BrowserContext, code: string) {
  await json(ctx.request.post(`/api/join/${code}`));
}

// The All Picks tab is Pick'em's alone; a Survivor league's picks live on
// its board, so the route renders nothing for it and isn't captured.
function leagueRoutes(prefix: string, leagueId: string, allPicks: boolean): [string, string][] {
  return [
    [`${prefix}-home`, `/leagues/${leagueId}`],
    [`${prefix}-my-picks`, `/leagues/${leagueId}/my-picks`],
    ...(allPicks
      ? [[`${prefix}-league-picks`, `/leagues/${leagueId}/league-picks`] as [string, string]]
      : []),
    [`${prefix}-members`, `/leagues/${leagueId}/members`],
    [`${prefix}-settings`, `/leagues/${leagueId}/settings`],
  ];
}

// The matchup stats sheet, opened from a game row's Stats button.
async function openStats(page: Page) {
  await page.getByRole("button", { name: "Stats" }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.waitForLoadState("networkidle");
}

test("capture every route for the VIS-8 coherence audit", async ({ browser }) => {
  test.setTimeout(900_000);
  const adminCtx = await browser.newContext();
  const commishCtx = await browser.newContext();
  const joinerCtx = await browser.newContext();
  const freshCtx = await browser.newContext();

  const commishName = uniqueUsername();
  const joinerName = uniqueUsername();
  const admin = await mintSession({ appRole: APP_ROLE.ADMIN, username: uniqueUsername() });
  const commish = await mintSession({ username: commishName, displayName: "Sam Rivera" });
  const joiner = await mintSession({ username: joinerName, displayName: "Jordan Lee" });
  const fresh = await mintSession({ username: null });
  await adminCtx.addCookies([admin.cookieForPlaywright]);
  await commishCtx.addCookies([commish.cookieForPlaywright]);
  await joinerCtx.addCookies([joiner.cookieForPlaywright]);
  await freshCtx.addCookies([fresh.cookieForPlaywright]);

  const anon = await (await browser.newContext()).newPage();
  const adminPage = await adminCtx.newPage();
  const commishPage = await commishCtx.newPage();
  const joinerPage = await joinerCtx.newPage();
  const freshPage = await freshCtx.newPage();

  try {
    // --- Public and auth surfaces (no league, no clock) ------------------
    for (const [name, path] of [
      ["welcome", "/welcome"],
      ["sign-in", "/sign-in"],
      ["rules-pickem", "/rules/pickem"],
      ["rules-survivor", "/rules/survivor"],
      ["rules-simulator", "/rules/simulator"],
      ["terms", "/terms"],
      ["privacy", "/privacy"],
    ] as const) {
      await shoot(anon, name, path);
    }
    await shoot(freshPage, "claim-username", "/claim-username");
    await shoot(joinerPage, "hub-empty", "/");
    await shoot(joinerPage, "leagues-new", "/leagues/new");
    await shoot(joinerPage, "profile", "/profile");

    // --- Pick'em: mixed-week, pre-kickoff then settled ---------------------
    await loadScenario(adminCtx, "mixed-week", ["sync-schedule", "sync-odds", "sync-stats"]);
    const pickemId = await createLeague(commishCtx, {
      mode: LEAGUE_MODE.PICKEM,
      name: "Sunday Regulars",
      visibility: LEAGUE_VISIBILITY.PUBLIC,
      maxMembers: 10,
      settings: { pickType: PICK_TYPE.STRAIGHT_UP, picksPerWeek: 5 },
    });
    const atsId = await createLeague(commishCtx, {
      mode: LEAGUE_MODE.PICKEM,
      name: "Spread Heads",
      visibility: LEAGUE_VISIBILITY.PRIVATE,
      settings: { pickType: PICK_TYPE.AGAINST_THE_SPREAD, picksPerWeek: 4 },
    });
    const code = await invite(commishCtx, pickemId);
    await shoot(joinerPage, "discovery", "/discovery");
    await shoot(joinerPage, "join", `/join/${code}`);
    await join(joinerCtx, code);

    const { week, games } = await slate(commishCtx, pickemId);
    // The joiner commits the week; the commissioner leaves the sheet open so
    // the pre-kickoff capture shows a selection in orange on an unsubmitted
    // sheet and a rival's picks still hidden.
    await json(
      joinerCtx.request.put(`/api/leagues/${pickemId}/pickem/weeks/${week.id}/picks`, {
        data: { picks: games.map((g) => ({ gameId: g.id, side: PICKEM_PICK_SIDE.HOME })) },
      }),
    );
    await shoot(commishPage, "hub", "/");
    for (const [name, path] of leagueRoutes("pickem-pre", pickemId, true)) {
      await shoot(commishPage, name, path, async (page) => {
        if (!path.endsWith("/my-picks")) return;
        const row = page.locator('[data-testid="game-row"]').first();
        await row.getByRole("button").first().click();
      });
    }
    await shoot(commishPage, "pickem-ats-my-picks", `/leagues/${atsId}/my-picks`);
    await shoot(commishPage, "stats-sheet-pre", `/leagues/${atsId}/my-picks`, openStats);

    // The commissioner submits too, then the whole week plays out.
    await json(
      commishCtx.request.put(`/api/leagues/${pickemId}/pickem/weeks/${week.id}/picks`, {
        data: {
          picks: games.map((g, i) => ({
            gameId: g.id,
            side: i % 2 ? PICKEM_PICK_SIDE.HOME : PICKEM_PICK_SIDE.AWAY,
          })),
        },
      }),
    );
    const lastKickoff = Math.max(...games.map((g) => Date.parse(g.kickoffAt)));
    await setSimClock(adminCtx, lastKickoff + 6 * HOUR_MS);
    await settle(adminCtx, pickemId);
    await shoot(commishPage, "hub-settled", "/");
    await shoot(commishPage, "stats-sheet-settled", `/leagues/${pickemId}/my-picks`, openStats);
    for (const [name, path] of leagueRoutes("pickem-settled", pickemId, true)) {
      await shoot(joinerPage, name, path, async (page) => {
        const summary = page.locator('[data-testid="member-picks-row"] summary').first();
        if (await summary.count()) await summary.click();
      });
    }

    // --- Admin and simulator, on the settled slate ------------------------
    for (const [name, path] of [
      ["admin-jobs", "/admin"],
      ["admin-games", "/admin/games"],
      ["admin-teams", "/admin/teams"],
      ["admin-stats", "/admin/stats"],
      ["admin-audit", "/admin/audit"],
      ["guide", "/guide"],
      ["sim-clock", "/sim"],
      ["sim-scenarios", "/sim/scenarios"],
      ["sim-fixtures", "/sim/fixtures"],
      ["sim-reset", "/sim/reset"],
    ] as const) {
      await shoot(adminPage, name, path);
    }

    // --- Survivor: survivor-season, pre-kickoff then two weeks in ----------
    await loadScenario(adminCtx, "survivor-season", ["sync-schedule", "sync-odds", "sync-stats"]);
    const survivorId = await createLeague(commishCtx, {
      mode: LEAGUE_MODE.SURVIVOR,
      name: "Last One Standing",
      visibility: LEAGUE_VISIBILITY.PRIVATE,
      settings: {},
    });
    await join(joinerCtx, await invite(commishCtx, survivorId));
    const { weeks } = await json<{ weeks: { id: string; startsAt: string }[] }>(
      commishCtx.request.get(`/api/leagues/${survivorId}/weeks`),
    );
    const week1 = weeks[0]!;
    await setSimClock(adminCtx, Date.parse(week1.startsAt) + HOUR_MS);
    const { games: w1 } = await json<{ games: SlateGame[] }>(
      commishCtx.request.get(`/api/weeks/${week1.id}/games`),
    );
    // BUF wins and SF loses in this fixture's first week (see the Survivor
    // journey): the commissioner survives, the joiner goes out.
    const buf = w1.find((g) => g.homeTeam.abbreviation === "BUF")!;
    const sf = w1.find((g) => g.homeTeam.abbreviation === "SF")!;
    await json(
      commishCtx.request.put(`/api/leagues/${survivorId}/survivor/weeks/${week1.id}/pick`, {
        data: { gameId: buf.id, teamId: buf.homeTeam.id },
      }),
    );
    for (const [name, path] of leagueRoutes("survivor-pre", survivorId, false)) {
      await shoot(commishPage, name, path);
    }
    await json(
      joinerCtx.request.put(`/api/leagues/${survivorId}/survivor/weeks/${week1.id}/pick`, {
        data: { gameId: sf.id, teamId: sf.homeTeam.id },
      }),
    );
    await setSimClock(adminCtx, Math.max(...w1.map((g) => Date.parse(g.kickoffAt))) + DAY_MS);
    await settle(adminCtx, survivorId);
    await shoot(joinerPage, "hub-survivor-out", "/");
    for (const [name, path] of leagueRoutes("survivor-settled", survivorId, false)) {
      await shoot(commishPage, name, path);
    }
  } finally {
    await resetSim(adminCtx);
    await cleanup([admin.user.id, commish.user.id, joiner.user.id, fresh.user.id]);
    await Promise.all([adminCtx, commishCtx, joinerCtx, freshCtx].map((c) => c.close()));
  }
});
