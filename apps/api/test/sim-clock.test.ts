import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SIM_GAME_DURATION_MS } from "@picksleagues/core";
import { WEEK_TYPE, type SimStateResponse } from "@picksleagues/schemas";
import { adminCaller, closeSimDb, db, expectCloseTo, get, postJson } from "./setup/sim-helpers";
import { seedSeason } from "./setup/league-helpers";
import { resetDb } from "./setup/reset-db";

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeSimDb();
});

// ---------------------------------------------------------------------------
// Clock (SIM-2): POST /api/sim/clock
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Directly-seeded week+games for the clock-anchor tests (SIM-2) — these
// exercise `resolveWeekAnchorInstant` against our own ingested rows, never a
// scenario, so they stay independent of the fixture/provider machinery.
// ---------------------------------------------------------------------------

const ANCHOR_WEEK_START = new Date("2026-09-08T00:00:00.000Z");
const ANCHOR_WEEK_END = new Date("2026-09-15T00:00:00.000Z");
const ANCHOR_GAME1_KICKOFF = new Date("2026-09-14T17:00:00.000Z");
const ANCHOR_GAME2_KICKOFF = new Date("2026-09-14T20:00:00.000Z");

/** Only `week.id` is ever read by callers — narrowed to that. */
async function seedAnchorWeek(): Promise<{ week: string }> {
  const { weekIds } = await seedSeason(db, {
    year: 2026,
    weeks: [
      {
        weekNumber: 1,
        startsAt: ANCHOR_WEEK_START,
        endsAt: ANCHOR_WEEK_END,
        kickoffs: [{ kickoffAt: ANCHOR_GAME1_KICKOFF }, { kickoffAt: ANCHOR_GAME2_KICKOFF }],
      },
    ],
  });
  return { week: weekIds.get(`${WEEK_TYPE.REGULAR}:1`)! };
}

