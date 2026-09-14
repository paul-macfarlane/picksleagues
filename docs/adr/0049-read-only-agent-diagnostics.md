# 0049. Read-only agent diagnostics

- **Status:** Accepted
- **Date:** 2026-09-13
- **Related:** architecture.md §Auth, §External Data; mvp-spec.md §Data Freshness & Expectations; AGENT-1; [owner-approved design](https://app.notion.com/p/3d5c4dbb621780d183a9cbd25a1a3d40)

## Context

Engineering agents need diagnostic access in staging and production without inheriting a human admin's mutation rights or receiving member identity. The existing admin router mixes reads and writes. The owner approved separate per-environment tokens, technical UUIDs, aggregate-first diagnostics and direct OpenAPI consumption.

## Decision

Add four GET-only `/api/agent/v1/*` operations with an independent `AGENT_API_TOKEN` bearer credential. Omission disables access; tokens matching the jobs or auth secret are rejected. Generate an agent-only OpenAPI document from the same router. Explicit SQL projections and response schemas exclude identity, league names, dues, invites, raw picks, arbitrary settings and provider/error free text. League reads use a read-only repeatable-read transaction; no repair operations or generic query surface exist.

Request logs contain only generated request IDs, fixed operation labels, environment, status and duration (the platform supplies timestamps). Agent exceptions produce a generic logged 500 without raw error content. Row-change timestamps are neutral freshness signals, never evidence of job execution. Missing Survivor state means alive and is not a missing-row anomaly. Durable job history and MCP remain deferred.

## Consequences

Agents can inspect stored NFL facts and bounded league aggregates with no session or database credentials. Aggregate counts may still describe small groups; this is minimization, not a claim of anonymization. New row-level diagnostics require a concrete debugging need and their own allowlist review. Staging consumer validation and privacy-policy review precede production connection; credentials, deployment and production access are separate operator steps. No member-facing game rules change.
