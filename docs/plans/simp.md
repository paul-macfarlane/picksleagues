# [EXECUTION PLAN] — SIMP epic

_Work package: the **SIMP** epic (`backlog/12-simplification.md`, 21 tickets).
The ticket list in that file is the stable contract; this file is the technical
plan and never amends it._

_Recorded by `/atlas-plan`, 2026-08-03. Status: **the three §Decisions are ruled
(owner, 2026-08-04) and are settled inputs; the delivery strategy and per-ticket
notes below remain a draft the owner has not blanket-approved.**
Red-team review ran (required: this plan touches scoring, settlement, override
precedence, and migrations); its three blocking findings are resolved below
(§Decisions, SIMP-8/SIMP-2 notes) and its advisories folded in.
Run surface: **local only**. Verification commands and evidence policy:
`docs/agents/testing.md`; evidence root `docs/evidence/test-results`, cleared per
PR (each PR below is one work package for evidence purposes — merged evidence
survives in git history)._

### Intent

Deliver the epic's five rule collapses plus the season-range presets exactly as the
tickets and their referenced doc sections define them. This plan's added value is
(a) the file-level map of every deletion, (b) a delivery strategy that resolves the
cross-ticket compile couplings the dependency edges alone don't capture, (c) a
criterion-level verification map, and (d) three owner decisions surfaced before any
code is written.

### Decisions — **all three ruled by the owner, 2026-08-04**

All three were accepted as recommended. They are settled inputs to implementation,
not open questions: do not reopen them mid-PR. Each ruling and its verification is
recorded inline below.

1. **Late submitters vs "full set required" (red-team B1).** `picksAllowed` is
   `min(picksPerWeek, pickable games)` and `pickable` does not exclude locked games
   (`apps/api/src/services/pickem/picks.ts:151-153`,
   `apps/api/src/services/slate.ts:124` — note `slate.ts` is **not** under
   `pickem/`; it is mode-agnostic and sits directly in `services/`). A literal
   `submissions.length === picksAllowed` rule would make a member who hasn't
   submitted before kickoffs shrink the unlocked slate below `picksAllowed`
   permanently unable to submit — an implicit weekly deadline, which is the exact
   shape the epic preamble's rejected-deadline decision refused.
   **RULED 2026-08-04 — accepted as recommended.** The required set is sized
   against the *unlocked* pickable slate at submission time: a full set of what can
   still be picked. Games that locked before the member submitted are forgone —
   they were never picks, so nothing scores, consistent with "unpicked slots score
   zero". Per-game locking stays untouched. SIMP-3's spec text states this rule and
   SIMP-8 carries a named "member submits after the first kickoff" integration case.

   _Verified before ruling:_ `apps/api/src/services/slate.ts:124` sets
   `pickable: !isUnplayedStatus(effective.status)` while `locked` is a **separate**
   field on the line above — so `pickable` genuinely does include kicked-off games
   and the lockout is real, not hypothetical. Checked for a gaming incentive and
   there is none: fewer picks means fewer possible points, so submitting late is
   self-penalizing rather than exploitable.
2. **SIMP-7 column name. RULED 2026-08-04 — `games.spread`, not
   `games.provider_spread`.** The ticket's wording is inconsistent with the schema
   it extends; the column is `spread` and SIMP-7's implementation uses that name.

   _Verified before ruling:_ `packages/db/src/schema/sports.ts:132-152` — every
   provider field is unprefixed (`kickoff_at`, `status`, `home_score`,
   `away_score`) against an `override_*` counterpart. The engineering rule's
   `override_* ?? provider_*` describes the **resolution**, not the column name.
3. **SIMP-20 Elimination fieldset. RULED 2026-08-04 — accepted as recommended.**
   Leave Elimination's explicit regular-season week pair, and the shared week
   helpers it still needs, until epic 06. `EliminationSettingsSchema` is untouched
   by this epic.

   **Binding condition:** SIMP-21's rewrite of §Game Mode 2 League Settings must
   state explicitly that presets reach Elimination at its build-out. That sentence
   is what keeps the locked docs reconciled with the code while the two modes
   diverge; without it SIMP-21 ships a spec describing settings Elimination does
   not have. Treat it as an acceptance criterion of SIMP-21, not a nicety.

