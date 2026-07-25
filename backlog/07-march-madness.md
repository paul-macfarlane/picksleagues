# Epic: March Madness Pool (MM)

Bracket pools — last MVP mode; needed by Feb 2027 (picks open after the First Four). Flesh out acceptance criteria when this epic starts. Ref: spec §Game Mode 3; arch §External Data (NCAA), §Background Jobs.

- [x] **MM-1** — `MarchMadnessSettings` Zod schema (max brackets 1–10, standard-doubling vs custom per-round values) + settings form. _(deps: LG-2)_ (landed with LG-2, not as a dedicated MM task)
- [ ] **MM-2** — Bracket ingestion: NCAA bracket/seeds/regions/results through `GameDataProvider`; `sync-bracket` job (5-min cadence on tournament days). _(deps: DATA-2, DATA-3)_
- [ ] **MM-3** — `brackets` + `bracket_picks` schema (63 slots per bracket as a constraint, champ score prediction) + submission endpoint: complete-only, immutable after first R64 tip, max-brackets cap, per-bracket labels. _(deps: MM-1, MM-2, FND-6)_
- [ ] **MM-4** — `scoreBracket` pure function + table-driven tests: standard doubling + custom values, correct-regardless-of-path, vacated/cancelled as push with slot auto-advance neutrality, absolute-difference tiebreaker. _(deps: FND-7)_
- [ ] **MM-5** — Bracket builder UI (mobile-first 63-pick flow) + bracket views. _(deps: MM-3)_
- [ ] **MM-6** — Settlement integration + pool leaderboard (one row per bracket); pre-deadline seed-correction wipe-and-resubmit flow. _(deps: MM-4, PKM-4)_
- [ ] **MM-7** — E2E journey: full bracket lifecycle including a vacated-team auto-advance. _(deps: MM-6, SIM-4)_
- [ ] **MM-8** — Bracket scenario fixtures for the spec's remaining edge case, vacated bracket slots: NCAAMB bracket methods on `GameDataProvider` + `SimulatedProvider`, and the scenarios that exercise auto-advance. Split out of SIM-4 because bracket fixtures need the provider surface bracket ingestion (MM-2) introduces. _(deps: SIM-4, MM-2)_
