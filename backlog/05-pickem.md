# Epic: NFL Pick'em (PKM)

The first game mode, plus the **shared settlement core** (`pick_results`, `standings`, settle orchestration, nightly sweep) that ELM and MM reuse. Ref: spec §Game Mode 1; arch §Settlement & Scoring, §Locking Model, D9–D11.

> **Playoffs (owner decision, ADR-0007, settled 2026-07-22):** pick'em leagues MAY extend into the playoffs — End Week can be a playoff round (Wild Card → Super Bowl; spec §Game Mode 1 updated). PKM-1's `PickemSettings` must model BOTH Start Week and End Week as (week type, week number) — playoffs-only leagues are allowed (e.g. Wild Card → Super Bowl); week ordering is season order (playoff rounds follow week 18). PKM-3's scoring needs no special casing — the existing fewer-games-than-Picks-Per-Week rule covers small playoff slates.

- [ ] **PKM-1** — `PickemSettings` Zod schema (start/end week, SU/ATS, picks per week, push/tie resolution) + create-league settings form. _(deps: LG-2)_
- [ ] **PKM-2** — `pickem_picks` schema + batch upsert endpoint (`PUT /leagues/:id/picks/week/:week`): clock-derived per-game locking (409 post-kickoff), ATS all-unstarted spread acceptance with staleness rejection (409), spread denormalized onto the pick; kickoff-gated visibility filtering in the read path. _(deps: PKM-1, DATA-5, FND-6)_
- [ ] **PKM-3** — `settlePickemWeek` pure function in `packages/scoring` with exhaustive table-driven tests — the spec §Game Mode 1 scoring/tiebreaker/cancellation matrix is the test plan (pushes, ties, cancellation-as-push, short weeks, differentials). _(deps: FND-7)_
- [ ] **PKM-4** — Settlement core: `pick_results` + `standings` tables; settlement orchestration (load inputs → pure functions → persist + rebuild standings in one transaction); hook into `sync-scores` on game-final; `settle-sweep` nightly full recompute; on-demand rebuild endpoint. Idempotent throughout. Arch D10. _(deps: PKM-3, DATA-6)_
- [ ] **PKM-5** — Pick entry UI: weekly slate with latest spreads (`GET /weeks/:id/games`), batch picks, per-game lock states, ATS spread-acceptance prompt on changes. _(deps: PKM-2)_
- [ ] **PKM-6** — Standings UI: weekly/season toggle with tiebreaker differentials; week/pick detail view with per-kickoff reveal of others' picks. _(deps: PKM-4, LG-7)_
- [ ] **PKM-7** — Cancellation re-picks: push + substitute-any-unstarted-game flow, ATS spread acceptance on the replacement only. _(deps: PKM-4, PKM-5)_
- [ ] **PKM-8** — E2E journey (merge-gate scenario): create league → invite → join → pick → advance clock past kickoff → assert lock + visibility → settle → assert standings. _(deps: PKM-6, SIM-4, SIM-5)_
