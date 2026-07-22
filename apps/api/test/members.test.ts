import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, leagueMembers, leagues, leagueSettings, users } from "@picksleagues/db";
import { FixedClock, type Env } from "@picksleagues/core";
import { LEAGUE_STATUS, MEMBER_ROLE, type LeagueResponse } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, seedSeason } from "./setup/league-helpers";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";

const testEnv: Env = {
  APP_ENV: "local",
  DATABASE_URL: getTestDatabaseUrl(),
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  DISCORD_CLIENT_ID: "discord-id",
  DISCORD_CLIENT_SECRET: "discord-secret",
  JOB_SECRET: "b".repeat(32),
  ADMIN_USER_IDS: [],
};

const WEEK1_KICKOFF = new Date("2026-09-13T17:00:00.000Z");
const PRE_START_NOW = new Date("2026-09-01T00:00:00.000Z");
const POST_START_NOW = new Date("2026-09-13T17:00:00.001Z");

const db = createDb(getTestDatabaseUrl());
const auth = createAuth({ env: testEnv, db });
const app = createApp({ auth, db, clock: async () => new FixedClock(PRE_START_NOW) });
const appAfterKickoff = createApp({ auth, db, clock: async () => new FixedClock(POST_START_NOW) });

type App = typeof app;

function withCookie(cookie: string | undefined): Record<string, string> {
  return cookie ? { cookie } : {};
}

function patchLeague(
  cookie: string | undefined,
  leagueId: string,
  body: Record<string, unknown>,
  on: App = app,
) {
  return on.request(`/api/leagues/${leagueId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify(body),
  });
}

function deleteLeagueReq(cookie: string | undefined, leagueId: string, on: App = app) {
  return on.request(`/api/leagues/${leagueId}`, { method: "DELETE", headers: withCookie(cookie) });
}

function patchMember(
  cookie: string | undefined,
  leagueId: string,
  memberId: string,
  role: string,
  on: App = app,
) {
  return on.request(`/api/leagues/${leagueId}/members/${memberId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify({ role }),
  });
}

function kickMemberReq(
  cookie: string | undefined,
  leagueId: string,
  memberId: string,
  on: App = app,
) {
  return on.request(`/api/leagues/${leagueId}/members/${memberId}`, {
    method: "DELETE",
    headers: withCookie(cookie),
  });
}

function leaveReq(cookie: string | undefined, leagueId: string, on: App = app) {
  return on.request(`/api/leagues/${leagueId}/members/me`, {
    method: "DELETE",
    headers: withCookie(cookie),
  });
}

function deleteMe(cookie: string | undefined) {
  return app.request("/api/me", { method: "DELETE", headers: withCookie(cookie) });
}

async function membershipOf(leagueId: string, userId: string) {
  const rows = await db.select().from(leagueMembers).where(eq(leagueMembers.userId, userId));
  return rows.find((r) => r.leagueId === leagueId) ?? null;
}

