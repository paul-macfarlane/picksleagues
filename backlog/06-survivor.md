# Epic: NFL Survivor (ELM)

Survivor pool mode on top of the shared settlement core. Ref: spec §Game Mode 2; arch §Domain Model (deferred-feature note: `lives_remaining` default 1).

> **Playoffs (owner decision, ADR-0007, settled 2026-07-22):** Survivor is **regular-season only** — playoff weeks are not supported for this mode (spec §Game Mode 2 updated). ELM-1's settings keep the week range within regular-season weeks 1–18; no playoff handling anywhere in ELM.

> **Season range (owner decision, 2026-08-02, SIMP-17):** Start/End Week is
> replaced by a season-range preset. Survivor is regular-season only, so its
> only valid preset is Regular Season — the range therefore leaves the
> **settings form entirely**, while the resolved week refs are still stored (a
> league created mid-season starts at the next week yet to kick off). ELM-1
> ships one fewer setting than it was written for. Recorded as **ADR-0024**.

> **Mode name (owner decision, 2026-08-07, plan review):** the mode ships as
> **NFL Survivor** — the industry-standard term — not "Elimination" (and never
> the legacy "suicide pool" name). ELM ticket IDs are stable and keep their
> prefix; the rename ADR (**ADR-0023**) plus the spec/arch/backlog sweep (this
> file → `06-survivor.md`, epic title, ticket wording, `LEAGUE_MODE` value +
> data migration) ships with ELM-1. Member-state vocabulary — alive,
> eliminated, revived — is unchanged.

> **Pick type (owner decision, 2026-08-07):** Survivor is **straight-up only**
> — the Pick Type setting is removed. ATS combined with
> picks-changeable-until-kickoff made a one-way ratchet: a member could re-pick
> the same team whenever the line moved in their favour and be re-graded at the
> better number, so the optimal play was to keep refreshing rather than to pick
> well. There is no demand for ATS Survivor. Push/Tie Resolution survives,
> narrowed to a straight-up tie. Recorded as **ADR-0026**, which also names the
> option to revisit first if ATS Survivor is ever wanted: grade at the closing
> line, not at pick time.

- [x] **ELM-1** — `SurvivorSettings` Zod schema (straight-up, push/tie resolution: advance-and-consume vs eliminate; resolved regular-season week range stored, not chosen) + settings form. _(deps: LG-2, SIMP-18)_
- [x] **ELM-2** — `survivor_picks` + `survivor_state` schema (lives default 1, revived flags; unique team per member per league as a DB constraint) + pick endpoint with team-consumption and clock-derived locking. _(deps: ELM-1, DATA-4, FND-6)_
- [x] **ELM-3** — `settleSurvivorWeek` pure function + table-driven tests: eliminations, missed-pick elimination, push resolution per setting, cancellation/week-move as push without team consumption, all-eliminated same-week revival, co-winners at End Week. _(deps: FND-7)_
- [~] **ELM-4** — Settlement integration + survivor board UI: alive/eliminated status, week eliminated, per-kickoff-revealed pick history, teams consumed; eliminated members keep full visibility. _(deps: ELM-2, ELM-3, PKM-4)_
- [~] **ELM-5** — E2E journey: a full Survivor season including a revival week. _(deps: ELM-4, SIM-4)_
- [~] **ELM-6** — Dashboard pick-status glance for Survivor leagues: picks in / picks needed / locked at a glance (spec §Screens). _(deps: ELM-4)_
- [~] **ELM-7** — `docs/runbooks/survivor-regression.md`, the Survivor counterpart to `docs/runbooks/pickem-regression.md`: a manual click-through pass over the spec §Game Mode 2 rules automation reaches least well — the ones that live in the **browser**, across a **clock change**, or in a game that does something other than kick off and go final. Same shape as the Pick'em runbook: a "what automation already covers — skip these" table pinned to the ELM-2/3/4 suites and ELM-5's journey, per-pass scenario + assertions, and a closing statement of what the runbook cannot reach. Drives the existing scenario library (`all-eliminated`, `cancelled-game`, `tie-game`, `mixed-week`); a new scenario only where a Survivor edge case has no fixture that reaches it. _(deps: ELM-4, ELM-5)_

## Technical plan

`docs/plans/elm.md` — recorded by `/atlas-plan` 2026-08-07, red-team reviewed
(1 blocking + 5 major findings resolved in revision). Owner ruled on every
flagged decision at plan review the same day: sticky-release confirmed,
verbatim renewal confirmed, ELM-6 appended, mode renamed **Survivor**
(plan decision 10). `/atlas-implement ELM` is the remaining
approval-to-execute.

**ELM-7** was appended 2026-08-07 (owner, plan decision 11) after the plan was
red-teamed — the manual-regression runbook Pick'em has and Survivor does not.
Its plan section is §ELM-7 in the same file.
