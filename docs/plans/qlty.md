# [EXECUTION PLAN] — QLTY epic

_Work package: the **QLTY** epic (`backlog/13-quality.md`, 4 tickets). The
ticket list in that file is the stable contract; this file is the technical plan
and never amends it._

_Recorded by `/atlas-plan`, 2026-08-06. Status: **draft — the owner has not
approved it**. Red-team review **skipped** per the risk-gated policy in
`docs/agents/planning.md`: nothing here modifies `packages/scoring` logic, lock
or pick-visibility semantics, settlement/recompute, override precedence, or a
migration — the epic edits test files, adds `data-testid` attributes to the SPA,
and rewrites the engineering-rules doc. (QLTY-4 may at most *add* API
integration cases; if it ever *changes* one that pins locking or visibility,
that PR runs `/atlas-red-team` before merge.) Run surface: **local only**.
Verification commands and evidence policy: `docs/agents/testing.md`; evidence
root `docs/evidence/test-results`, cleared per PR (each PR below is one work
package for evidence purposes — merged evidence survives in git history)._

### Intent

Nothing in this epic changes what the app does. Each ticket removes a tax on
future work: an unjustified rule (QLTY-1), a merge gate that fails on a
rewording (QLTY-2), component tests freezing presentation the owner changes at
will (QLTY-3), and browser assertions duplicating what cheaper layers already
pin (QLTY-4). This plan's added value is (a) the exact per-binding and per-test
inventories, surveyed 2026-08-06, so implementation is mechanical, (b) resolved
dispositions with the genuinely contestable calls flagged for the owner, and
(c) a criterion-level verification map including a copy-mutation probe that
proves the decoupling rather than asserting it.

### Decisions flagged for the owner

None block starting. Each is a proposed disposition the PR review rules on;
they are listed here so the ruling is deliberate, not incidental.

1. **QLTY-1 cuts are policy changes.** The plan proposes cut/keep/reword per
   rule (§QLTY-1 below); `.claude/rules/engineering.md` is team policy, so the
   PR presenting the audit table is the decision point. Nothing merges the cuts
   without that review.
