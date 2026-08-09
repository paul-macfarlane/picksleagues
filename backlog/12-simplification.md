# Epic: Pick'em Simplification (SIMP)

Collapses the Pick'em rule surface to the smallest set that still plays the game.
Five changes, each removing a concept rather than adding one:

1. **A week's picks are one atomic, immutable submission.** Full set required,
   confirmed before it lands, never edited afterward.
2. **Cancellation is a push, full stop** — no substitute flow.
3. **Week moves are unsupported.** The NFL does not move games between weeks; an
   admin status override covers the once-a-decade case.
4. **Push is fixed at 0.5** and **there is no tiebreaker** — members tie.
5. **Only the latest spread is kept.** Snapshot history has no reader.

Ref: spec §Game Mode 1; arch §Spread strategy, §Locking Model, D10–D11, D15.

> **Why immutability is the load-bearing change.** Almost every intricate rule in
> the mode exists to make *editing* safe: ATS re-prices every unstarted pick on
> any change (ADR-0015), the batch endpoint's retention boundary decides which
> picks a submission may destroy, and the substitute endpoint is that rule's exact
> inverse. Remove editing and all three collapse together. The tickets below are
> ordered so the pure layers move first and the deletions land last.

> **Rejected (owner decision, 2026-08-02):** a league-wide weekly pick deadline
> (e.g. Sunday 1pm ET). It solves a paper-league problem — collecting sheets —
> that the app does not have, and would add a timezone-bearing setting, a
> playoffs exception, and a Thursday-night carve-out to replace locking that is
> already free and already derived. **Locking stays per-game at kickoff.**

> **Season-range presets (owner decision, 2026-08-02), SIMP-17 onward.** Start
> Week + End Week collapse to one three-option choice — Regular Season,
> Postseason, Full Season. Explicit custom ranges are dropped; they return only
> on demand. The resolved range is **stored at creation**, not re-derived, so a
> league's own start week cannot drift under it.

### Pick'em rule surface