async function seedLeague() {
  const { seasonId } = await seedSeason(db, {
    year: 2026,
    weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
  });
  const commish = await createAuthenticatedUser(auth, { username: "commish" });
  const member = await createAuthenticatedUser(auth, { username: "plain_member" });
  const league = await insertLeague(db, {
    seasonId,
    members: [
      { userId: commish.user.id, role: MEMBER_ROLE.COMMISSIONER },
      { userId: member.user.id, role: MEMBER_ROLE.MEMBER },
    ],
  });
  return { seasonId, commish, member, league };
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("PATCH /api/leagues/:leagueId", () => {
  it("renames anytime — including after the league has started", async () => {
    const { commish, league } = await seedLeague();
    const res = await patchLeague(commish.cookie, league.id, { name: "Renamed" }, appAfterKickoff);
    expect(res.status).toBe(200);
    expect(((await res.json()) as LeagueResponse).name).toBe("Renamed");
  });

  it("changes visibility and settings pre-start", async () => {
    const { commish, league } = await seedLeague();
    const res = await patchLeague(commish.cookie, league.id, {
      visibility: "public",
      settings: {
        startWeek: { type: "regular", number: 2 },
        endWeek: { type: "regular", number: 10 },
        pickType: "against_the_spread",
        picksPerWeek: 3,
        pushTieResolution: "zero_points",
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeagueResponse;
    expect(body.visibility).toBe("public");
    expect(body.settings).toMatchObject({ picksPerWeek: 3, pickType: "against_the_spread" });
  });

  it("409s visibility/settings edits after start", async () => {
    const { commish, league } = await seedLeague();
    const res = await patchLeague(
      commish.cookie,
      league.id,
      { visibility: "public" },
      appAfterKickoff,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "league_started" });
  });

  it("400s settings that fail the league's mode schema", async () => {
    const { commish, league } = await seedLeague();
    const res = await patchLeague(commish.cookie, league.id, {
      settings: { scoringModel: "standard_doubling" }, // MM settings on a pickem league
    });
    expect(res.status).toBe(400);
  });

  it("403s a plain member and 404s a non-member", async () => {
    const { member, league } = await seedLeague();
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });
    expect((await patchLeague(member.cookie, league.id, { name: "X" })).status).toBe(403);
    expect((await patchLeague(outsider.cookie, league.id, { name: "X" })).status).toBe(404);
  });

  it("400s an empty update", async () => {
    const { commish, league } = await seedLeague();
    expect((await patchLeague(commish.cookie, league.id, {})).status).toBe(400);
  });
});

describe("DELETE /api/leagues/:leagueId", () => {
  it("deletes pre-start and cascades settings/members/invites", async () => {
    const { commish, league } = await seedLeague();
    const res = await deleteLeagueReq(commish.cookie, league.id);
    expect(res.status).toBe(204);
    expect(await db.select().from(leagues).where(eq(leagues.id, league.id))).toHaveLength(0);
    expect(
      await db.select().from(leagueSettings).where(eq(leagueSettings.leagueId, league.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(leagueMembers).where(eq(leagueMembers.leagueId, league.id)),
    ).toHaveLength(0);
  });

  it("409s after the league has started", async () => {
    const { commish, league } = await seedLeague();
    const res = await deleteLeagueReq(commish.cookie, league.id, appAfterKickoff);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "league_started" });
  });

  it("403s a plain member", async () => {
    const { member, league } = await seedLeague();
    expect((await deleteLeagueReq(member.cookie, league.id)).status).toBe(403);
  });
});

describe("PATCH /api/leagues/:leagueId/members/:memberId", () => {
  it("promotes a member to commissioner — anytime, even post-start", async () => {
    const { commish, member, league } = await seedLeague();
    const target = await membershipOf(league.id, member.user.id);
    const res = await patchMember(
      commish.cookie,
      league.id,
      target!.id,
      "commissioner",
      appAfterKickoff,
    );
    expect(res.status).toBe(204);
    expect((await membershipOf(league.id, member.user.id))?.role).toBe("commissioner");
  });

  it("409s a promotion past the recipient's cap and rolls it back", async () => {
    const { seasonId, commish, member, league } = await seedLeague();
    for (let i = 0; i < 10; i++) {
      await insertLeague(db, {
        seasonId,
        name: `Cap League ${i}`,
        members: [{ userId: member.user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
    }
    const target = await membershipOf(league.id, member.user.id);
    const res = await patchMember(commish.cookie, league.id, target!.id, "commissioner");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "cap_exceeded" });
    expect((await membershipOf(league.id, member.user.id))?.role).toBe("member");
  });

  it("demotes a co-commissioner while at least one remains", async () => {
    const { commish, member, league } = await seedLeague();
    const target = await membershipOf(league.id, member.user.id);
    await patchMember(commish.cookie, league.id, target!.id, "commissioner");

    // The original commissioner steps down (self-demote) — allowed, one remains.
    const self = await membershipOf(league.id, commish.user.id);
    const res = await patchMember(commish.cookie, league.id, self!.id, "member");
    expect(res.status).toBe(204);
    expect((await membershipOf(league.id, commish.user.id))?.role).toBe("member");
  });

  it("409s demoting the last commissioner and rolls it back", async () => {
    const { commish, league } = await seedLeague();
    const self = await membershipOf(league.id, commish.user.id);
    const res = await patchMember(commish.cookie, league.id, self!.id, "member");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "last_commissioner" });
    expect((await membershipOf(league.id, commish.user.id))?.role).toBe("commissioner");
  });

  it("204s a no-op role update", async () => {
    const { commish, member, league } = await seedLeague();
    const target = await membershipOf(league.id, member.user.id);
    expect((await patchMember(commish.cookie, league.id, target!.id, "member")).status).toBe(204);
  });

  it("404s a membership id from another league", async () => {
    const { seasonId, commish, league } = await seedLeague();
    const stranger = await createAuthenticatedUser(auth, { username: "stranger" });
    const otherLeague = await insertLeague(db, {
      seasonId,
      name: "Other",
      members: [{ userId: stranger.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });
    const foreign = await membershipOf(otherLeague.id, stranger.user.id);
    const res = await patchMember(commish.cookie, league.id, foreign!.id, "member");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "member_not_found" });
  });

  it("403s a plain member acting", async () => {
    const { member, commish, league } = await seedLeague();
    const target = await membershipOf(league.id, commish.user.id);
    expect((await patchMember(member.cookie, league.id, target!.id, "member")).status).toBe(403);
  });
});

describe("DELETE /api/leagues/:leagueId/members/:memberId (kick)", () => {
  it("kicks a member pre-start", async () => {
    const { commish, member, league } = await seedLeague();
    const target = await membershipOf(league.id, member.user.id);
    const res = await kickMemberReq(commish.cookie, league.id, target!.id);
    expect(res.status).toBe(204);
    expect(await membershipOf(league.id, member.user.id)).toBeNull();
  });

  it("400s kicking yourself", async () => {
    const { commish, league } = await seedLeague();
    const self = await membershipOf(league.id, commish.user.id);
    const res = await kickMemberReq(commish.cookie, league.id, self!.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "cannot_kick_self" });
  });

  it("409s kicks after the league has started", async () => {
    const { commish, member, league } = await seedLeague();
    const target = await membershipOf(league.id, member.user.id);
    const res = await kickMemberReq(commish.cookie, league.id, target!.id, appAfterKickoff);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "league_started" });
    expect(await membershipOf(league.id, member.user.id)).not.toBeNull();
  });

  it("kicks a co-commissioner (the actor remains, invariant holds)", async () => {
    const { commish, member, league } = await seedLeague();
    const target = await membershipOf(league.id, member.user.id);
    await patchMember(commish.cookie, league.id, target!.id, "commissioner");
    expect((await kickMemberReq(commish.cookie, league.id, target!.id)).status).toBe(204);
  });
});