2. **QLTY-3 borderline files.** Lean recorded below: keep the two ADR-0018
   invariant cases in `pickem-standings-table.test.ts`, drop
   `pickem-week-detail.test.ts` and `lib/standings.test.ts` entirely. The
   standings-label file is the closest call (its `rankLabel` "is this rank
   shared" input is a domain fact, its `"T-1"` output is display); the ticket
   itself says decide each, and the PR table is where the decision lands.
3. **QLTY-4 step-3 trim.** Lean: delete the cap-league browser step (its
   refusal matrix is fully pinned in `apps/api/test/pickem-picks.test.ts`). If
   implement finds the "own week view shows only the picked games after
   submit" behavior is API serialization rather than an SPA filter, and it is
   not already pinned, it gains one integration case in the same PR.

### Load-bearing repository facts (surveyed 2026-08-06)

- **E2E surface:** 5 specs + 4 setup modules, 1257 lines total.
  `e2e/pickem-journey.sim.spec.ts` is 586 lines, 6 serial `test()` blocks, no
  `test.step()`. Copy coupling there: **26 exact-prose binding sites (20
  distinct strings/patterns)**, plus **17 structural `.locator("li",
  { hasText: "<away> @ <home>" })` matchup-scoping bindings**, plus 3
  `[data-slot="card"]` + `hasText` scopes, against **4 testid bindings**
  (`member-picks-row`, `standings-rank`, `standings-record`,
  `standings-points`) and 20 role+name bindings that are already stable.
  Residual prose elsewhere: `identity.spec.ts` 3 sites (username-format error
  sentence, `"Profile updated"`, `"That username is already taken."`),
  `sim-panel.spec.ts` 5 sites (`"Simulated now"` ×2, `"Offset"`,
  `"Import a replay season"`, `"Page not found."`). `smoke.spec.ts` and
  `league-lifecycle.spec.ts`: zero.
- **Coverage below the journey** (why QLTY-4 can trim without losing rules):
  locking boundary + `pick_locked`, submit-once + the whole size/refusal
  matrix, and visibility filtering are pinned in
  `apps/api/test/pickem-picks.test.ts`; settlement correctness, idempotency,
  concurrency, and standings tie/skip/zero-fill in
  `apps/api/test/settlement.test.ts` + `apps/api/test/pickem-standings.test.ts`;
  grading and ranking matrices in `packages/scoring/src/pickem.test.ts` +
  `packages/scoring/src/standings.test.ts`. The journey's header comment
  already declares this division for the submission matrix.
- **Web component tests:** none of the three named files renders anything —
  each imports pure functions exported from the component module (no
  `@testing-library/react` anywhere). So "prune to domain rules" is a
  judgment about *which pure helpers encode rules*, not about DOM tests.
  They run via the root `vitest.config.ts` `unit` project glob
  (`apps/*/src/**/*.test.ts`) under `pnpm test`.
- **No domain rule is uniquely pinned at the component-test layer** except the
  two ADR-0018 decision-4 UI invariants ("never recomputes rank", "offers
  nothing behind points") — everything else cross-checks to
  `apps/api/test/pickem-picks.test.ts` or `packages/scoring` (scout-verified).

### Delivery strategy — four PRs, one ticket each

Order: **QLTY-1 → QLTY-3 → QLTY-2 → QLTY-4**. QLTY-1 and QLTY-3 are
independent and diff-disjoint (either order is fine; both are
deletion-shaped and cheap to review). QLTY-4 hard-depends on QLTY-2
(`deps:` edge) and reviews far cleaner after the rebinding has merged —
trimming and rebinding in one diff would hide which assertions were removed
vs rewritten. Branches off `staging`, PRs to `staging`, one evidence sweep
per PR.

---

### QLTY-1 — justify or cut every engineering rule

**Scope:** `.claude/rules/engineering.md` only. No code. Explicitly out:
weakening any rule's *content* — this pass edits justifications and deletes
rules that have none, it does not relax surviving rules.

**Method:** walk every bullet; classify (a) already states its failure — keep
untouched; (b) states none but an honest one exists — add the one-sentence
failure; (c) no honest failure sentence can be written — delete. The PR body
carries the full audit table (rule → disposition → why), which is the record
the ticket demands for keeps as well as cuts.

**Proposed dispositions for the named candidates** (none pre-judged; the PR
table rules):

- *"Loose coupling"* — lean **cut**: the concrete boundary rules (API-first,
  thin routes, provider shapes never leak, services own queries) already
  enforce every specific coupling failure this generic exhortation gestures
  at; as written it costs review judgment without naming a failure.
- *"A file that accretes unrelated responsibilities gets split"* — lean
  **keep + add why**: unrelated responsibilities in one file make every
  change load and merge through it — review noise, conflict surface, and
  (per `docs/agents/planning.md`'s ~400-line craft-debt line) files agents
  must read whole to change a tenth of.
- *"Prefer the latest stable versions"* — lean **keep + add why**: silent
  pinning accumulates an unscheduled breaking-upgrade cliff; the rule's
  second half (call out and schedule breaking upgrades) is the actual
  content.
- *`enum` ban* — lean **keep + add why**: TS `enum` is non-erasable syntax
  with runtime output and nominal-typing surprises the const-object pattern
  avoids, and one construct for value sets keeps every set greppable the
  same way.

**Verification map:**

| Criterion | Command / action | Expected | Evidence | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|
| Every surviving rule states its failure | Reviewer pass over the final doc (human gate: PR review; post-check = owner approves the audit table) | No rule fails the preamble's own bar | PR body audit table + diff | PR open | Any later edit to the doc |
| Doc hygiene | `pnpm format:check` | clean | command output in PR | before PR | doc edits |

---

### QLTY-3 — prune web component tests to domain rules

**Scope:** `apps/web/src/components/league/pickem-picks.test.ts`,
`pickem-standings-table.test.ts`, `pickem-week-detail.test.ts`,
`apps/web/src/lib/game.test.ts`, `apps/web/src/lib/standings.test.ts`.
Explicitly out: the other six web test files (`redirect`, `date-time-value`,
`format`, `user`, `fixture-patch`, `game-override-patch` — the ticket names
only the five), and all production code (test-only diff; helpers under test
remain in use by their components).

**Disposition table** (drop = presentation policy per the engineering rule;
each drop's lower home is listed where one exists):

| File / case | Disposition | Why / lower home |
|---|---|---|
| `pickem-picks.test.ts` › `openSelections` (5 cases) | **keep** | Domain: which held selections survive lock/slate change — the client-side face of `pick_locked`; boundary pinned in `apps/api/test/pickem-picks.test.ts` but the selection-map pruning is client logic with no other home |
| `pickem-picks.test.ts` › `pickProgressLabel` (3 cases) | **drop** | Exact copy strings ("4 of 4 picks") — wording is the owner's |
| `pickem-standings-table.test.ts` › "never recomputes rank" + "offers nothing behind points" | **keep** | ADR-0018 d4 invariants: the client must not renumber ties or offer a tiebreak column; not pinned anywhere lower (scoring pins the *server* ranking) |
| `pickem-standings-table.test.ts` › sort matrix, default sort, stability, no-mutate, empty board, `nextStandingsSort` (11 cases) | **drop** | How a board re-sorts is layout; tie *ranking* pinned in `packages/scoring/src/standings.test.ts` |
| `pickem-week-detail.test.ts` (whole file, 6 cases) | **drop file** | Member listing order is a layout answer; ranking rule in `packages/scoring/src/standings.test.ts`; visibility rule in `apps/api/test/pickem-picks.test.ts` |
| `lib/game.test.ts` › `isClosedToPicks` | **keep** | Domain gate: who may pick |
| `lib/game.test.ts` › all label/format helpers (`gameStatusLabel`, `weekTypeLabel`, `scoreText`, `periodLabel`, `clockLabel`, `gameStateLabel`, `gameStateAsOfLabel`, `pickStandingLabel`, `settledMarginLabel`, `provisionalMarginLabel`, `pickRowState`) | **drop** | Layout answers (wording/phrasing/styling enum); margin arithmetic pinned by `pickMargin` in `packages/scoring/src/pickem.test.ts` |
| `lib/standings.test.ts` (whole file: `sharedRankCounts`, `rankLabel`) | **drop file** (flagged — closest call, see §Decisions 2) | Tie-sharing pinned in scoring `rankStandings`; the surfaced `"T-1"` asserted once cross-stack by the e2e journey |

After deletion, sweep for orphaned test-only fixtures/helpers in the touched
files' imports.

**Verification map:**

| Criterion | Command | Expected | Evidence | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|
| Dispositions applied exactly; every drop names its lower home or "presentation policy" | closeout table in this file + PR body | table matches diff | PR body | PR open | any test edit |
| Unit suite green after prune | `pnpm test` | pass, no orphaned imports | output committed under evidence root | after deletions | any web/src edit |
| Static gates | `pnpm typecheck && pnpm lint && pnpm format:check` | clean | command output | before PR | any edit |

---

### QLTY-2 — decouple the E2E suite from copy

**Scope:** `e2e/pickem-journey.sim.spec.ts` (primary — 26 prose + 17 matchup
+ 3 card-scope bindings), the 3 residual prose sites in `e2e/identity.spec.ts`
and 5 in `e2e/sim-panel.spec.ts`, plus SPA edits **limited to** adding stable
`data-testid`s / accessible names in the components those bindings target
(league picks, week detail, standings, game rows). Explicitly out: removing or
weakening any assertion (QLTY-4 owns trims — this ticket rebinds, coverage is
unchanged), and any behavior or copy change.

**Rebinding strategy by category** (from the inventory above):

- **Matchup-row scoping** (17 `li` + `hasText "<away> @ <home>"` sites):
  scope `getByRole("listitem")` filtered by the contained team button
  (`getByRole("button", { name: "BUF" })`) — role-based and survives copy;
  where two rows share a team, a `data-testid="game-row"` +
  contained-button filter disambiguates.
- **Outcome values worded as sentences** (hidden-count "N more picks in — not
  yet revealed.", "Your pick: BUF · won by 10", scores "MIA 17 – BUF 27",
  `won by \d` / `lost by \d`, "Nothing has settled yet."): give the value's
  element a deliberate testid (`hidden-pick-count`, `pick-state`,
  `game-score`, board empty state) and assert the **data fragment** —
  `toContainText("3")`, `toContainText("BUF")`, `/\b10\b/` — never the
  sentence. This is the engineering rule's own carve-out: a value that must
  be located positionally gets a testid.
- **Single-word domain-state tokens** ("In progress", "Locked", "Correct",
  "Incorrect"): bind inside a testid'd status element; a one-word domain
  token may remain the asserted text (it is the domain vocabulary, not
  prose), but no full sentence survives anywhere.
- **`[data-slot="card"]` + `hasText` scopes** (3): rebind to a
  heading-anchored region (`getByRole("heading", { name: … })` →
  surrounding region/testid).
- **`identity.spec.ts`:** username-format sentence → assert the field error
  by its a11y wiring (`FormTextField` associates it) with at most a stable
  fragment; "Profile updated" → sonner toast by `role="status"` presence;
  "already taken" → field-error presence (the 409 mapping is pinned in
  integration).
- **`sim-panel.spec.ts`:** "Simulated now"/"Offset" → labelled-control
  role/name bindings; "Page not found." → heading role.
- The journey's private locator helpers (`selectPick`, `memberRow`, …) are
  the natural seam — most rebinding lands inside them.

**Verification map:**

| Criterion | Command / action | Expected | Evidence | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|
| No sentence-prose binding survives in `e2e/` | grep for each inventoried string + reviewer pass (every `getByText`/`hasText`/`toHaveText` arg is a data value, one-word domain token, or testid-scoped fragment) | zero matches | grep transcript under evidence root | after rebinding | any e2e edit |
| Decoupling is real, not asserted | Copy-mutation probe: temporarily reword one previously-bound sentence in the SPA (the hidden-count line), run the journey, then revert the reword (never commit it) | journey passes against reworded copy | probe transcript under evidence root | after rebinding | any e2e or touched-component edit |
| Merge gate green | `pnpm db:up` then `pnpm test:e2e` | 14 tests pass on the isolated e2e stack | run output under evidence root | after rebinding | any SPA or e2e edit |
| SPA intact after testid additions | `pnpm --filter @picksleagues/web build` + `pnpm test` | clean / pass | command output | after SPA edits | any web edit |
| Static gates | `pnpm typecheck && pnpm lint && pnpm format:check` | clean | command output | before PR | any edit |

Fixtures: none beyond the e2e stack's own (`picksleagues_e2e` DB and ports
5273/3100, created by `e2e/setup/global-setup.ts`; safe unattended;
prerequisite `pnpm db:up`).

---

### QLTY-4 — right-size the E2E suite (after QLTY-2 merges)

**Scope:** assertion-level audit of `e2e/pickem-journey.sim.spec.ts`; light
pass over the other four specs (already journey-shaped; expect little).
Possible additions to `apps/api/test/` where a trimmed assertion's rule has no
lower home. Explicitly out: the spine itself — create/join → submit-once
freeze → lock/reveal-by-kickoff → settle → standings is the merge gate's
reason to exist and is not up for trimming.

**Audit criterion (precommitted):** every surviving browser assertion is
either (a) a cross-stack outcome on the spine or (b) a rule with no cheaper
home. Every removed assertion's rule is named in the closeout with its lower
home (file + test title) or the classification "presentation detail — no test
owed". A trim that would remove the only cross-stack proof of a spine
behavior is a FAIL of this audit, not a size win.

**Candidate trims** (leans, ruled by the audit at implement time):

- **Step 3 (cap-shorter-than-slate league)** — delete: the size/refusal
  matrix is pinned in `apps/api/test/pickem-picks.test.ts`; the step's
  browser-unique claims are UI affordances (selection disabled at cap,
  own-view filter). Condition in §Decisions 3: if the own-view filter turns
  out to be unpinned API serialization, add the integration case in this PR.
- **Step 4's `?week=` URL write + no-duplicate-card assertions** — trim:
  routing/layout branch; keep the step's visibility outcome (own picks
  visible, other member behind a count).
- **Step 5's `aria-pressed` pair and provisional-phrasing details** — trim to
  the outcomes: pick revealed at kickoff, hidden count drops, second submit
  409s `ALREADY_SUBMITTED`.
- **Step 6** — keep (the settlement/standings cross-stack proof *is* the
  journey's payoff); the mixed-week single scenario is right-sized already —
  the full grading matrix lives in scoring.

**Verification map:**

| Criterion | Command / action | Expected | Evidence | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|
| Audit table complete before any deletion commit | per-assertion table (keep/trim + rule home) written to this file's `[PROGRESS]` | every assertion classified | this file + PR body | before deletions | journey edits |
| No rule left homeless | for each trim, cite lower home or add the integration case | cross-check against `apps/api/test` / `packages/scoring` | closeout table | with audit | integration-test edits |
| Merge gate green | `pnpm db:up` then `pnpm test:e2e` | pass | output under evidence root | after trims | any SPA/e2e edit |
| Integration suite green (only if cases added) | `pnpm test:integration` | pass | output under evidence root | after additions | api/test edits |
| Static gates | `pnpm typecheck && pnpm lint && pnpm format:check` | clean | command output | before PR | any edit |
| Size delta recorded | line/assertion count before vs after | recorded, no quota — the audit is the criterion, not a number | closeout | at closeout | — |

---

### Human gates (all four PRs)

Prerequisite: PR open with evidence committed. Human action: owner reviews
(QLTY-1: rules the audit table; QLTY-3: rules the disposition table incl. the
two flagged borderlines; QLTY-2/4: reviews rebinding/trim judgment). Expected
result: merge to `staging`. Post-check: owner (not the agent) marks the ticket
`[x]` in `backlog/13-quality.md`. Never merge; never write `[x]`.

### DoD coverage cross-check

- QLTY-1 "state the failure or delete; record why for keeps as well as cuts"
  → audit table criterion + doc diff.
- QLTY-2 "rebind to roles and accessible names, testid only where a value
  must be located positionally; before the facelift" → strategy-by-category +
  grep criterion + copy-mutation probe; sequenced ahead of the `09-launch`
  visual slice by the build order itself.
- QLTY-3 "keep what encodes a rule, drop what encodes a layout; decide
  `game.test.ts`/`standings.test.ts` each" → per-case disposition table with
  the borderlines individually decided and flagged.
- QLTY-4 "every browser assertion a journey or a rule with no cheaper home;
  push the rest down" → precommitted audit criterion + no-rule-homeless
  check + integration-case condition.

---

## [EXECUTION PLAN] — recorded by `/atlas-implement`, 2026-08-06

Invocation of `/atlas-implement QLTY` approved the contract (`backlog/13-quality.md`,
QLTY-1…4) and the technical plan above. All four tickets claimed `[ ] → [~]`.

**Repository delivery:** `picksleagues` (`.`), base `staging`, branch
`chore/qlty-quality-pass`, comparison SHA `13f08a0`. Run surface: local only.

### Deviations from the plan above

1. **One PR, four commits — not four PRs.** Atlas opens one PR per affected
   repository per work package, and the work package is the epic. The plan's
   reason for splitting QLTY-2 from QLTY-4 (so a reviewer can see which
   assertions were *rewritten* vs which were *removed*) is preserved by keeping
   them in separate commits on one branch, which `git show` separates exactly as
   two PRs would.
2. **Workers do not commit; the orchestrator does.** D1 and D2 run concurrently
   over disjoint file sets in the shared checkout. Two workers committing into
   one index race each other and the repo's `.githooks/pre-commit`; a fresh
   worktree would avoid that but needs a full `pnpm install` (no `node_modules`
   in a new worktree), which costs more wall-clock than the concurrency saves.
   So: no worktrees, disjoint file ownership enforced by the packets, and every
   commit made by the orchestrator after its acceptance screen.

### Execution structure

| # | Deliverable | Ticket | Owns (exclusive) | Depends on | Wave |
|---|---|---|---|---|---|
| D1 | Rules audit | QLTY-1 | `.claude/rules/engineering.md` | — | 1 |
| D2 | Component-test prune | QLTY-3 | `apps/web/src/components/league/*.test.ts`, `apps/web/src/lib/{game,standings}.test.ts` | — | 1 |
| D3 | E2E copy decoupling | QLTY-2 | `e2e/*.spec.ts`, SPA `.tsx` under `apps/web/src/components/league/` and `apps/web/src/routes/` | — | 2 |
| D4 | E2E right-sizing | QLTY-4 | `e2e/pickem-journey.sim.spec.ts`, `apps/api/test/` | D3 | 3 |

D1 ∥ D2 is safe: D1 is a single markdown file outside `apps/`, D2 is five
`.test.ts` files. D3 is serialized after wave 1 because it is the only
deliverable that runs `pnpm test:e2e` (fixed ports 5273/3100 and the
`picksleagues_e2e` database — one run at a time) and because it edits the `.tsx`
siblings of D2's `.test.ts` files. D4 is serialized after D3 by a real `deps:`
edge and by editing the same 586-line journey file.

### Predicted file conflicts (re-checked at closeout)

Prediction: D3 and D4 both rewrite `e2e/pickem-journey.sim.spec.ts` — the
overlap is the whole file, not incidental hunks, so no isolation scheme makes
them concurrent. D2 (`pickem-picks.test.ts`, `pickem-standings-table.test.ts`)
and D3 (`pickem-picks.tsx`, `pickem-standings-table.tsx`) are predicted
*non*-overlapping despite sharing a directory. Both predictions are verified
against the real diffs in the `[CLOSEOUT]` record.

### Verification map

Per-ticket criterion maps are in each ticket's section above and are the
precommitted map; `docs/agents/testing.md` is the evidence authority (artifacts
cited as `PASS` are committed beneath `docs/evidence/test-results`, cleared once
at the start of this work package). Aggregate gates run once on the integrated
branch: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`,
`pnpm --filter @picksleagues/web build`, and `pnpm db:up && pnpm test:e2e`.
`pnpm test:integration` runs only if D4 adds an API integration case.
`pnpm contract:check` is not mapped: no ticket touches a Zod schema, DTO, or
route.

