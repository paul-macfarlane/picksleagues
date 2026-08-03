# Epic: NFL Elimination (ELM)

Survivor pool mode on top of the shared settlement core. Ref: spec §Game Mode 2; arch §Domain Model (deferred-feature note: `lives_remaining` default 1).

> **Playoffs (owner decision, ADR-0007, settled 2026-07-22):** elimination is **regular-season only** — playoff weeks are not supported for this mode (spec §Game Mode 2 updated). ELM-1's settings keep Start/End Week within regular-season weeks 1–18; no playoff handling anywhere in ELM.

> **Season range (owner decision, 2026-08-02, SIMP-17):** Start/End Week is
> replaced by a season-range preset. Elimination is regular-season only, so its
> only valid preset is Regular Season — the range therefore leaves the
> **settings form entirely**, while the resolved week refs are still stored (a
> league created mid-season starts at the next week yet to kick off). ELM-1
> ships one fewer setting than it was written for.

- [ ] **ELM-1** — `EliminationSettings` Zod schema (SU/ATS, push/tie resolution: advance-and-consume vs eliminate; resolved regular-season week range stored, not chosen) + settings form. _(deps: LG-2, SIMP-18)_
- [ ] **ELM-2** — `elimination_picks` + `elimination_state` schema (lives default 1, revived flags; unique team per member per league as a DB constraint) + pick endpoint with team-consumption and clock-derived locking. _(deps: ELM-1, DATA-4, FND-6)_
- [ ] **ELM-3** — `settleEliminationWeek` pure function + table-driven tests: eliminations, missed-pick elimination, push resolution per setting, cancellation/week-move as push without team consumption, all-eliminated same-week revival, co-winners at End Week. _(deps: FND-7)_
- [ ] **ELM-4** — Settlement integration + survivor board UI: alive/eliminated status, week eliminated, per-kickoff-revealed pick history, teams consumed; eliminated members keep full visibility. _(deps: ELM-2, ELM-3, PKM-4)_
- [ ] **ELM-5** — E2E journey: a full elimination season including a revival week. _(deps: ELM-4, SIM-4)_