describe("POST /api/sim/clock", () => {
  it("instant sets the offset so a subsequent GET /api/sim/state reports now equal to that instant", async () => {
    const { app, cookie } = await adminCaller();
    const target = new Date("2031-03-15T12:00:00.000Z");

    const setRes = await postJson(
      app,
      "/api/sim/clock",
      { kind: "instant", instant: target.toISOString() },
      cookie,
    );
    expect(setRes.status).toBe(200);

    const stateRes = await get(app, "/api/sim/state", cookie);
    const body = (await stateRes.json()) as SimStateResponse;
    expect(Math.abs(new Date(body.clock.now).getTime() - target.getTime())).toBeLessThan(5_000);
  });

  it.each([
    { label: "positive ms advances now forward", ms: 3_600_000 },
    { label: "negative ms shifts now backward", ms: -3_600_000 },
  ])("$label", async ({ ms }) => {
    const { app, cookie } = await adminCaller();
    const baselineRes = await get(app, "/api/sim/state", cookie);
    const baselineNow = new Date(
      ((await baselineRes.json()) as SimStateResponse).clock.now,
    ).getTime();

    const res = await postJson(app, "/api/sim/clock", { kind: "advance", ms }, cookie);
    expect(res.status).toBe(200);

    const afterRes = await get(app, "/api/sim/state", cookie);
    const afterNow = new Date(((await afterRes.json()) as SimStateResponse).clock.now).getTime();
    expect(Math.abs(afterNow - baselineNow - ms)).toBeLessThan(5_000);
  });

  // Regression guard: the handler's own `Clock` was resolved from the offset in
  // force BEFORE the write, so a response that derived `now` from it would
  // report a `now`/`realNow`/`offsetMs` triple that contradicts itself. The
  // POST body must describe the clock it just wrote, not the one it arrived
  // with, and must agree with what the next request reads back.
  it.each([
    { label: "advance", body: { kind: "advance", ms: 7_200_000 } },
    { label: "instant", body: { kind: "instant", instant: "2027-01-15T18:30:00.000Z" } },
    { label: "reset", body: { kind: "reset" } },
  ])("POST /sim/clock returns a self-consistent clock for $label", async ({ body }) => {
    const { app, cookie } = await adminCaller();

    const res = await postJson(app, "/api/sim/clock", body, cookie);
    expect(res.status).toBe(200);
    const posted = ((await res.json()) as SimStateResponse).clock;

    // now === realNow + offsetMs, exactly — these are derived, not sampled.
    expect(new Date(posted.now).getTime()).toBe(
      new Date(posted.realNow).getTime() + posted.offsetMs,
    );

    const readBack = ((await (await get(app, "/api/sim/state", cookie)).json()) as SimStateResponse)
      .clock;
    expect(readBack.offsetMs).toBe(posted.offsetMs);
    expectCloseTo(readBack.now, new Date(posted.now));
  });

  it("reset returns offsetMs to 0 and now back to approximately real time", async () => {
    const { app, cookie } = await adminCaller();
    await postJson(app, "/api/sim/clock", { kind: "advance", ms: 3_600_000 }, cookie);

    const before = Date.now();
    const res = await postJson(app, "/api/sim/clock", { kind: "reset" }, cookie);
    expect(res.status).toBe(200);

    const stateRes = await get(app, "/api/sim/state", cookie);
    const body = (await stateRes.json()) as SimStateResponse;
    expect(body.clock.offsetMs).toBe(0);
    expect(Math.abs(new Date(body.clock.now).getTime() - before)).toBeLessThan(5_000);
  });

  describe("week anchors", () => {
    it("week_start lands exactly on the week's startsAt", async () => {
      const { app, cookie } = await adminCaller();
      const { week } = await seedAnchorWeek();

      const res = await postJson(
        app,
        "/api/sim/clock",
        { kind: "week", weekId: week, anchor: "week_start" },
        cookie,
      );
      expect(res.status).toBe(200);

      const stateRes = await get(app, "/api/sim/state", cookie);
      const body = (await stateRes.json()) as SimStateResponse;
      expectCloseTo(body.clock.now, ANCHOR_WEEK_START);
    });

    it("before_first_kickoff lands strictly before the earliest kickoff", async () => {
      const { app, cookie } = await adminCaller();
      const { week } = await seedAnchorWeek();

      const res = await postJson(
        app,
        "/api/sim/clock",
        { kind: "week", weekId: week, anchor: "before_first_kickoff" },
        cookie,
      );
      expect(res.status).toBe(200);

      const stateRes = await get(app, "/api/sim/state", cookie);
      const body = (await stateRes.json()) as SimStateResponse;
      expect(new Date(body.clock.now).getTime()).toBeLessThan(ANCHOR_GAME1_KICKOFF.getTime());
    });

    it("after_last_game lands past the last kickoff's game window — every game in the week would project to final", async () => {
      const { app, cookie } = await adminCaller();
      const { week } = await seedAnchorWeek();

      const res = await postJson(
        app,
        "/api/sim/clock",
        { kind: "week", weekId: week, anchor: "after_last_game" },
        cookie,
      );
      expect(res.status).toBe(200);

      const stateRes = await get(app, "/api/sim/state", cookie);
      const body = (await stateRes.json()) as SimStateResponse;
      const nowMs = new Date(body.clock.now).getTime();

      // Matches projectFixtureGame's own boundary rule (`nowMs < kickoffMs +
      // SIM_GAME_DURATION_MS` => in_progress, else final) — landing at or past
      // this instant for every game's kickoff is exactly what "projects to
      // final" means.
      for (const kickoff of [ANCHOR_GAME1_KICKOFF, ANCHOR_GAME2_KICKOFF]) {
        expect(nowMs).toBeGreaterThanOrEqual(kickoff.getTime() + SIM_GAME_DURATION_MS);
      }
    });
  });

  it("an unknown weekId 404s with week_not_found", async () => {
    const { app, cookie } = await adminCaller();

    const res = await postJson(
      app,
      "/api/sim/clock",
      { kind: "week", weekId: "00000000-0000-4000-8000-000000000000", anchor: "week_start" },
      cookie,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "week_not_found" });
  });

  it("a real week with zero games 404s with week_has_no_games for before_first_kickoff, but week_start still succeeds", async () => {
    const { app, cookie } = await adminCaller();
    const { weekIds } = await seedSeason(db, {
      year: 2026,
      weeks: [
        {
          weekNumber: 2,
          startsAt: ANCHOR_WEEK_END,
          endsAt: new Date(ANCHOR_WEEK_END.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      ],
    });
    const emptyWeekId = weekIds.get(`${WEEK_TYPE.REGULAR}:2`)!;

    const noGamesRes = await postJson(
      app,
      "/api/sim/clock",
      { kind: "week", weekId: emptyWeekId, anchor: "before_first_kickoff" },
      cookie,
    );
    expect(noGamesRes.status).toBe(404);
    expect(await noGamesRes.json()).toMatchObject({ error: "week_has_no_games" });

    const startRes = await postJson(
      app,
      "/api/sim/clock",
      { kind: "week", weekId: emptyWeekId, anchor: "week_start" },
      cookie,
    );
    expect(startRes.status).toBe(200);
    const stateRes = await get(app, "/api/sim/state", cookie);
    const body = (await stateRes.json()) as SimStateResponse;
    expectCloseTo(body.clock.now, ANCHOR_WEEK_END);
  });
});
