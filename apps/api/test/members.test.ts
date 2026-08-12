import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueMembers, leagueSeasons, leagues, users } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import { LEAGUE_STATUS, MEMBER_ROLE, type LeagueResponse } from "@picksleagues/schemas";
import { updateMemberRole } from "../src/services/members";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, seedSeason } from "./setup/league-helpers";
import {
  makeLeagueTestHarness,
  PRE_START_NOW,
  WEEK1_KICKOFF,
  withCookie,
} from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff } = makeLeagueTestHarness();

type App = typeof app;

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
        pickType: "against_the_spread",
        picksPerWeek: 3,
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
      settings: { maxBracketsPerMember: 5 }, // MM settings on a pickem league
    });
    expect(res.status).toBe(400);
  });

  it("403s a plain member and 404s a non-member", async () => {
    const { member, league } = await seedLeague();
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });
    expect((await patchLeague(member.cookie, league.id, { name: "X" })).status).toBe(403);
    expect((await patchLeague(outsider.cookie, league.id, { name: "X" })).status).toBe(404);
    // maxMembers rides the same EDIT_SETTINGS gate — cheap to pin here too.
    expect((await patchLeague(member.cookie, league.id, { maxMembers: 5 })).status).toBe(403);
  });

  it("400s an empty update", async () => {
    const { commish, league } = await seedLeague();
    expect((await patchLeague(commish.cookie, league.id, {})).status).toBe(400);
  });

  it("changes maxMembers pre-start", async () => {
    const { commish, league } = await seedLeague();
    const res = await patchLeague(commish.cookie, league.id, { maxMembers: 10 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as LeagueResponse).maxMembers).toBe(10);
  });

  it("409s lowering maxMembers below the current member count", async () => {
    // seedLeague() seats a commissioner and a plain member (2); a third
    // member pushes the count to 3 so maxMembers: 2 (the schema's floor) is
    // still below the roster.
    const { commish, league } = await seedLeague();
    const third = await createAuthenticatedUser(auth, { username: "third_member" });
    await db.insert(leagueMembers).values({
      leagueId: league.id,
      userId: third.user.id,
      role: MEMBER_ROLE.MEMBER,
      createdAt: WEEK1_KICKOFF,
      updatedAt: WEEK1_KICKOFF,
    });

    const res = await patchLeague(commish.cookie, league.id, { maxMembers: 2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "max_members_below_member_count" });
  });
});

describe("DELETE /api/leagues/:leagueId", () => {
  it("deletes pre-start and cascades settings/members/invites", async () => {
    const { commish, league } = await seedLeague();
    const res = await deleteLeagueReq(commish.cookie, league.id);
    expect(res.status).toBe(204);
    expect(await db.select().from(leagues).where(eq(leagues.id, league.id))).toHaveLength(0);
    expect(
      await db.select().from(leagueSeasons).where(eq(leagueSeasons.leagueId, league.id)),
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

  it("409s the last commissioner of a CONCLUDED league — a finished league is not a disposable one", async () => {
    const { commish, league } = await seedLeague();
    // Status is per-instance now (ADR-0009) — conclude the current instance.
    await db
      .update(leagueSeasons)
      .set({ status: LEAGUE_STATUS.CONCLUDED })
      .where(eq(leagueSeasons.leagueId, league.id));

    // The guard was active-only while nothing wrote `concluded`; ADR-0030 gave
    // that column a writer, and letting this through would strand the league —
    // renewal into the next season is commissioner-only and no code path grants
    // the role, so the remaining members could never act on it again.
    expect((await deleteMe(commish.cookie)).status).toBe(409);
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

  it("names the blocking leagues on the pre-click read, and empties once a replacement is promoted (FB-13)", async () => {
    const { commish, member, league } = await seedLeague();

    const blocked = await app.request("/api/me/deletion-blockers", {
      headers: withCookie(commish.cookie),
    });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({
      leagues: [{ id: league.id, name: league.name }],
    });

    // The same fix the refusal asks for clears the read: promote a replacement.
    const target = await membershipOf(league.id, member.user.id);
    await patchMember(commish.cookie, league.id, target!.id, "commissioner");

    const cleared = await app.request("/api/me/deletion-blockers", {
      headers: withCookie(commish.cookie),
    });
    expect(await cleared.json()).toEqual({ leagues: [] });
  });
});

describe("concurrency", () => {
  it("two commissioners self-demoting concurrently can't strand the league (ADR-0004)", async () => {
    const { commish, member, league } = await seedLeague();
    const target = await membershipOf(league.id, member.user.id);
    await patchMember(commish.cookie, league.id, target!.id, "commissioner");
    const self = await membershipOf(league.id, commish.user.id);

    // Service-level race (not HTTP): the request stack's overhead tends to
    // serialize Promise.all accidentally, which would let a missing league
    // lock pass — two direct transactions keep the race window real.
    const clock = new FixedClock(PRE_START_NOW);
    const [resA, resB] = await Promise.all([
      updateMemberRole(db, clock, league.id, commish.user.id, self!.id, MEMBER_ROLE.MEMBER),
      updateMemberRole(db, clock, league.id, member.user.id, target!.id, MEMBER_ROLE.MEMBER),
    ]);
    expect([resA.ok, resB.ok].sort()).toEqual([false, true]);
    const refused = [resA, resB].find((r) => !r.ok);
    expect(refused).toMatchObject({ reason: "last_commissioner" });

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
        // Week 2 has no games *and* its own window has closed — both halves
        // matter since ADR-0021, because a games-less week whose window is
        // still open is a week resolution can legitimately advance to.
        { weekNumber: 2, endsAt: new Date(WEEK1_KICKOFF.getTime() - 1), kickoffs: [] },
      ],
    });
    const commish = await createAuthenticatedUser(auth, { username: "commish" });
    // Resolved to week 2 (no games yet) — still pre-start even after week 1
    // kicked off.
    const league = await insertLeague(db, {
      seasonId,
      settings: {
        startWeek: { type: "regular", number: 2 },
        endWeek: { type: "regular", number: 18 },
        pickType: "straight_up",
        picksPerWeek: 5,
      },
      members: [{ userId: commish.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    // Re-resolving the range now finds nothing in it still ahead — week 1
    // has begun, and week 2 has no games and no open window — so it falls back
    // to the nominal start, week 1, which has already started. The edit is
    // refused rather than being allowed to start the league by saving its
    // settings.
    const res = await patchLeague(
      commish.cookie,
      league.id,
      {
        settings: {
          pickType: "straight_up",
          picksPerWeek: 5,
        },
      },
      appAfterKickoff,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "start_week_passed" });
  });
});
