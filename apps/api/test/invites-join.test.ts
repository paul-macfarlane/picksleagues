import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueInvites, leagueMembers, leagues, users } from "@picksleagues/db";
import {
  LEAGUE_STATUS,
  LEAGUE_VISIBILITY,
  MEMBER_ROLE,
  type Invite,
  type JoinPreviewResponse,
  type LeagueResponse,
} from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, seedSeason } from "./setup/league-helpers";
import {
  makeLeagueTestHarness,
  PRE_START_NOW,
  WEEK1_KICKOFF,
  withCookie,
} from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff, appAtKickoff } = makeLeagueTestHarness();

type App = typeof app;

function postInvite(
  cookie: string | undefined,
  leagueId: string,
  body: Record<string, unknown> = {},
  on: App = app,
) {
  return on.request(`/api/leagues/${leagueId}/invites`, {
    method: "POST",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify(body),
  });
}

function listInvites(cookie: string | undefined, leagueId: string) {
  return app.request(`/api/leagues/${leagueId}/invites`, {
    method: "GET",
    headers: withCookie(cookie),
  });
}

function revokeInvite(cookie: string | undefined, leagueId: string, code: string, on: App = app) {
  return on.request(`/api/leagues/${leagueId}/invites/${code}`, {
    method: "DELETE",
    headers: withCookie(cookie),
  });
}

function getJoinPreview(cookie: string | undefined, code: string, on: App = app) {
  return on.request(`/api/join/${code}`, { method: "GET", headers: withCookie(cookie) });
}

function postJoin(cookie: string | undefined, code: string, on: App = app) {
  return on.request(`/api/join/${code}`, { method: "POST", headers: withCookie(cookie) });
}

function postPublicJoin(cookie: string | undefined, leagueId: string, on: App = app) {
  return on.request(`/api/leagues/${leagueId}/join`, {
    method: "POST",
    headers: withCookie(cookie),
  });
}