describe("DELETE /api/leagues/:leagueId/members/me (leave)", () => {
  it("lets a plain member leave pre-start", async () => {
    const { member, league } = await seedLeague();
    expect((await leaveReq(member.cookie, league.id)).status).toBe(204);
    expect(await membershipOf(league.id, member.user.id)).toBeNull();
  });

  it("409s leaving after the league has started", async () => {
    const { member, league } = await seedLeague();
    const res = await leaveReq(member.cookie, league.id, appAfterKickoff);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "league_started" });
  });

  it("409s the last commissioner of a league with other members", async () => {
    const { commish, league } = await seedLeague();
    const res = await leaveReq(commish.cookie, league.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "last_commissioner" });
    expect(await membershipOf(league.id, commish.user.id)).not.toBeNull();
  });

  it("lets a commissioner leave once a replacement is promoted", async () => {
    const { commish, member, league } = await seedLeague();
    const target = await membershipOf(league.id, member.user.id);
    await patchMember(commish.cookie, league.id, target!.id, "commissioner");
    expect((await leaveReq(commish.cookie, league.id)).status).toBe(204);
  });

  it("409s a sole-member commissioner — delete the league instead", async () => {
    const { seasonId } = await seedSeason(db, {
      year: 2027,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
    });
    const solo = await createAuthenticatedUser(auth, { username: "solo" });
    const league = await insertLeague(db, {
      seasonId,
      members: [{ userId: solo.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });
    const res = await leaveReq(solo.cookie, league.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "sole_member" });
  });

  it("404s a non-member", async () => {
    const { league } = await seedLeague();
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });
    expect((await leaveReq(outsider.cookie, league.id)).status).toBe(404);
  });
});

