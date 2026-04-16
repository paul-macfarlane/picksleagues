import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertCronAuth, handleCronRoute } from "./cron-auth";
import { UnauthorizedError } from "./errors";

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set("authorization", authHeader);
  }
  return new Request("http://localhost/api/cron/nfl/setup", {
    method: "POST",
    headers,
  });
}

describe("assertCronAuth", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes with a matching bearer token", () => {
    expect(() =>
      assertCronAuth(makeRequest("Bearer test-secret")),
    ).not.toThrow();
  });

  it("throws UnauthorizedError when header is missing", () => {
    expect(() => assertCronAuth(makeRequest())).toThrow(UnauthorizedError);
  });

  it("throws UnauthorizedError when scheme is wrong", () => {
    expect(() => assertCronAuth(makeRequest("Basic test-secret"))).toThrow(
      UnauthorizedError,
    );
  });

  it("throws UnauthorizedError when secret does not match", () => {
    expect(() => assertCronAuth(makeRequest("Bearer wrong-secret"))).toThrow(
      UnauthorizedError,
    );
  });

  it("throws a configuration error when CRON_SECRET is unset", () => {
    vi.stubEnv("CRON_SECRET", undefined as unknown as string);
    expect(() => assertCronAuth(makeRequest("Bearer anything"))).toThrow(
      /CRON_SECRET is not configured/,
    );
  });

  it("throws a configuration error when CRON_SECRET is empty", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(() => assertCronAuth(makeRequest("Bearer anything"))).toThrow(
      /CRON_SECRET is not configured/,
    );
  });
});

describe("handleCronRoute", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the sync result as JSON on success", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, count: 3 });

    const res = await handleCronRoute(makeRequest("Bearer test-secret"), run);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 3 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when auth fails and does not run the sync", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });

    const res = await handleCronRoute(makeRequest("Bearer wrong"), run);

    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 500 when CRON_SECRET is unconfigured", async () => {
    vi.stubEnv("CRON_SECRET", undefined as unknown as string);
    const run = vi.fn();

    const res = await handleCronRoute(makeRequest("Bearer anything"), run);

    expect(res.status).toBe(500);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 500 when the sync throws", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));

    const res = await handleCronRoute(makeRequest("Bearer test-secret"), run);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Sync failed" });
  });
});