/** Bulk-inserts N bare user rows + memberships — filling a league to its cap. */
async function fillLeague(leagueId: string, n: number) {
  const now = PRE_START_NOW;
  const rows = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(),
    display_name: `Filler ${i}`,
    email: `filler-${randomUUID()}@example.com`,
    createdAt: now,
    updatedAt: now,
  }));
  await db.insert(users).values(rows);
  await db.insert(leagueMembers).values(
    rows.map((u) => ({
      leagueId,
      userId: u.id,
      role: MEMBER_ROLE.MEMBER,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

async function seedLeagueWithCommissioner(
  overrides: Parameters<typeof insertLeague>[1] extends infer T
    ? Partial<Omit<T, "seasonId" | "members">>
    : never = {},
) {
  const { seasonId } = await seedSeason(db, {
    year: 2026,
    weeks: [
      { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
      { weekNumber: 2, kickoffs: [] },
    ],
  });
  const commissioner = await createAuthenticatedUser(auth, { username: "commish" });
  const league = await insertLeague(db, {
    seasonId,
    members: [{ userId: commissioner.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    ...overrides,
  });
  return { seasonId, commissioner, league };
}

async function createCode(cookie: string, leagueId: string, body: Record<string, unknown> = {}) {
  const res = await postInvite(cookie, leagueId, body);
  expect(res.status).toBe(201);
  return ((await res.json()) as Invite).code;
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("invite management", () => {
  it("401s all invite surfaces without a session", async () => {
    const { league } = await seedLeagueWithCommissioner();
    expect((await postInvite(undefined, league.id)).status).toBe(401);
    expect((await listInvites(undefined, league.id)).status).toBe(401);
    expect((await revokeInvite(undefined, league.id, "x")).status).toBe(401);
    expect((await getJoinPreview(undefined, "x")).status).toBe(401);
    expect((await postJoin(undefined, "x")).status).toBe(401);
  });

  it("lets a commissioner create, list, and revoke invites", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();

    const res = await postInvite(commissioner.cookie, league.id, {
      expiresAt: "2026-09-10T00:00:00.000Z",
      maxUses: 3,
    });
    expect(res.status).toBe(201);
    const invite = (await res.json()) as Invite;
    expect(invite).toMatchObject({
      status: "active",
      maxUses: 3,
      useCount: 0,
      expiresAt: "2026-09-10T00:00:00.000Z",
      revokedAt: null,
    });
    expect(invite.code.length).toBeGreaterThanOrEqual(16);
    expect(invite.createdBy).toMatchObject({ userId: commissioner.user.id });

    // A second, untouched invite stays listed throughout — only the revoked
    // one should disappear.
    const survivor = await createCode(commissioner.cookie, league.id);

    const list = await listInvites(commissioner.cookie, league.id);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { invites: Invite[] }).invites).toHaveLength(2);

    const revoke = await revokeInvite(commissioner.cookie, league.id, invite.code);
    expect(revoke.status).toBe(204);
    const after = (await (await listInvites(commissioner.cookie, league.id)).json()) as {
      invites: Invite[];
    };
    // Revoked invites are excluded from the commissioner's list entirely —
    // revocation itself stays idempotent and a revoked code still 409s a join.
    expect(after.invites.map((i) => i.code)).toEqual([survivor]);

    const [revokedRow] = await db
      .select()
      .from(leagueInvites)
      .where(eq(leagueInvites.code, invite.code));
    expect(revokedRow?.revokedAt).toEqual(PRE_START_NOW);

    // Idempotent: second revoke succeeds and keeps the original timestamp.
    expect((await revokeInvite(commissioner.cookie, league.id, invite.code)).status).toBe(204);
    const [revokedRowAfterSecond] = await db
      .select()
      .from(leagueInvites)
      .where(eq(leagueInvites.code, invite.code));
    expect(revokedRowAfterSecond?.revokedAt).toEqual(PRE_START_NOW);
  });

  it("403s a plain member and 404s a non-member on invite management", async () => {
    const { league } = await seedLeagueWithCommissioner();
    const member = await createAuthenticatedUser(auth, { username: "plain_member" });
    await db.insert(leagueMembers).values({
      leagueId: league.id,
      userId: member.user.id,
      role: MEMBER_ROLE.MEMBER,
      createdAt: PRE_START_NOW,
      updatedAt: PRE_START_NOW,
    });
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });

    expect((await postInvite(member.cookie, league.id)).status).toBe(403);
    expect((await listInvites(member.cookie, league.id)).status).toBe(403);
    expect((await revokeInvite(member.cookie, league.id, "whatever")).status).toBe(403);
    expect((await postInvite(outsider.cookie, league.id)).status).toBe(404);
    expect((await listInvites(outsider.cookie, league.id)).status).toBe(404);
  });

  it("400s an expiry in the past", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const res = await postInvite(commissioner.cookie, league.id, {
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    expect(res.status).toBe(400);
  });

  it("404s revoking a code that belongs to a different league", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const otherLeague = await insertLeague(db, {
      seasonId: league.seasonId,
      name: "Other",
      members: [{ userId: commissioner.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });
    const code = await createCode(commissioner.cookie, league.id);

    expect((await revokeInvite(commissioner.cookie, otherLeague.id, code)).status).toBe(404);
  });
});

describe("GET /api/join/:code (preview)", () => {
  it("404s an unknown code", async () => {
    await seedLeagueWithCommissioner();
    const { cookie } = await createAuthenticatedUser(auth);
    const res = await getJoinPreview(cookie, "definitely-not-a-code");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "invite_invalid" });
  });

  it("previews a joinable league without exposing the member list", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id);
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await getJoinPreview(joiner.cookie, code);
    expect(res.status).toBe(200);
    const body = (await res.json()) as JoinPreviewResponse;
    expect(body).toMatchObject({
      joinable: true,
      reason: null,
      league: {
        id: league.id,
        memberCount: 1,
        seasonYear: 2026,
        startsAt: WEEK1_KICKOFF.toISOString(),
      },
    });
    expect(body.league).not.toHaveProperty("members");
  });

  it.each([
    { label: "revoked invite", reason: "invite_revoked" },
    { label: "expired invite", reason: "invite_expired" },
    { label: "exhausted invite", reason: "invite_exhausted" },
  ])("reports $label", async ({ reason }) => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    let code: string;
    if (reason === "invite_revoked") {
      code = await createCode(commissioner.cookie, league.id);
      await revokeInvite(commissioner.cookie, league.id, code);
    } else if (reason === "invite_expired") {
      // Expiry after "now" at creation, before "now" at preview? A fixed clock
      // can't move — so create valid-until-kickoff and preview via the
      // post-kickoff app instead.
      code = await createCode(commissioner.cookie, league.id, {
        expiresAt: WEEK1_KICKOFF.toISOString(),
      });
    } else {
      code = await createCode(commissioner.cookie, league.id, { maxUses: 1 });
      const firstJoiner = await createAuthenticatedUser(auth, { username: "first_joiner" });
      expect((await postJoin(firstJoiner.cookie, code)).status).toBe(201);
    }

    const on = reason === "invite_expired" ? appAfterKickoff : app;
    const res = await getJoinPreview(joiner.cookie, code, on);
    expect(res.status).toBe(200);
    const body = (await res.json()) as JoinPreviewResponse;
    expect(body.joinable).toBe(false);
    expect(body.reason).toBe(reason);
  });

  it("reports already_member ahead of other league-level reasons", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id);

    const res = await getJoinPreview(commissioner.cookie, code);
    const body = (await res.json()) as JoinPreviewResponse;
    expect(body).toMatchObject({ joinable: false, reason: "already_member" });
  });

  it("reports join_closed once the start week has kicked off", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id);
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await getJoinPreview(joiner.cookie, code, appAfterKickoff);
    const body = (await res.json()) as JoinPreviewResponse;
    expect(body).toMatchObject({ joinable: false, reason: "join_closed" });
  });
});