describe("DELETE /api/me — last-commissioner guard (LG-6 closes the ID-3 TODO)", () => {
  it("409s while the caller is the last commissioner of a non-empty active league", async () => {
    const { commish, league } = await seedLeague();
    const res = await deleteMe(commish.cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "last_commissioner" });

    // Nothing was anonymized — the whole deletion rolled back.
    const [row] = await db.select().from(users).where(eq(users.id, commish.user.id));
    expect(row?.username).toBe("commish");
    expect(await membershipOf(league.id, commish.user.id)).not.toBeNull();
  });

  it("deletes once a co-commissioner exists; the membership row survives", async () => {
    const { commish, member, league } = await seedLeague();
    const target = await membershipOf(league.id, member.user.id);
    await patchMember(commish.cookie, league.id, target!.id, "commissioner");

    const res = await deleteMe(commish.cookie);
    expect(res.status).toBe(204);
    const [row] = await db.select().from(users).where(eq(users.id, commish.user.id));
    expect(row?.username).toBeNull();
    expect(await membershipOf(league.id, commish.user.id)).not.toBeNull();
  });

  it("deletes a sole-member commissioner (their league has no other members to strand)", async () => {
    const { seasonId } = await seedSeason(db, {
      year: 2027,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
    });
    const solo = await createAuthenticatedUser(auth, { username: "solo" });
    await insertLeague(db, {
      seasonId,
      members: [{ userId: solo.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });
    expect((await deleteMe(solo.cookie)).status).toBe(204);
  });

  it("deletes the last commissioner of a CONCLUDED league (guard is active-only)", async () => {
    const { commish, league } = await seedLeague();
    await db
      .update(leagues)
      .set({ status: LEAGUE_STATUS.CONCLUDED })
      .where(eq(leagues.id, league.id));
    expect((await deleteMe(commish.cookie)).status).toBe(204);
  });

  it("404s member routes with a malformed member id", async () => {
    const { commish, league } = await seedLeague();
    const res = await patchMember(commish.cookie, league.id, randomUUID(), "member");
    expect(res.status).toBe(404);
  });

  it("409s while solely commissioning ANY non-empty league, despite a safely co-commissioned one", async () => {
    const { seasonId, commish, member, league } = await seedLeague();
    // League A (seedLeague's): promote the member so it's safely co-commissioned.
    const target = await membershipOf(league.id, member.user.id);
    await patchMember(commish.cookie, league.id, target!.id, "commissioner");
    // League B: commish is the sole commissioner with another member — blocks.
    const other = await createAuthenticatedUser(auth, { username: "other_member" });
    await insertLeague(db, {
      seasonId,
      name: "Solely Commissioned",
      members: [
        { userId: commish.user.id, role: MEMBER_ROLE.COMMISSIONER },
        { userId: other.user.id, role: MEMBER_ROLE.MEMBER },
      ],
    });

    const res = await deleteMe(commish.cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "last_commissioner" });
  });
});

describe("concurrency", () => {
  it("two commissioners self-demoting concurrently can't strand the league (ADR-0004)", async () => {
    const { commish, member, league } = await seedLeague();
    const target = await membershipOf(league.id, member.user.id);
    await patchMember(commish.cookie, league.id, target!.id, "commissioner");
    const self = await membershipOf(league.id, commish.user.id);

    const [resA, resB] = await Promise.all([
      patchMember(commish.cookie, league.id, self!.id, "member"),
      patchMember(member.cookie, league.id, target!.id, "member"),
    ]);
    expect([resA.status, resB.status].sort()).toEqual([204, 409]);

    const commissioners = (
      await db.select().from(leagueMembers).where(eq(leagueMembers.leagueId, league.id))
    ).filter((m) => m.role === MEMBER_ROLE.COMMISSIONER);
    expect(commissioners).toHaveLength(1);
  });
});

describe("PATCH settings cannot move the start into the past", () => {
  it("409s start_week_passed when new settings' start week has already begun", async () => {
    const { seasonId } = await seedSeason(db, {
      year: 2026,
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
        { weekNumber: 2, kickoffs: [] },
      ],
    });
    const commish = await createAuthenticatedUser(auth, { username: "commish" });
    // Starts week 2 (no games yet) — still pre-start even after week 1 kicked off.
    const league = await insertLeague(db, {
      seasonId,
      settings: {
        startWeek: { type: "regular", number: 2 },
        endWeek: { type: "regular", number: 18 },
        pickType: "straight_up",
        picksPerWeek: 5,
        pushTieResolution: "half_point",
      },
      members: [{ userId: commish.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await patchLeague(
      commish.cookie,
      league.id,
      {
        settings: {
          startWeek: { type: "regular", number: 1 },
          endWeek: { type: "regular", number: 18 },
          pickType: "straight_up",
          picksPerWeek: 5,
          pushTieResolution: "half_point",
        },
      },
      appAfterKickoff,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "start_week_passed" });
  });
});