### Load-bearing repository facts (surveyed 2026-08-03; red-team verified)

- `differential` flows scoring → settlement → DB → wire → UI as one chain:
  `PickemPickOutcome.differential` (`packages/scoring/src/pickem.ts:63`, set at
  245/259) → settlement read/write sites (`apps/api/src/services/pickem/settlement.ts:209,
  250, 264-269, 284, 305`) → `pickem_pick_results.differential` /
  `pickem_standings.differential` (**NOT NULL**, `packages/db/src/schema/pickem.ts:139,167`)
  → `PickemStandingsRow.differential` (`packages/schemas/src/pickem.ts:31-36`) → the
  `Diff` column (`apps/web/src/components/league/pickem-standings-table.tsx:219-225,257-259`)
  and `rankStandings`'s tiebreak (`packages/scoring/src/standings.ts:89`).
- `GAME_STATUS.MOVED` (`packages/schemas/src/game-status.ts`) consumers: the
  settlement synthesis `game.weekId === weekId ? game.status : MOVED`
  (`settlement.ts:152`), `apps/api/src/services/sim/replay.ts:50`, the web
  status-label map (`apps/web/src/lib/game.ts:25`), `UNPLAYED_GAME_STATUSES`
  (schemas), and the admin status-override option set (arch line 88).
- The repick surface: `POST .../repick` (`apps/api/src/routes/pickem.ts:128-155`),
  `repickPickemPick` (`apps/api/src/services/pickem/picks.ts:481-587`),
  `PickemRepickRequestSchema` (`packages/schemas/src/pickem.ts:79-90`), web
  `useRepick` + `repickErrorMessage` (`apps/web/src/api/pickem.ts:157-231`),
  `pickem-substitute-dialog.tsx`. Refusals `pick_not_found` / `pick_not_replaceable`
  exist only for it.
- Retention boundary: `submitPickemPicks` (`picks.ts:376-419`); ATS re-pricing is
  structural (delete-and-reinsert at current spread, ADR-0015 §1). Concurrency
  guard: `lockLeagueMemberRow` (`picks.ts:345-348`) — retained under submit-once.
- Spread today: append-only `odds_snapshots` + `latestSpreadsForGames`
  (`apps/api/src/services/odds.ts:21-44`; callers
  `apps/api/src/services/slate.ts:100`, `admin-data.ts:172,189`), the admin
  history reader `listGameOdds`
  (`admin-data.ts:194-212`, `GET /admin/games/{id}/odds`), the sim reset delete
  (`apps/api/src/services/sim/reset.ts:130`), and test seeding
  (`apps/api/test/setup/league-helpers.ts:157`, `reset-db.ts:40`). `games` already
  has `override_spread` with **no provider counterpart column**; picks keep the
  accepted spread denormalized as `spread_at_pick` (the audit that matters).
