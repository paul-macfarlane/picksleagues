import { describe, expect, it, vi, afterEach } from "vitest";
import { FixedClock, type Env } from "@picksleagues/core";
import { createApp } from "../app";
import { agentOpenApiDocument } from "./agent";

const token = "agent_test_".repeat(4);
const env = {
  APP_ENV: "staging",
  AGENT_API_TOKEN: token,
  JOB_SECRET: "job_".repeat(10),
  BETTER_AUTH_SECRET: "auth_".repeat(8),
  SIM_ENABLED: false,
} as Env;
afterEach(() => vi.restoreAllMocks());

describe("agent boundary", () => {
  it.each([
    undefined,
    "",
    "Bearer wrong",
    `Basic ${token}`,
    `Bearer ${token} extra`,
    `Bearer ${env.JOB_SECRET}`,
  ])("refuses invalid credentials generically: %s", async (authorization) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await createApp({ env }).request("/api/agent/v1/system", {
      headers: {
        ...(authorization ? { authorization } : {}),
        cookie: "better-auth.session_token=admin",
        "x-job-secret": env.JOB_SECRET,
      },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized", message: "Unauthorized." });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed without a configured token and across environment tokens", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const AGENT_API_TOKEN of [
      undefined,
      "other_".repeat(8),
      env.JOB_SECRET,
      env.BETTER_AUTH_SECRET,
    ]) {
      const response = await createApp({ env: { ...env, AGENT_API_TOKEN } }).request(
        "/api/agent/v1/system",
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(401);
    }
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD"])(
    "does not accept %s even with a valid token",
    async (method) => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const response = await createApp({ env }).request("/api/agent/v1/system", {
        method,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
    },
  );

  it("logs a bounded 500 without exception text, paths, headers or query data", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { createDb } = await import("@picksleagues/db");
    const db = createDb("postgres://postgres:postgres@localhost:5433/unused_agent_test");
    const app = createApp({
      env,
      db,
      clock: async () => {
        throw new Error(`private@example.com ${token}`);
      },
    });
    const response = await app.request("/api/agent/v1/games/private-path?secret=private-query", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal", message: "Something went wrong." });
    expect(errors).toHaveBeenCalled();
    const audit = JSON.parse(String(logs.mock.calls.at(-1)?.[0]));
    expect(audit).toMatchObject({
      event: "agent_request",
      operation: "agentGame",
      status: 500,
      environment: "staging",
    });
    const output = JSON.stringify([...logs.mock.calls, ...errors.mock.calls]);
    for (const forbidden of [token, "private@example.com", "private-path", "private-query"])
      expect(output).not.toContain(forbidden);
    await db.$client.end();
  });

  it("validates UUIDs with a fixed error and never queries the database", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { createDb } = await import("@picksleagues/db");
    const db = createDb("postgres://postgres:postgres@localhost:5433/unused_agent_test");
    const response = await createApp({
      env,
      db,
      clock: async () => new FixedClock(new Date("2026-09-13T17:00:00Z")),
    }).request("/api/agent/v1/games/secret-invalid-id", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "validation",
      message: "Invalid diagnostic identifier.",
    });
    await db.$client.end();
  });

  it("keeps the published agent contract isolated, GET-only and bearer-authenticated", async () => {
    const document = agentOpenApiDocument();
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      expect(path).toMatch(/^\/api\/agent\/v1\//);
      expect(Object.keys(item ?? {})).toEqual(["get"]);
      expect(item?.get?.security).toEqual([{ AgentBearer: [] }]);
    }
    expect(document.components?.securitySchemes?.AgentBearer).toEqual({
      type: "http",
      scheme: "bearer",
    });
    const publicDoc = await createApp().request("/api/agent-openapi.json");
    expect(await publicDoc.json()).toEqual(document);
  });
});
