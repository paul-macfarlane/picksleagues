# 0011. Simulator & admin ops merge; UI-driven simulator with admin-session auth

- **Status:** Accepted
- **Date:** 2026-07-24
- **Related:** mvp-spec.md §Testing & Internal Tooling; architecture.md §Environments, §Simulator & Time, §Manual Sports Data Overrides, D13–D15 (updated with this ADR); backlog `04-simulator-admin.md` (SIM-\*, ADM-\*), replaces `04-simulator.md` + `08-admin-ops.md`

## Context

The simulator was scoped as backend-only endpoints (shared-secret protected, curl-driven) in epic 04, while the admin page — the UI that would make them usable — sat in epic 08, after all three game modes. The owner's actual goal is an end-to-end testing surface driven from the UI: pick a real past season to replay, advance weeks, inspect and manage team/season/game/odds data. The two epics need the same admin allowlist, page shell, and data views; ADM-1 already planned to host "simulator controls in non-prod." Separately, a UI cannot hold the shared secret (nothing secret ships in the SPA bundle), so UI-driven sim control forces an auth-model decision for `/sim/*`.

## Decision

1. **Merge the Simulator (SIM) and Admin & Operations (ADM) epics** into one epic file, keeping both task prefixes and all existing IDs. Sequencing inside the epic: admin shell + read-only data browsers first, then sim backend + control-panel UI, then the settlement-dependent tail (overrides, audit, settle step-through) after PKM-4.
2. **Sim routes are admin-session-gated, not shared-secret-gated.** `/sim/*` requires an authenticated session whose user ID is on the admin allowlist; the routes remain **not registered** when `APP_ENV=production` (the load-bearing gate, unchanged). The shared-secret header stays for `/api/jobs/*` only, whose callers are machines.
3. **Provider reference data stays override-shaped or read-only in the admin UI.** Games are corrected via `override_*` fields (D15, unchanged). Teams, seasons/weeks, and odds snapshots get read-only browsers; in non-prod, data manipulation happens through sim fixtures, never by mutating provider-synced rows.
4. **Past-season replay is a first-class simulator capability:** load a real historical ESPN season into `sim_fixtures` and replay it under the simulated clock. Historical ESPN data strips odds, so spreads for replayed seasons are synthesized into the fixtures — an acceptance criterion of the replay task, not a surprise.

## Consequences

Easier: the simulator is usable from day one without curl; the data browsers double as verification for the already-shipped sync jobs; one shell serves both prod ops and non-prod sim. Harder/accepted: the merged epic stays open across the Pick'em epic (its tail depends on PKM-4); admin-session auth on `/sim/*` means E2E must mint an admin session (extends the ADR-0006 minted-session approach) instead of sending a header. Revisit if a machine caller ever needs `/sim/*` (e.g. CI orchestration outside Playwright) — that caller would justify re-adding a secret-header alternative alongside session auth.
