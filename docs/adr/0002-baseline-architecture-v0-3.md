# 0002. Adopt architecture v0.3 as baseline

- **Status:** Accepted
- **Date:** 2026-07-18
- **Related:** architecture.md (whole doc, D1–D15), mvp-spec.md v0.3

## Context

The MVP spec and architecture doc (both v0.3) were developed and reconciled together before any code. The architecture doc carries its own decision log (D1–D15) with alternatives considered for every structural choice: SPA + separate API, TypeScript/Hono/Zod-OpenAPI, Vercel serverless, Neon + Drizzle, external cron, per-mode pick tables, recompute-friendly settlement, query-time locking, DB-persisted simulated clock, simulator-backed e2e, and parallel-field overrides.

## Decision

Adopt `docs/architecture.md` v0.3 (and `docs/mvp-spec.md` v0.3) as the locked baseline. D1–D15 are treated as accepted decisions with the same standing as ADRs; new decisions and any deviation from the baseline get their own ADR from 0003 on.

## Consequences

Implementation work cites doc sections instead of re-deriving choices; the evaluator reviews against a fixed baseline. Deviating without an ADR + doc update is a review failure. Revisit triggers named in the doc (e.g. ESPN feed instability → The Odds API fallback, settlement outgrowing function limits) should produce superseding ADRs when they fire.
