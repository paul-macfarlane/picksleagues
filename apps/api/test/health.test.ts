import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, appState, getSimClockOffsetMs, setSimClockOffsetMs } from "@picksleagues/db";
import { createApp } from "../src/app";
import { getTestDatabaseUrl } from "./setup/test-database-url";

describe("GET /api/health", () => {
  it("responds 200 with status ok, in-process (no HTTP server, no auth)", async () => {
    const app = createApp();
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("app_state sim clock offset (real DB roundtrip)", () => {
  const db = createDb(getTestDatabaseUrl());

  beforeEach(async () => {
    await db.delete(appState);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("returns 0 when no row has ever been written", async () => {
    await expect(getSimClockOffsetMs(db)).resolves.toBe(0);
  });

  it("round-trips a written offset", async () => {
    await setSimClockOffsetMs(db, 90_000);
    await expect(getSimClockOffsetMs(db)).resolves.toBe(90_000);
  });
});
