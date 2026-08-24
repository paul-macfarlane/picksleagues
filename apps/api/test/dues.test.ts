import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueDuesPayments } from "@picksleagues/db";
import { ERROR_CODE, MEMBER_ROLE, type LeagueResponse } from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, membersOf, seasonIdFor, seedSeason } from "./setup/league-helpers";
import {
  makeLeagueTestHarness,
  PRE_START_NOW,
  WEEK1_KICKOFF,
  withCookie,
} from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff } = makeLeagueTestHarness();

type App = typeof app;

function putDues(
  cookie: string | undefined,
  leagueId: string,
  amount: number | null,
  on: App = app,
) {
  return on.request(`/api/leagues/${leagueId}/dues`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify({ amount }),
  });
}

function putMemberDues(
  cookie: string | undefined,
  leagueId: string,
  memberId: string,
  paid: boolean,
  on: App = app,
) {
  return on.request(`/api/leagues/${leagueId}/dues/members/${memberId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify({ paid }),
  });
}

async function getLeague(cookie: string | undefined, leagueId: string): Promise<LeagueResponse> {
  const res = await app.request(`/api/leagues/${leagueId}`, { headers: withCookie(cookie) });
  expect(res.status).toBe(200);
  return (await res.json()) as LeagueResponse;
}

async function seedLeague(duesAmount: number | null = null) {
  const { seasonId } = await seedSeason(db, {
    year: 2026,
    weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
  });
  const commish = await createAuthenticatedUser(auth, { username: "commish" });
  const member = await createAuthenticatedUser(auth, { username: "plain_member" });
  const league = await insertLeague(db, {
    seasonId,
    duesAmount,
    members: [
      { userId: commish.user.id, role: MEMBER_ROLE.COMMISSIONER },
      { userId: member.user.id, role: MEMBER_ROLE.MEMBER },
    ],
  });
  const memberIds = await membersOf(db, league.id);
  return { seasonId, commish, member, league, memberIds };
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("PUT /leagues/:id/dues", () => {
  it("sets the amount and serializes it (everyone starts unpaid)", async () => {
    const { commish, league } = await seedLeague();

    const res = await putDues(commish.cookie, league.id, 20);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeagueResponse;
    expect(body.duesAmount).toBe(20);
    expect(body.members.map((m) => m.duesPaidAt)).toEqual([null, null]);
  });

  it("clears the amount with null", async () => {
    const { commish, league } = await seedLeague(20);

    const res = await putDues(commish.cookie, league.id, null);
    expect(res.status).toBe(200);
    expect(((await res.json()) as LeagueResponse).duesAmount).toBeNull();
  });

  it("is editable after league start — MANAGE_DUES has no window", async () => {
    const { commish, league } = await seedLeague();

    const res = await putDues(commish.cookie, league.id, 50, appAfterKickoff);
    expect(res.status).toBe(200);
    expect(((await res.json()) as LeagueResponse).duesAmount).toBe(50);
  });

  it("refuses a plain member (403) and hides the league from a non-member (404)", async () => {
    const { member, league } = await seedLeague();
    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });

    const asMember = await putDues(member.cookie, league.id, 20);
    expect(asMember.status).toBe(403);
    expect(((await asMember.json()) as { error: string }).error).toBe(ERROR_CODE.NOT_COMMISSIONER);

    const asOutsider = await putDues(outsider.cookie, league.id, 20);
    expect(asOutsider.status).toBe(404);
    expect(((await asOutsider.json()) as { error: string }).error).toBe(
      ERROR_CODE.LEAGUE_NOT_FOUND,
    );
  });

  it("refuses an out-of-range amount at the boundary (400)", async () => {
    const { commish, league } = await seedLeague();

    expect((await putDues(commish.cookie, league.id, 0)).status).toBe(400);
    expect((await putDues(commish.cookie, league.id, 10001)).status).toBe(400);
  });
});

describe("PUT /leagues/:id/dues/members/:memberId", () => {
  it("marks paid with the clock's instant, visible to a plain member", async () => {
    const { commish, member, league, memberIds } = await seedLeague(20);
    const memberRowId = memberIds.get(member.user.id);
    expect(memberRowId).toBeDefined();

    const res = await putMemberDues(commish.cookie, league.id, memberRowId as string, true);
    expect(res.status).toBe(204);

    // Read as the NON-commissioner: who's-paid is league-visible (ADR-0045).
    const seen = await getLeague(member.cookie, league.id);
    const line = seen.members.find((m) => m.userId === member.user.id);
    expect(line?.duesPaidAt).toBe(PRE_START_NOW.toISOString());
    const commishLine = seen.members.find((m) => m.userId === commish.user.id);
    expect(commishLine?.duesPaidAt).toBeNull();
  });

  it("is idempotent in both directions", async () => {
    const { commish, member, league, memberIds } = await seedLeague(20);
    const memberRowId = memberIds.get(member.user.id) as string;

    expect((await putMemberDues(commish.cookie, league.id, memberRowId, true)).status).toBe(204);
    expect((await putMemberDues(commish.cookie, league.id, memberRowId, true)).status).toBe(204);
    const rows = await db
      .select()
      .from(leagueDuesPayments)
      .where(eq(leagueDuesPayments.userId, member.user.id));
    expect(rows).toHaveLength(1);

    expect((await putMemberDues(commish.cookie, league.id, memberRowId, false)).status).toBe(204);
    expect((await putMemberDues(commish.cookie, league.id, memberRowId, false)).status).toBe(204);
    const after = await getLeague(commish.cookie, league.id);
    expect(after.members.find((m) => m.userId === member.user.id)?.duesPaidAt).toBeNull();
  });

  it("refuses marking while dues are off (409 dues_not_enabled)", async () => {
    const { commish, member, league, memberIds } = await seedLeague(null);
    const memberRowId = memberIds.get(member.user.id) as string;

    const res = await putMemberDues(commish.cookie, league.id, memberRowId, true);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(ERROR_CODE.DUES_NOT_ENABLED);
  });

  it("refuses a plain member (403) and an unknown member row (404)", async () => {
    const { commish, member, league, memberIds } = await seedLeague(20);
    const memberRowId = memberIds.get(member.user.id) as string;

    const asMember = await putMemberDues(member.cookie, league.id, memberRowId, true);
    expect(asMember.status).toBe(403);

    const unknown = await putMemberDues(commish.cookie, league.id, randomUUID(), true);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toBe(ERROR_CODE.MEMBER_NOT_FOUND);
  });

  it("keeps marks through an off-and-on toggle of the amount", async () => {
    const { commish, member, league, memberIds } = await seedLeague(20);
    const memberRowId = memberIds.get(member.user.id) as string;
    await putMemberDues(commish.cookie, league.id, memberRowId, true);

    await putDues(commish.cookie, league.id, null);
    await putDues(commish.cookie, league.id, 25);

    const seen = await getLeague(commish.cookie, league.id);
    expect(seen.duesAmount).toBe(25);
    expect(seen.members.find((m) => m.userId === member.user.id)?.duesPaidAt).toBe(
      PRE_START_NOW.toISOString(),
    );
  });
});

describe("dues across renewal", () => {
  it("copies the amount to the new instance and starts its ledger empty", async () => {
    const { commish, member, league, memberIds } = await seedLeague(20);
    await putMemberDues(commish.cookie, league.id, memberIds.get(member.user.id) as string, true);
    const oldInstanceId = await seasonIdFor(db, league.id);

    // A newer ingested season makes the league renewable (ADR-0009).
    await seedSeason(db, {
      year: 2027,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: new Date("2027-09-12T17:00:00.000Z") }] }],
    });
    const renewed = await app.request(`/api/leagues/${league.id}/seasons`, {
      method: "POST",
      headers: withCookie(commish.cookie),
    });
    expect(renewed.status).toBe(201);
    const body = (await renewed.json()) as LeagueResponse;

    expect(body.seasonYear).toBe(2027);
    expect(body.duesAmount).toBe(20);
    expect(body.members.map((m) => m.duesPaidAt)).toEqual([null, null]);

    // The old instance's ledger is untouched — history, not state to migrate.
    const oldRows = await db
      .select()
      .from(leagueDuesPayments)
      .where(eq(leagueDuesPayments.leagueSeasonId, oldInstanceId));
    expect(oldRows).toHaveLength(1);
  });
});