- [x] **SIMP-1** — ADR: Pick'em picks are an atomic, immutable weekly submission. Record what it supersedes (ADR-0015's re-pricing/substitute inverse; ADR-0017's motivation, though its per-week constraint shape stays) and the rejected alternative (a configurable weekly deadline). _(deps: none)_
- [x] **SIMP-2** — ADR: week moves are out of scope; `moved` ceases to be a distinct game status and a provider week move is handled by an admin `cancelled` override. Name the failure mode being accepted. _(deps: none)_
- [x] **SIMP-3** — Update `docs/mvp-spec.md` §Game Mode 1 (Core Rules, Locking, ATS acceptance, Scoring, Tiebreakers, Cancellations, Edge Cases), §Core User Flows, §Screens, §Settled pick margin, §Data Freshness; and `docs/architecture.md` §Spread strategy + domain model. Both docs stay reconciled and the version note stays honest. _(deps: SIMP-1, SIMP-2)_
- [x] **SIMP-4** — `packages/scoring`: push is a constant 0.5; `PickemPickOutcome` loses `differential`; `rankStandings` ranks on points alone with shared ranks; the week-move caller obligation goes. `pickMargin` stays — it grades picks and feeds the per-pick margin phrase, which survives on its own merits. Spec matrix is the test plan. _(deps: SIMP-3)_
- [x] **SIMP-5** — `packages/schemas`: drop `PICKEM_PUSH_TIE_RESOLUTION` (Survivor's own set is unrelated and stays), `PickemRepickRequest`, `PickemMovedGame`/`NullablePickemMovedGame` + `PickemPick.movedGame`, `PickemStandingsRow.differential`; drop `GAME_STATUS.MOVED`; add the wire codes the new write path needs. Regenerate spec + client and commit together. _(deps: SIMP-4)_
- [x] **SIMP-6** — Migration: drop `pickem_pick_results.differential` and `pickem_standings.differential`. _(deps: SIMP-5)_
- [x] **SIMP-7** — Collapse `odds_snapshots` into `games.provider_spread`, so spread resolves through `override_spread ?? provider_spread` like every other game field (arch D15) and `latestSpreadsForGames` disappears. `sync-odds` becomes an idempotent update. The audit that mattered — what a member accepted — is already denormalized on the pick. _(deps: SIMP-5)_
- [x] **SIMP-8** — Pick write path: one submission per member per week, sized to exactly the week's `picksAllowed`, refused once the member holds any pick for that week. Delete `repickPickemPick`, the retention-boundary logic, and every refusal only editing could produce. `spread_stale` stays — the line still moves between page load and submit. _(deps: SIMP-5)_
- [x] **SIMP-9** — Settlement + pick read path: drop the pick-week vs game-week divergence handling and `loadMovedGameSummaries`; cancelled resolves as a push with no substitute path to keep alive. Settlement stays a pure derivation (arch D10). _(deps: SIMP-8)_
- [x] **SIMP-10** — My Picks: an unsubmitted week is an editable sheet that Save unlocks only when complete, behind an irreversibility confirmation; a submitted week is read-only. Delete the substitute dialog, the accept-latest-spreads bar, the moved-line row branch, and the moved-out-of-week row. _(deps: SIMP-8)_
- [x] **SIMP-11** — League Picks + standings: drop the `Diff` column and the moved-pick rows; ties share a rank with nothing shown behind them. _(deps: SIMP-9)_
- [x] **SIMP-12** — Simulator: delete the `week-move` scenario; keep `cancelled-game` (now proving a push that stands rather than a substitution); reconcile `push-ats`/`tie-game` with fixed-0.5 scoring. _(deps: SIMP-9)_
- [x] **SIMP-13** — Rewrite `docs/runbooks/pickem-regression.md` against the new rules: Pass 5 goes entirely, Pass 3 loses the substitute half, Pass 6 loses re-pricing, and a new pass covers the confirm-and-freeze submission. _(deps: SIMP-10, SIMP-12)_
- [x] **SIMP-14** — E2E merge-gate journey updated to the submit-once flow. _(deps: SIMP-10)_
- [x] **SIMP-15** — Dead-code sweep across the repo once the above lands: unreferenced exports, helpers, fixtures, test setup, and wire codes left behind by the deletions. Run last, when the shape has settled. _(deps: SIMP-14)_
- [x] **SIMP-16** — Verify picks genuinely open on Tuesday. `sync-odds` targets the week satisfying `startsAt <= now < endsAt`, so if ESPN's week window closes after Tuesday, the coming week's games carry no spread and an ATS league refuses every pick on them (`spread_unavailable`). Establish the real boundaries and, if the gap is real, widen odds coverage to the next week. _(deps: SIMP-7)_

### Season-range presets

- [x] **SIMP-17** — ADR: season-range presets replace explicit Start/End Week. Record the capability dropped (custom ranges — restorable as a fourth "Custom" option if demand appears), that the resolved range is stored rather than derived, and the mid-week resolution rule: a league starts at the **next week whose first kickoff is still in the future**, so a league created on a Sunday afternoon is never born already-started. _(deps: none)_
- [x] **SIMP-18** — `PickemSettings` carries the preset (member-facing label) alongside the resolved `startWeek`/`endWeek` refs everything already computes on, so `leagueStartAt`, the join cutoff, `nflSeasonOrdinal` week-range checks, and `pickemSettingsInvalidatePicks` keep working unchanged. No data migration: there is no production data, and dev data is disposable — so the schema may change shape outright rather than carrying a compatibility default that would mislabel existing leagues. This licence expires at launch (engineering rules §Data: settings JSONB evolves additively). _(deps: SIMP-17)_
- [x] **SIMP-19** — League creation resolves the preset against the bound season and the clock, storing the range. The settings editor keeps editing it pre-start only. _(deps: SIMP-18)_
- [x] **SIMP-20** — Create + settings forms: one select replaces the two `(week type, week number)` dropdown pairs in `league-settings-fields.tsx`, and the encode/decode week plumbing in `leagues/new.tsx` + `settings-section.tsx` goes with it. Both files are the plain-`useState` carve-out (engineering rules §Forms) and stay there. _(deps: SIMP-19)_
- [x] **SIMP-21** — Spec + architecture: rewrite §Game Mode 1 League Settings and §Game Mode 2 League Settings for the preset, and re-check §Membership's join cutoff against it — a league created mid-week now has a short invite window before membership freezes, which is the existing rule meeting a new creation path, and the docs should say which answer is intended. _(deps: SIMP-17)_

---

## Technical plan

The `[EXECUTION PLAN]` for this epic lives at **`docs/plans/simp.md`**
(recorded 2026-08-03 during the Atlas experiment; the three decisions in its
§Decisions were ruled by the owner 2026-08-04). Plans are kept out of epic files
so the ticket list stays a thin contract — see `docs/plans/README.md`.
