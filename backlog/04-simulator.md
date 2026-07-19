# Epic: Simulator (SIM)

The non-prod season simulator: simulated clock, fixture scenarios, and resets. Built before the game modes so mode work is verifiable end-to-end from day one. Ref: spec §Testing & Internal Tooling; arch §Simulator & Time, D13–D14. All routes shared-secret protected and **not registered** when `APP_ENV=production`.

- [ ] **SIM-1** — `sim_fixtures` tables + `SimulatedProvider`: when a scenario is loaded, the provider reads simulator-controlled data instead of ESPN-synced tables for the leagues/season under test; ESPN remains the default otherwise. _(deps: DATA-2)_
- [ ] **SIM-2** — `POST /sim/clock`: set/advance the persisted clock offset ("advance to Week 5", jump to timestamp), consistent across serverless instances via `app_state`. _(deps: FND-6, DATA-3)_
- [ ] **SIM-3** — `POST /sim/fixtures` (load scenario / hand-edit results) + `POST /sim/reset` (league or environment scope: truncate league/pick data, reload fixtures). _(deps: SIM-1)_
- [ ] **SIM-4** — Edge-case scenario library covering the spec's required cases: pushes, ties, cancellations, postponements, week moves, all-eliminated weeks, vacated bracket slots. Acceptance bar (spec): every scoring rule and edge case is reproducible in the simulator. _(deps: SIM-3)_
- [ ] **SIM-5** — `POST /sim/settle`: step-through settlement for the simulated now, rendering resulting `pick_results`/`standings` inspectable per step. _(deps: SIM-2, PKM-4)_
