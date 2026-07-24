# Epic: Simulator & Admin Ops (SIM/ADM)

The UI-driven testing and operations surface, merged from the former Simulator and Admin & Operations epics (ADR-0011). One admin page serves both: in all environments, data browsing, job triggers, and (post-PKM-4) overrides + audit; in non-prod, the simulator control panel — replay a real past season, advance weeks, load edge-case scenarios, reset. Ref: spec §Testing & Internal Tooling; arch §Simulator & Time, §Manual Sports Data Overrides, D13–D15.

**Auth model (ADR-0011):** `/sim/*` routes are admin-session-gated (env-var user-ID allowlist) and **not registered** when `APP_ENV=production`. The shared-secret header remains for `/api/jobs/*` only. Admin surfaces are invisible to non-admins everywhere.

## Shell & data visibility (deps already met — buildable now)

- [~] **ADM-1** — Admin role via env-var user-ID allowlist + admin page shell: manual job triggers, standings rebuild buttons (as those features land); hosts the sim control panel in non-prod. _(deps: DATA-3, FND-11)_
- [ ] **ADM-4** — Read-only reference-data browsers on the admin page: teams, seasons/weeks, games (provider + override fields visible), odds snapshots. Doubles as verification for the sync jobs. _(deps: ADM-1)_

## Simulator backend

- [ ] **SIM-1** — `sim_fixtures` tables + `SimulatedProvider`: when a scenario is loaded, the provider reads simulator-controlled data instead of ESPN-synced tables for the leagues/season under test; ESPN remains the default otherwise. _(deps: DATA-2)_
- [ ] **SIM-2** — `POST /sim/clock`: set/advance the persisted clock offset ("advance to Week 5", jump to timestamp), consistent across serverless instances via `app_state`. _(deps: FND-6, DATA-3)_
- [ ] **SIM-3** — `POST /sim/fixtures` (load scenario / hand-edit results) + `POST /sim/reset` (league or environment scope: truncate league/pick data, reload fixtures). _(deps: SIM-1)_
- [ ] **SIM-6** — Past-season replay importer: load a real historical ESPN season (structure, schedule, scores) into `sim_fixtures` for replay under the simulated clock. Historical ESPN data strips odds, so spreads are synthesized into the fixtures — acceptance criterion, per ADR-0011. _(deps: SIM-1)_

## Simulator UI

- [ ] **SIM-7** — Sim control panel on the admin page (non-prod only): pick a season to replay (SIM-6), advance week / jump clock, load scenario, reset, and a persistent indicator of current simulated time + active scenario. _(deps: ADM-1, SIM-2, SIM-3, SIM-6)_
- [ ] **SIM-4** — Edge-case scenario library covering the spec's required cases: pushes, ties, cancellations, postponements, week moves, all-eliminated weeks, vacated bracket slots. Acceptance bar (spec): every scoring rule and edge case is reproducible in the simulator. _(deps: SIM-3)_

## Settlement-dependent tail (after PKM-4)

- [ ] **SIM-5** — `POST /sim/settle`: step-through settlement for the simulated now, rendering resulting `pick_results`/`standings` inspectable per step. _(deps: SIM-2, PKM-4)_
- [ ] **ADM-2** — Game data overrides (`PUT /admin/games/:id/override`): set/clear score, status, kickoff, spread as `override_*` parallel fields; `override_* ?? provider_*` precedence in serializers + settlement input loader; apply/clear triggers settlement recompute for affected leagues. _(deps: ADM-1, PKM-4)_
- [ ] **ADM-3** — `admin_audit` table recording every override/rebuild (who, what, when, prior value) + audit view on the admin page. _(deps: ADM-2)_
