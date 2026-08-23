import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminAudit, teams, weeks } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  WEEK_TYPE,
  type AdminTeamsResponse,
  type TeamIdentityOverrideRequest,
  type TeamIdentityOverrideResponse,
  type WeekSlateResponse,
} from "@picksleagues/schemas";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import { StatsFakeProvider } from "./setup/fake-provider";
import { providerGame, providerWeek } from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { makeFixedAppHarness, withCookie } from "./setup/fixed-app";

/**
 * Team identity overrides (STAT-8, ADR-0042): the override write with its
 * same-transaction audit row, and the properties the ADR promises — every
 * identity read resolving `override_* ?? provider_*` through the one home
 * (member slate and admin browser alike), a re-sync that can't clobber a
 * correction, and clean full-clear revert (arch D15).
 */

const SEASON_YEAR = 2026;
const seedClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
const nowClock = new FixedClock(new Date("2026-09-12T00:00:00.000Z"));

const provider = new StatsFakeProvider();
const { db, auth, appAt } = makeFixedAppHarness();
const app = appAt(nowClock.now(), { provider: async () => provider });

/** One week, one HOM/AWY game — enough to exercise every identity read. */
async function seedSchedule() {
  provider.structure = {
    seasonYear: SEASON_YEAR,
    weeks: [providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z")],
  };
  provider.gamesByWeek = new Map([
    [
      StatsFakeProvider.weekKey(WEEK_TYPE.REGULAR, 1),
      [
        providerGame({
          providerGameId: "g1",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        }),
      ],
    ],
  ]);
  await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
  const [homeTeam] = await db.select().from(teams).where(eq(teams.providerTeamId, "hom-id"));
  const [week] = await db.select({ id: weeks.id }).from(weeks);
  return { homeTeamId: homeTeam!.id, weekId: week!.id };
}

async function putOverride(teamId: string, body: TeamIdentityOverrideRequest, cookie?: string) {
  return app.request(`/api/admin/teams/${teamId}/override`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb(db);
  provider.structure = { seasonYear: SEASON_YEAR, weeks: [] };
  provider.gamesByWeek = new Map();
});

afterAll(async () => {
  await db.$client.end();
});

describe("PUT /api/admin/teams/{teamId}/override", () => {
  it("401s with no session and 403s without the admin role", async () => {
    const { homeTeamId } = await seedSchedule();
    expect((await putOverride(homeTeamId, { name: "X" })).status).toBe(401);

    const { cookie } = await createAuthenticatedUser(auth);
    expect((await putOverride(homeTeamId, { name: "X" }, cookie)).status).toBe(403);
  });

  it("404s for an unknown team and 400s on an empty patch", async () => {
    await seedSchedule();
    const { cookie, user } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);

    const missing = await putOverride(
      "00000000-0000-4000-8000-000000000000",
      { name: "X" },
      cookie,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "team_not_found" });

    expect((await putOverride("00000000-0000-4000-8000-000000000000", {}, cookie)).status).toBe(
      400,
    );
  });

  it("writes the override layer with its audit row, and every identity read serves the resolved values", async () => {
    const { homeTeamId, weekId } = await seedSchedule();
    const { cookie, user } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);

    const res = await putOverride(
      homeTeamId,
      {
        name: "Corrected Team",
        abbreviation: "COR",
        location: "Correctville",
        logoLightUrl: "https://example.com/cor-light.png",
        logoDarkUrl: "https://example.com/cor.png",
      },
      cookie,
    );
    expect(res.status).toBe(200);
    const { team } = (await res.json()) as TeamIdentityOverrideResponse;
    expect(team).toMatchObject({
      name: "Home Team",
      abbreviation: "HOM",
      overrideName: "Corrected Team",
      overrideAbbreviation: "COR",
      effectiveName: "Corrected Team",
      effectiveAbbreviation: "COR",
      effectiveLocation: "Correctville",
      effectiveLogoLightUrl: "https://example.com/cor-light.png",
      effectiveLogoDarkUrl: "https://example.com/cor.png",
      overriddenBy: user.id,
    });

    // Audit row in the same transaction, prior value = the pre-write override
    // layer (empty here).
    const [audit] = await db.select().from(adminAudit);
    expect(audit).toMatchObject({
      adminUserId: user.id,
      action: ADMIN_AUDIT_ACTION.TEAM_IDENTITY_OVERRIDE,
      targetTable: ADMIN_AUDIT_TARGET_TABLE.TEAMS,
      targetId: homeTeamId,
      priorValue: { overrideName: null, overrideAbbreviation: null, overriddenBy: null },
    });

    // The member slate — the read every pick surface consumes — serves the
    // corrected identity (the ADR-0042 single-home promise). Every one of the
    // five fields is asserted, because the slate reads them through the SQL
    // coalesce helper: a transposed column pair there would ship green if
    // only the JS resolver's fields were pinned.
    const slateRes = await app.request(`/api/weeks/${weekId}/games`, { headers: { cookie } });
    expect(slateRes.status).toBe(200);
    const slate = (await slateRes.json()) as WeekSlateResponse;
    expect(slate.games[0]!.homeTeam).toMatchObject({
      abbreviation: "COR",
      name: "Corrected Team",
      location: "Correctville",
      logoLightUrl: "https://example.com/cor-light.png",
      logoDarkUrl: "https://example.com/cor.png",
    });
    expect(slate.games[0]!.awayTeam).toMatchObject({ abbreviation: "AWY" });

    // The admin browser shows all three layers.
    const listRes = await app.request("/api/admin/teams?sport=nfl", { headers: { cookie } });
    const list = (await listRes.json()) as AdminTeamsResponse;
    const listed = list.teams.find((t) => t.id === homeTeamId)!;
    expect(listed).toMatchObject({ abbreviation: "HOM", effectiveAbbreviation: "COR" });
  });

  it("survives a re-sync — ingestion writes only provider columns", async () => {
    const { homeTeamId, weekId } = await seedSchedule();
    const { cookie, user } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    await putOverride(homeTeamId, { abbreviation: "COR" }, cookie);

    await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });

    const slateRes = await app.request(`/api/weeks/${weekId}/games`, { headers: { cookie } });
    const slate = (await slateRes.json()) as WeekSlateResponse;
    expect(slate.games[0]!.homeTeam.abbreviation).toBe("COR");
  });

  it("clears back to provider truth: a fully-cleared row is indistinguishable from one never corrected", async () => {
    const { homeTeamId } = await seedSchedule();
    const { cookie, user } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    await putOverride(homeTeamId, { name: "Corrected Team", abbreviation: "COR" }, cookie);

    const res = await putOverride(homeTeamId, { name: null, abbreviation: null }, cookie);
    const { team } = (await res.json()) as TeamIdentityOverrideResponse;
    expect(team).toMatchObject({
      overrideName: null,
      overrideAbbreviation: null,
      overriddenBy: null,
      overriddenAt: null,
      effectiveName: "Home Team",
      effectiveAbbreviation: "HOM",
    });
  });
});
