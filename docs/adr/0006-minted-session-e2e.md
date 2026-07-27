# 0006. Minted-session E2E ahead of the simulator

- **Status:** Accepted
- **Date:** 2026-07-21
- **Related:** architecture.md §Automated Testing, D14; e2e/setup/session.ts; apps/api/test/setup/auth-helpers.ts; backlog PKM-8, ELM-5, MM-7, SIM-1..5

## Context

D14 defines the E2E strategy as simulator-backed whole-system journeys — the merge-gate scenarios (pick'em season, elimination, bracket) all depend on `SimulatedProvider` and the simulated clock, which are not built yet (SIM-1..5 open). Read literally, that left zero browser coverage until the simulator lands, even for flows that don't depend on game time at all (identity: claim, profile, deletion). Sign-in is OAuth-only, so the blocker for any authenticated E2E was headless auth, not time control.

## Decision

- **Time-independent flows get thin E2E coverage as their epic ships**, without waiting for the simulator. Authentication is handled by **minting real Better Auth sessions** directly in the database (`e2e/setup/session.ts`, reusing the integration-test helper) and injecting the signed session cookie via Playwright `addCookies`. No mocks anywhere — the spec drives the real SPA, API, and Postgres — so D14's no-mocking stance is preserved; only the OAuth provider hop is out of scope (covered by manual testing).
- **The simulator-backed journeys remain the merge-gate scenarios** exactly as D14 states (PKM-8, ELM-5, MM-7, blocked on SIM-1..5). This ADR adds a layer beneath them; it does not replace them. Anything time-dependent (locking, cutoffs, settlement) must wait for the simulated clock — never test those by editing timestamps.
- E2E specs mint their own uniquely-named users, run parallel-safe, and hard-delete what they create (including rows anonymized by delete-account flows).

## Consequences

- Regressions in wiring (routing guards, forms, contract client, auth cookies) are caught in CI from day one; identity has 4 specs running in ~5s.
- The dev database doubles as the local E2E database — acceptable at this scale because specs clean up after themselves; revisit with a dedicated E2E database if pollution ever bites.
- architecture.md §Automated Testing amended in place (marked ADR-0006).