describe("POST /api/join/:code", () => {
  it("joins the league and increments the invite's use count", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id, { maxUses: 5 });
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await postJoin(joiner.cookie, code);
    expect(res.status).toBe(201);
    const body = (await res.json()) as LeagueResponse;
    expect(body).toMatchObject({ id: league.id, myRole: "member" });
    expect(body.members).toHaveLength(2);

    const [invite] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, code));
    expect(invite?.useCount).toBe(1);
  });

  it("409s a re-join and rolls the use-count increment back", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id, { maxUses: 5 });
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    expect((await postJoin(joiner.cookie, code)).status).toBe(201);
    const res = await postJoin(joiner.cookie, code);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "already_member" });

    // The refused join's increment rolled back with the transaction.
    const [invite] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, code));
    expect(invite?.useCount).toBe(1);
  });

  it("enforces max uses: the (n+1)th join is refused", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id, { maxUses: 1 });
    const first = await createAuthenticatedUser(auth, { username: "first_joiner" });
    const second = await createAuthenticatedUser(auth, { username: "second_joiner" });

    expect((await postJoin(first.cookie, code)).status).toBe(201);
    const res = await postJoin(second.cookie, code);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "invite_exhausted" });
  });

  it("409s an expired invite", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id, {
      expiresAt: WEEK1_KICKOFF.toISOString(),
    });
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await postJoin(joiner.cookie, code, appAfterKickoff);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "invite_expired" });
  });

  it("409s a revoked invite", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id);
    await revokeInvite(commissioner.cookie, league.id, code);
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await postJoin(joiner.cookie, code);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "invite_revoked" });
  });

  it("409s after the join cutoff — the invite still being valid doesn't help", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id);
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await postJoin(joiner.cookie, code, appAfterKickoff);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "join_closed" });
    expect(
      await db.select().from(leagueMembers).where(eq(leagueMembers.userId, joiner.user.id)),
    ).toHaveLength(0);
  });

  it("treats a league whose start week has no games as pre-start (joinable)", async () => {
    const { seasonId } = await seedSeason(db, {
      year: 2026,
      weeks: [{ weekNumber: 1, kickoffs: [] }],
    });
    const commissioner = await createAuthenticatedUser(auth, { username: "commish" });
    const league = await insertLeague(db, {
      seasonId,
      members: [{ userId: commissioner.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });
    const code = await createCode(commissioner.cookie, league.id);
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    expect((await postJoin(joiner.cookie, code, appAfterKickoff)).status).toBe(201);
  });

  it("409s a full league and rolls the membership back", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    await fillLeague(league.id, 99); // commissioner + 99 = 100 = cap
    const code = await createCode(commissioner.cookie, league.id);
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await postJoin(joiner.cookie, code);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "league_full" });
    expect(
      await db.select().from(leagueMembers).where(eq(leagueMembers.userId, joiner.user.id)),
    ).toHaveLength(0);
  });

  it("409s a concluded league", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id);
    await db
      .update(leagues)
      .set({ status: LEAGUE_STATUS.CONCLUDED })
      .where(eq(leagues.id, league.id));
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await postJoin(joiner.cookie, code);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "league_concluded" });
  });
});

