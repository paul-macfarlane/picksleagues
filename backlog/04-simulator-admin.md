# Epic: Simulator & Admin Ops (SIM/ADM)

The UI-driven testing and operations surface, merged from the former Simulator and Admin & Operations epics (ADR-0011). Two sibling surfaces, both admin-gated: `/admin` in all environments (data browsing, job triggers, and post-PKM-4 overrides + audit), and `/sim` in non-prod only (replay a real past season, advance weeks, load edge-case scenarios, reset). The epics merged because they share an auth model and an operator, not a page — the simulator got its own section once its panel outgrew a single tab (feedback round 3). Ref: spec §Testing & Internal Tooling; arch §Simulator & Time, §Manual Sports Data Overrides, D13–D15.

**Auth model (ADR-0013, ADR-0014):** `/sim/*` routes are gated on the `admin` role in `users.app_role` and **not registered** unless `isSimEnabled(env)` — `SIM_ENABLED=true` and `APP_ENV !== "production"` (production ignores the flag). The shared-secret header remains for `/api/jobs/*` only. Admin surfaces are invisible to non-admins everywhere.

## Shell & data visibility (deps already met — buildable now)

- [x] **ADM-1** — Admin role (env-var allowlist as shipped; moved into `users.app_role` by ADR-0013) + admin page shell: manual job triggers, standings rebuild buttons (as those features land); hosts the sim control panel in non-prod. _(deps: DATA-3, FND-11)_
- [x] **ADM-4** — Read-only reference-data browsers on the admin page: teams, seasons/weeks, games (provider + override fields visible), odds snapshots. Doubles as verification for the sync jobs. _(deps: ADM-1)_

## Simulator backend

- [x] **SIM-1** — `sim_fixtures` tables + `SimulatedProvider`: when a scenario is loaded, the provider reads simulator-controlled data instead of ESPN-synced tables for the leagues/season under test; ESPN remains the default otherwise. _(deps: DATA-2)_
- [x] **SIM-2** — `POST /sim/clock`: set/advance the persisted clock offset ("advance to Week 5", jump to timestamp), consistent across serverless instances via `app_state`. _(deps: FND-6, DATA-3)_
- [x] **SIM-3** — `POST /sim/fixtures` (load scenario / hand-edit results) + `POST /sim/reset` (league or environment scope: truncate league/pick data, reload fixtures). _(deps: SIM-1)_
- [x] **SIM-6** — Past-season replay importer: load a real historical ESPN season (structure, schedule, scores) into `sim_fixtures` for replay under the simulated clock. Historical ESPN data strips odds, so spreads are synthesized into the fixtures — acceptance criterion, per ADR-0011. _(deps: SIM-1)_

## Simulator UI

- [x] **SIM-7** — Sim control panel on the admin page (non-prod only): pick a season to replay (SIM-6), advance week / jump clock, load scenario, reset, and a persistent indicator of current simulated time + active scenario. _(deps: ADM-1, SIM-2, SIM-3, SIM-6)_

- [x] **SIM-9** — Fixture browser + hand-edit UI on the sim panel: `GET /sim/fixtures/games` (browse the active scenario's fixtures with their projection at the simulated now) and `PATCH /sim/fixtures/games/{gameId}` (edit kickoff, week, spread, final status/scores). Both routes shipped in SIM-3 but have no SPA consumer, so the spec's "load **or hand-edit** game outcomes" (§Testing & Internal Tooling) is currently reachable only by curl. _(deps: SIM-7)_
- [x] **SIM-4** — Edge-case scenario library covering the spec's NFL-expressible cases: pushes, ties, cancellations, postponements, week moves, all-eliminated weeks. Acceptance bar (spec): every scoring rule and edge case is reproducible in the simulator — bracket cases split to MM-8, which is what closes that bar. _(deps: SIM-3)_

  Bracket scenario fixtures (vacated bracket slots, auto-advance) moved to the March Madness epic — originally id'd SIM-8, renumbered to **MM-8** (grep landed here) — they need the NCAAMB provider surface MM-2 introduces, not this epic's NFL fixtures. See `07-march-madness.md`.

## Settlement-dependent tail (after PKM-4)

- [x] **SIM-5** — `POST /sim/settle`: step-through settlement for the simulated now, rendering resulting `pick_results`/`standings` inspectable per step. _(deps: SIM-2, PKM-4)_
- [x] **ADM-2** — Game data overrides (`PUT /admin/games/:id/override`): set/clear score, status, kickoff, spread as `override_*` parallel fields; `override_* ?? provider_*` precedence in serializers + settlement input loader; apply/clear triggers settlement recompute for affected leagues; edit UI on the games browser. **Includes the `admin_audit` table and the override's audit write** — moved forward from ADM-3, because engineering rules §Data require every override to write `admin_audit`, and an override endpoint can't satisfy that against a table that doesn't exist. Refuses (409 `override_unlocks_game`) any kickoff/status edit whose *resulting* state would leave a game unlocked while its outcome is already knowable — a started (`in_progress`/`final`) resolved status, or a resolved score on either side. Stated on the result rather than on the before/after pair because lock state is derived (arch D11): a transition test is escapable by splitting the edit across requests, or by correcting an outcome without touching the kickoff at all. Escape hatch for a provider that wrongly marked a game played: assert `scheduled` (and null any override scores) in the same request as the kickoff. _(deps: ADM-1, PKM-4)_
- [x] **ADM-3** — Audit view on the admin page over the `admin_audit` table ADM-2 created, plus auditing the remaining admin action that mutates derived state (`POST /admin/leagues/:id/rebuild`) — its `ADMIN_AUDIT_ACTION` member and prior-value shape are a design call ADM-2 deliberately left open. Also surfaces `unlocked ∧ outcome-knowable` games — a row can reach that state without any admin fault (an allowed later-kickoff override, then `sync-scores` writing the final score off the **provider** kickoff), and the override endpoint's guard cannot prevent it: ingestion writes only provider columns and must never fail on account of a correction. Detection + repair, not admission control. _(deps: ADM-2)_
- [x] **SIM-10** — Simulator settle read-back covers Survivor. `POST /sim/settle` now settles Survivor league seasons and reports a real summary, but it reads standings back out of `pickem_standings`, so a settled Survivor season renders as a real summary beside an **empty board** — which reads to an operator as "settled and found nothing" rather than "this mode's board lives elsewhere", the exact confusion `loadActiveTargets` filtered modes out to avoid before ELM-4 widened it. Either serve the survivor ledger in the step-through or say plainly that this mode's board is the league's own. Ref: spec §Testing & Internal Tooling; ADR-0016. _(deps: none)_

## Technical plan

- ADM-3: `docs/plans/adm-3.md` (draft 2026-08-07, awaiting owner approval; red-teamed, no blocking findings).