- `sync-odds` week targeting (`apps/api/src/services/nfl/sync-odds.ts:142-191`):
  explicit week → else `startsAt <= now < endsAt` → else next `startsAt > now`
  (SIMP-16's subject). Appends a snapshot per run today (`sync-odds.ts:129`).
- Moved-game read path: `loadMovedGameSummaries`
  (`apps/api/src/services/slate.ts:174-203`), sole caller
  `getPickemWeekPicks` (`picks.ts:227,260`); UI branches in
  `pickem-picks.tsx:348-350,441-474`, `pickem-week-detail.tsx:272-307`,
  `pickem-game-row.tsx:222-225,312-317`.
- Settings forms: `encodeWeek`/`decodeWeek` + week option lists in
  `league-settings-fields.tsx:77-108`; call sites duplicated across
  `routes/_authed/leagues/new.tsx:59-134` and `league/settings-section.tsx:132-323`.
  `pushTieResolution` renders in both forms and in the test helper seed
  (`league-helpers.ts:176`).
- The e2e merge-gate journey (`e2e/pickem-journey.sim.spec.ts`) already submits one
  batch per member and never edits, repicks, or accepts spreads. Its cap-2 league is
  seeded by direct API call with explicit `startWeek`/`endWeek`/`pushTieResolution`
  (`:287-291`) — a payload SIMP-5 and SIMP-18 both reshape.

### Delivery strategy — three integration branches, not sixteen PRs

The dependency edges order the work but do **not** make each ticket independently
shippable: the gates (`typecheck`, `contract:check`, NOT NULL columns) fail between
adjacent tickets wherever a symbol deletion and its consumer deletions sit in
different tickets. Ship as three PRs, each gate-green, one commit per ticket so IDs
stay referenceable:

- **PR 1 — decisions and docs** (independently green): SIMP-1, SIMP-2, SIMP-3,
  SIMP-17, SIMP-21. Carries the three open decisions above to the owner.
- **PR 2 — the rule-surface collapse**: SIMP-4 → SIMP-5 → SIMP-6 → SIMP-7 → SIMP-8
  → SIMP-9 → SIMP-10 → SIMP-11 → SIMP-12 → SIMP-14, committed in that order on one
  branch. Couplings forcing this: SIMP-4's `differential` removal breaks the five
  settlement read/write sites until SIMP-6's migration; SIMP-5's removals of
  `GAME_STATUS.MOVED`, `PickemRepickRequest`, `movedGame`, and
  `PickemStandingsRow.differential` have consumers deleted only in SIMP-8/9/10/11;
  SIMP-7 additionally touches `sim/reset.ts:130` and the integration-test seed
  helpers; contract regeneration lands once per green state. Within the branch a
  commit may carry a short-lived bridge (e.g. `differential: 0` at the settlement
  sites) rather than reordering tickets — the PR deletes every bridge before merge.
- **PR 3 — presets + closeout**: SIMP-18 → SIMP-19 → SIMP-20, then SIMP-13,
  SIMP-15, SIMP-16 (SIMP-16 may run any time after PR 2's SIMP-7; SIMP-13 needs
  PR 2 merged). **SIMP-18's commit owns updating every e2e/integration fixture that
  builds a settings payload** (`pickem-journey.sim.spec.ts:287-291`,
  `league-helpers.ts:176`) — the merge gate must stay green inside PR 3, not just
  at its end.

Tracker: claim each ticket (`[ ]`→`[~]`) when its commit starts; a human flips
`[x]` after PR review (`docs/agents/issue-tracker.md`).

### Per-ticket technical notes

**SIMP-1 / SIMP-2 / SIMP-17 (ADRs).** Author via `/adr`. SIMP-1's ADR records the
full 2026-08-02 owner decision set except week moves — immutable atomic submission
(superseding ADR-0015 rule 1 and the PKM-7 substitute path, and ADR-0017's
*motivation*; the `(member, game, week)` constraint stays as the per-week
uniqueness backstop), cancellation-push-stands, **push fixed at 0.5 / no
tiebreaker, and latest-spread-only** — so every spec/architecture amendment SIMP-3
makes traces to a recorded ADR (locked-docs rule), plus the rejected weekly
deadline and the late-submitter ruling from §Open decisions. SIMP-2's ADR records
week moves out of scope, and — corrected per red-team B3 — the accepted failure
mode is **silent cross-week grading, not stranding**: with the synthesis at
`settlement.ts:152` deleted, a really-moved game's old-week pick loads by
`pick.gameId` (`settlement.ts:134-137`) and grades against the game's final result
from its *new* week unless an admin notices and applies a `cancelled` override.
Nothing in the product signals the divergence once the moved surfaces are deleted;
detection is operational (schedule-sync review), and SIMP-13's runbook gets an
operator note saying how a move would be noticed. SIMP-17 records preset
resolution ("next week whose first kickoff is still in the future"), the stored
resolved range, and the no-games fallback (see SIMP-19).

**SIMP-3 (docs).** Spec §Game Mode 1: Core Rules lose "individually or in batches"
and free unstarted-pick editing; ATS acceptance becomes submit-time-only; the
missed/partial-weeks rule is rewritten to the §Open-decisions ruling; Scoring push
row becomes fixed +0.5; §Tiebreakers collapses to "ties share the rank";
§Cancellations loses the re-pick block and week-move-as-cancellation; League
Settings lose Push/Tie Resolution. §Core User Flows, §Screens, §Settled pick
margin (the margin phrase survives — it rides `pickMargin`, not the tiebreaker),
§Data Freshness updated to match. Architecture: §Spread strategy rewritten to
current-spread-on-games (D15 coalesce), domain model drops `odds_snapshots`, D9
amendment's shared-table list updated, MVP Rule Scope re-pick row updated, API
surface list drops `/repick` and `/admin/games/:id/odds`. Version notes stay
honest: still v0.3-locked, amended by the SIMP-1/2/17 ADRs.

**SIMP-4 (scoring).** `pickem.ts`: drop the `PUSH_POINTS` table and
`PickemScoringSettings.pushTieResolution` (a `PICKEM_PUSH_POINTS = 0.5` const
replaces it); `pushOutcome` returns fixed 0.5; `PickemPickOutcome` loses
`differential`; delete the week-move caller-obligation note on `settlePickemWeek`
(110-116). `pickMargin` and `marginForPick` stay — grading and the margin phrase
need them. `standings.ts`: `StandingsEntry` / `RankedStandingsEntry` lose
`differential`; `rankStandings` sorts on points alone (shared ranks unchanged);
`aggregateStandings` stops summing it. Bridge scope until SIMP-6: the five
settlement sites listed in §Facts plus the `pushTieResolution` argument at
`settlement.ts:184`. Tests: push-resolution table collapses to the single 0.5
case; differential-tiebreak cases deleted; shared-rank, W/L/P, purity, and
`pickMargin` tables stay. The spec matrix as rewritten by SIMP-3 is the test plan —
every remaining §Game Mode 1 rule keeps a named case.

**SIMP-5 (schemas + contract).** Drop `PICKEM_PUSH_TIE_RESOLUTION` +
`pushTieResolution` from `PickemSettingsSchema` (Zod strips unknown keys, so
stored JSONB rows still parse; Elimination's own resolution set is untouched),
`PickemRepickRequestSchema`, `PickemMovedGameSchema` /
`NullablePickemMovedGameSchema` + `PickemPick.movedGame`,
`PickemStandingsRow.differential`, `GAME_STATUS.MOVED` (shrink
`UNPLAYED_GAME_STATUSES` to cancelled-only). **Widen
`pickemSettingsInvalidatePicks` so any `picksPerWeek` change invalidates (red-team
B2):** under exact-size submit-once, the current raise-is-harmless clause
(`league-settings.ts:104-114`) would leave already-submitted members permanently
undersized with no re-submit path; a raise must clear picks like a lower does.
Add the new write-path codes to `ERROR_CODE` (see SIMP-8); retire `PICK_NOT_FOUND`
/ `PICK_NOT_REPLACEABLE` with SIMP-8. Because the forms consume the resolution
const, this commit also removes the Push/Tie select from
`league-settings-fields.tsx`, `new.tsx`, `settings-section.tsx`, and the test-seed
default (`league-helpers.ts:176`). Regenerate `openapi/` in the same green state
as the consumer deletions; commit schema+spec+client together.

**SIMP-6 (migration).** Drizzle drops `differential` from `pickem_pick_results`
and `pickem_standings`; `drizzle-kit generate` → next sequential migration.
ADR-0003 race note: pre-launch, no production Pick'em data — expand/contract not
warranted; a race-window settlement failure is recovered by the idempotent sweep.
Say so in the PR description.

**SIMP-7 (spread collapse).** Add the provider spread column on `games` (name per
§Open decisions); resolve `overrideSpread ?? spread` inside `resolveGameOverrides`
like every other field (D15). `sync-odds` becomes an idempotent `UPDATE` of
unstarted games' spread (keep the postponed-inclusive `UNSTARTED_GAME_STATUSES`
predicate and the `kickoffAt > now` guard; drop append semantics and the "history
is intentional" test). Delete: `odds_snapshots` (schema + same migration or the
next), `latestSpreadsForGames`, the admin odds-history surface (`listGameOdds`,
`GET /admin/games/{id}/odds`, its schemas and admin-UI panel — the one reader the
epic's "no reader" claim didn't count), the `oddsSnapshots` delete in
`sim/reset.ts:130`, and the snapshot seeding in `league-helpers.ts:157` /
`reset-db.ts:40`. `apps/api/src/services/slate.ts:100` and
`admin-data.ts:172,189` read the game row.
`spread_at_pick` untouched. No backfill — dev data disposable; next sync
repopulates. **Race note (this PR description too, red-team A2):** dropping the
table breaks the previous deploy's slate reads and odds job for the race window —
user-facing, accepted under the same pre-launch licence, stated explicitly.

**SIMP-8 (write path).** `submitPickemPicks` becomes submit-once: inside the
existing transaction (member row lock retained — it is the "one submission"
concurrency guard), refuse when the member already holds **any** pick for the week
(new code `already_submitted`, 409) and when the set is not the full required set
per the §Open-decisions ruling (keep `too_many_picks` for over; new code
`pick_set_incomplete` for under — final names at implementation; codes added in the
SIMP-5 commit, mapped in `pickem-refusals.ts` with the existing
`as const satisfies Record<…>` compile-coverage pattern). Delete:
`repickPickemPick`, the `/repick` route, the replaceable/retained computation, the
delete-then-reinsert re-pricing (a submission only ever inserts), refusals
`pick_not_found` / `pick_not_replaceable`. Keep: `spread_stale` /
`spread_unavailable` (the line still moves between page load and submit;
first-submit ATS validation unchanged), `pick_locked`, `game_not_pickable`,
`duplicate_pick` (+ DB backstop), `week_out_of_range`, `game_not_in_week`,
`league_concluded`. The settings-invalidation reset (ADR-0015 §3, `crud.ts:201-262`)
survives as the one sanctioned deletion path and is now the only way a member
re-submits — coherent because the reset deletes the picks whose existence
`already_submitted` keys on, and it remains pre-start-only / refused once anything
locked. Integration tests: `pickem-picks.test.ts` loses wholesale-replace /
empty-array-clears / retention / cap-remaining-slots and gains: second submit →
`already_submitted`; under/over-size refusals; **member submits after the first
kickoff (B1 ruling pinned)**; **picksPerWeek raised after submission → picks
cleared, week re-opens (B2 pinned)**; settings-reset-then-resubmit.
`standings-repick.test.ts` loses its repick half (418-1231); its standings half
stays.

**SIMP-9 (settlement + read path).** Delete the `MOVED` synthesis
(`settlement.ts:152` — a pick's game now always grades by the game's own
`overrideStatus ?? status`; precedence unchanged), `loadMovedGameSummaries` + the
`movedGame` serialization (`picks.ts:227,260`), `sim/replay.ts:50`'s MOVED case,
the web status-label entry (`game.ts:25`), and `moved` from the admin
status-override option set (SIMP-2's contract: a week move is handled by a
`cancelled` override). Cancelled (provider or override) still routes through
`isUnplayedStatus` → push, with no substitute path. Settlement stays a pure
derivation — rebuild/sweep untouched.

**SIMP-10 (My Picks).** `pickem-picks.tsx` / `pickem-game-row.tsx` rewrite: an
unsubmitted week is an editable local sheet; Save enables only when the sheet is
complete per the §Open-decisions ruling; an irreversibility confirmation
(AlertDialog, matching the settings-reset dialog idiom) precedes the PUT; a
submitted week renders read-only rows showing `spread_at_pick`. Delete:
`pickem-substitute-dialog.tsx`, the accept-latest-spreads bar + `spreadsAccepted`
/ `repricedPickCount` state, the moved-line branch (`storedPriceSideFor`,
`movedLine`), the moved-out-of-week `<li>` + `MovedPickTeam`, `useRepick` +
`repickErrorMessage`. Keep `spread_stale` handling as toast + slate refetch (a
failed action toasts). Unit tests for deleted pure helpers go; a test for the new
completeness predicate replaces them. Mobile-first; async-button and QueryState
rules as written.

**SIMP-11 (League Picks + standings).** Standings table drops the `Diff` column
and `DIFFERENTIAL` sort member (`formatSigned` stays only if still referenced);
week-detail drops the `!game` moved branch (272-307). Ties keep sharing a rank via
server `rank` + `rankLabel`; assert nothing renders behind the rank.

**SIMP-12 (simulator).** Delete `scenarios/week-move.ts` + registry entry.
`cancelled-game` stays, now proving the push **stands**. `push-ats` / `tie-game`:
reconcile fixture arithmetic comments and expected outcomes with fixed 0.5 (their
fixtures already assume the half-point default — mostly comment edits).

**SIMP-13 (runbook).** Rewrite `docs/runbooks/pickem-regression.md`: Pass 5
deleted; Pass 3 keeps cancellation-as-push, loses the substitute half; Pass 6
keeps the display-only stale-line / 409-then-refetch checks, loses re-pricing and
accept-latest-spreads; new pass drives confirm-and-freeze (Save disabled until
complete → confirm dialog → read-only sheet → `already_submitted` on a second
attempt). Add the SIMP-2 operator note: how a provider week move would be noticed
(schedule-sync review) before the `cancelled` override is applied. Reset all pass
checkboxes — the old `[X]`s certified rules that no longer exist.

**SIMP-14 (e2e).** Update `pickem-journey.sim.spec.ts`: submissions go through the
confirmation dialog; the cap-2 league submits exactly its required set; the direct-
API post-kickoff probe asserts the new first-firing refusal (`already_submitted`);
one read-only assertion on a submitted sheet. Journeys, not branches — size and
refusal matrices stay in integration tests.

**SIMP-15 (sweep).** After SIMP-14 merges: orphan-export pass — grep every symbol
the deletions orphaned (`storedPriceSideFor`, `repickErrorMessage`, retired wire
codes, `UNPLAYED_GAME_STATUSES` if reduced to one member, odds fixtures/test
helpers, `formatSigned` if unused) and delete; run all gates.

**SIMP-16 (odds coverage).** Investigation first: inspect real ESPN week rows
(`weeks.startsAt/endsAt` from a real-season sync or recorded provider fixtures) to
establish whether the in-progress window leaves the *coming* week spread-less on
Tuesday. If real, extend `resolveTargetWeek` (or the job loop) to also cover the
next week's unstarted games; clock-pinned integration tests on the boundary either
way. Evidence: the test run plus a note recording the observed boundaries.

**SIMP-18 (preset schema).** New const set `PICKEM_SEASON_RANGE_PRESET`
(`REGULAR_SEASON` / `POSTSEASON` / `FULL_SEASON`) + `seasonRangePreset` on the
stored settings alongside the kept, resolved `startWeek`/`endWeek` refs — so
`leagueStartAt`, join cutoff, `nflSeasonOrdinal` checks, and
`pickemSettingsInvalidatePicks` are untouched. **Wire vs stored shape (red-team
A3):** the create/update *input* carries the preset only; the server resolves and
stores the range — the input schema diverges from the stored schema rather than
letting a client dictate resolved refs the ADR says are stored at creation. A
verification case pins that client-supplied `startWeek`/`endWeek` cannot override
resolution. Stored-schema shape change is licensed (no production data; dev
disposable; licence expires at launch). This commit updates every fixture that
builds a settings payload (e2e journey `:287-291`, `league-helpers.ts:176`).
Contract regen.

**SIMP-19 (creation resolves preset).** `createLeague` (and the pre-start settings
editor path) maps preset → concrete range against the bound season and
`clock.now()`: start = the later of the preset's nominal start and the next week
whose first **effective** kickoff (`min(coalesce(override_kickoff_at, kickoff_at))`
per week, matching lock derivation) is still in the future; end = the preset's
nominal end. **No-games fallback (red-team A4):** on a provisional season whose
weeks hold no games yet (ADR-0009 offseason path), resolution falls back to the
preset's nominal start — recorded in SIMP-17's ADR. Clock discipline: injected
Clock only, values bound as parameters. Integration tests: creation at instants
around a kickoff boundary and on a games-less season; assert the stored range and
that a league is never born already-started.

**SIMP-20 (forms).** One preset select replaces the two week selects in the
Pick'em fieldset; delete the pickem `encodeWeek`/`decodeWeek` call sites in
`new.tsx` and `settings-section.tsx` and the pickem week-option lists. Elimination
per §Open decisions. Both files stay in the plain-`useState` carve-out.

**SIMP-21 (preset docs).** Rewrite §GM1/§GM2 League Settings for the preset;
answer §Membership's join-cutoff question in prose: a mid-week-created league has
a short pre-first-kickoff invite window before membership freezes — the doc states
this is intended (owner confirms at PR 1; existing rule meeting a new creation
path, not a rule change).

### Verification map

Gates per PR (all local; commands per `docs/agents/testing.md`): `pnpm format` →
`pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm db:up && pnpm
test:integration` → `pnpm contract:check` (any schema/route commit) → `pnpm
--filter @picksleagues/web build` (any web commit) → `pnpm test:e2e` (merge gate,
**human-gated**: deletes every dev league — ask before each run). Evidence under
`docs/evidence/test-results/`, committed on the branch.

| Criterion (ticket) | Check | Expected | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|
| SIMP-1/2/17 ADRs recorded, incl. rules 4–5, B1 ruling, B3 failure mode, no-games fallback | Read-through; cross-refs to ADR-0015/0017 correct | ADRs match owner decisions; SIMP-2 names silent cross-week grading | PR 1 | Contradicting scope change in PR 2/3 |
| SIMP-3/21 docs reconciled | Read-through + grep for dead terms (`re-pick`, `Push/Tie Resolution`, `odds_snapshots`, `moved`, `differential`) | Spec and architecture agree; version notes honest | PR 1 | Any PR 2/3 scope change |
| SIMP-4 push fixed / no differential / shared ranks | `pnpm test` (scoring tables) | 0.5 on every push; `rankStandings` points-only; every remaining spec rule has a named case | PR 2 commit 1 (+ bridges) | Any scoring edit |
| SIMP-5 contract clean + raise-invalidates | `pnpm contract:check`; generated-client grep: no `PickemRepickRequest`/`movedGame`/`differential`/`MOVED`; unit test on widened predicate | Regen no-op; any `picksPerWeek` change invalidates | PR 2, after consumer deletions | Any schema edit |
| SIMP-6/7 migrations apply | `pnpm db:migrate` fresh + existing dev DB; `pnpm test:integration` | Columns/table gone; provider spread column present; suites green | PR 2 mid-branch | Later schema edits |
| SIMP-7 override precedence | Integration: override set → wins; cleared → provider spread; sync re-run never clobbers an override | `overrideSpread ?? spread` at serializer + settlement loader only | PR 2 | Odds/override edits |
| SIMP-7 sync-odds idempotent | Integration: run twice → identical row state, no history; postponed still covered | UPDATE semantics | PR 2 | sync-odds edits |
| SIMP-8 submit-once | Integration: second submit → `already_submitted`; over/under-size refusals; **post-first-kickoff submitter (B1)**; **raise-then-resubmit (B2)**; lock/stale/unavailable unchanged | Typed refusals; handler mapping compiles exhaustively | PR 2 | Write-path edits |
| SIMP-9 cancelled = push, stands | Integration: cancel pre/post kickoff → push result; `/repick` gone from contract; settle twice → identical state | Idempotency retained | PR 2 | Settlement edits |
| SIMP-10 confirm-and-freeze UI | e2e journey + phone-width screenshots (sheet, confirm dialog, read-only state) | Save gated on completeness; submitted week read-only | PR 2 (SIMP-14 run) | Any My Picks edit |
| SIMP-11 standings | Integration assertions + screenshot | No Diff anywhere; ties share rank, nothing behind it | PR 2 | Standings edits |
| SIMP-12 scenarios | `pnpm test:integration` (sim) + `/sim` scenario list | `week-move` absent; `cancelled-game` settles to a standing push | PR 2 | Scenario edits |
| SIMP-13 runbook | Read-through vs shipped behavior; boxes reset; operator week-move note present | No pass references a deleted flow | PR 3 | Later UI changes |
| SIMP-14 merge gate | `pnpm test:e2e` (human-gated) | Journey green on submit-once flow | PR 2 pre-merge; rerun in PR 3 after SIMP-18's fixture change | Anything |
| SIMP-15 sweep | `pnpm lint`/`typecheck` + orphan grep list in PR body | No unreferenced exports left by the epic | PR 3 | — |
| SIMP-16 Tuesday picks | Clock-pinned integration test on week targeting; observed-boundary note | Coming week's games carry spreads when picks open | PR 3 | sync-odds edits |
| SIMP-18/19 stored resolved range | Integration: create at boundary instants + games-less season; parse stored JSONB; **client-supplied range cannot override preset** | Preset + resolved refs stored server-side; never born already-started | PR 3 | Settings-schema edits |
| SIMP-20 one select | e2e create-league + phone-width screenshot | Preset select only; save validates via `LEAGUE_SETTINGS_SCHEMAS` | PR 3 | Form edits |

Real-dependency posture: no external seam — request paths never call ESPN;
integration tests run against real Postgres (`db:up` first); e2e runs the full
local stack with `SimulatedProvider`. Fixtures: sim scenarios are committed;
integration tests auto-create/migrate `picksleagues_test`; e2e deletes dev leagues
(the human gate). No cleanup owed beyond the per-PR evidence-root clear.

Human gates: (1) each `pnpm test:e2e` run — prerequisite: owner approval; action:
approve; expected: suite green; post-check: committed report under the evidence
root. (2) PR 1 review — the three §Open decisions plus ADR/doc-amendment approval
(locked-docs rule). (3) Human-only `[x]` transitions after each PR review.

### Red-team record

Review ran 2026-08-03 (risk-gated: scoring/settlement/migrations/override
precedence). Blocking: B1 late-submitter lockout → §Open decisions 1 + SIMP-8/10
notes + named tests; B2 raise-clause incoherence → SIMP-5 predicate widening +
named test; B3 SIMP-2 failure-mode error → corrected ADR content + SIMP-13
operator note. Advisories A1 (missed couplings) → folded into §Facts/PR 2/PR 3;
A2 (SIMP-7 race) → SIMP-7 note; A3 (wire vs stored preset shape) → SIMP-18; A4
(no-games fallback, effective kickoff) → SIMP-19; A5 (rules 4–5 lacked an ADR) →
SIMP-1 scope; A6 (evidence-root unit) → header; A7 (week-move detection) →
SIMP-13. One revision cycle; no unresolved blocking findings.

### Exclusions

Elimination and March Madness settings/scoring beyond the SIMP-20/21 notes;
`ELIMINATION_PUSH_TIE_RESOLUTION` (stays); `pickMargin` and the margin phrase
(stay); ADM-3 rebuild auditing (still owed to its own ticket); any deploy or cron
change (local-only surface); craft debt beyond SIMP-15's orphan sweep (flagged,
not silently absorbed, per `planning.md`).