describe("boundary instants", () => {
  it("closes joins at exactly kickoff (kickoff == now)", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id);
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await postJoin(joiner.cookie, code, appAtKickoff);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "join_closed" });
  });

  it("expires an invite at exactly its expiry instant (expiresAt == now)", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();
    const code = await createCode(commissioner.cookie, league.id, {
      expiresAt: WEEK1_KICKOFF.toISOString(),
    });
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    // Invite validity precedes the cutoff in the reason precedence, so the
    // expiry boundary is observable even though the cutoff also lands here.
    const res = await getJoinPreview(joiner.cookie, code, appAtKickoff);
    expect(((await res.json()) as JoinPreviewResponse).reason).toBe("invite_expired");
  });
});

describe("concurrency", () => {
  it("two concurrent joins can't blow past the 100-member cap", async () => {
    // Public joins, deliberately NOT the same invite code: same-code joins
    // already serialize on the invite row's guarded use-count UPDATE, which
    // would mask a missing league lock — this path exercises the league row
    // lock in joinLeagueInTx alone.
    const { league } = await seedLeagueWithCommissioner({
      visibility: LEAGUE_VISIBILITY.PUBLIC,
    });
    await fillLeague(league.id, 98); // 99 members; exactly one seat left
    const a = await createAuthenticatedUser(auth, { username: "racer_a" });
    const b = await createAuthenticatedUser(auth, { username: "racer_b" });

    const [resA, resB] = await Promise.all([
      postPublicJoin(a.cookie, league.id),
      postPublicJoin(b.cookie, league.id),
    ]);
    expect([resA.status, resB.status].sort()).toEqual([201, 409]);

    const members = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, league.id));
    expect(members).toHaveLength(100);
  });
});

describe("custom maxMembers cap (feedback item 10)", () => {
  it("409s a join once the league's custom cap is reached and rolls back", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner({ maxMembers: 2 });
    const code = await createCode(commissioner.cookie, league.id);
    const filler = await createAuthenticatedUser(auth, { username: "filler" });
    expect((await postJoin(filler.cookie, code)).status).toBe(201); // commissioner + filler = 2 = cap

    const third = await createAuthenticatedUser(auth, { username: "third" });
    const res = await postJoin(third.cookie, code);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "league_full" });
    expect(
      await db.select().from(leagueMembers).where(eq(leagueMembers.userId, third.user.id)),
    ).toHaveLength(0);
  });

  it("join preview reports league_full at the custom cap", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner({ maxMembers: 2 });
    const code = await createCode(commissioner.cookie, league.id);
    const filler = await createAuthenticatedUser(auth, { username: "filler" });
    expect((await postJoin(filler.cookie, code)).status).toBe(201);

    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });
    const res = await getJoinPreview(joiner.cookie, code);
    const body = (await res.json()) as JoinPreviewResponse;
    expect(body).toMatchObject({ joinable: false, reason: "league_full" });
  });
});

describe("post-start invite management (spec §Commissioner Powers: anytime)", () => {
  it("creates and revokes invites after the league has started", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner();

    const res = await postInvite(commissioner.cookie, league.id, {}, appAfterKickoff);
    expect(res.status).toBe(201);
    const invite = (await res.json()) as Invite;
    expect(
      (await revokeInvite(commissioner.cookie, league.id, invite.code, appAfterKickoff)).status,
    ).toBe(204);
  });
});

describe("POST /api/leagues/:leagueId/join (public join)", () => {
  it("accepts an invite code for a public league too — an alternate path to the same join", async () => {
    const { commissioner, league } = await seedLeagueWithCommissioner({
      visibility: LEAGUE_VISIBILITY.PUBLIC,
    });
    const code = await createCode(commissioner.cookie, league.id);
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    expect((await postJoin(joiner.cookie, code)).status).toBe(201);
  });

  it("joins a public league directly", async () => {
    const { league } = await seedLeagueWithCommissioner({
      visibility: LEAGUE_VISIBILITY.PUBLIC,
    });
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await postPublicJoin(joiner.cookie, league.id);
    expect(res.status).toBe(201);
    expect(((await res.json()) as LeagueResponse).myRole).toBe("member");
  });

  it("404s a private league — direct joins require an invite", async () => {
    const { league } = await seedLeagueWithCommissioner();
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await postPublicJoin(joiner.cookie, league.id);
    expect(res.status).toBe(404);
  });

  it("409s once the cutoff has passed", async () => {
    const { league } = await seedLeagueWithCommissioner({
      visibility: LEAGUE_VISIBILITY.PUBLIC,
    });
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const res = await postPublicJoin(joiner.cookie, league.id, appAfterKickoff);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "join_closed" });
  });
});
