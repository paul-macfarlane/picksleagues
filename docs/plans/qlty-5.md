# [EXECUTION PLAN] — QLTY-5

_Work package: the single ticket **QLTY-5** (`backlog/13-quality.md`). The
ticket line is the stable contract; this file is the technical plan and never
amends it. QLTY-1..4 were delivered separately under `docs/plans/qlty.md`._

_Recorded by `/atlas-plan`, 2026-08-06. Status: **approved by `/atlas-implement`
invocation and delivered** — see the closeout at the foot of this file. Red-team
review **skipped** per the risk-gated policy in
`docs/agents/planning.md`: this work edits one policy document and comments —
no `packages/scoring` logic, no lock or pick-visibility semantics, no
settlement/recompute, no override precedence, no migration. Run surface:
**local only**. Verification commands and evidence policy:
`docs/agents/testing.md`; evidence root `docs/evidence/test-results`, cleared
at the start of this work package._

### Intent

The ticket asks for two things: (1) a concrete, written stance on the four
documentation questions `.claude/rules/engineering.md` §Quality currently
leaves unstated — doc-comment form, module headers, where a decision gets
recorded, comment density — each written with the failure it prevents, per the
preamble's own bar; and (2) a sweep bringing existing code to match, including
the two named stragglers that violate the already-standing durable-ID rule.
This plan's added value is the surveyed inventory (so the sweep is sized and
mechanical) and proposed stance wordings the PR review can rule on rather than
invent.

### Load-bearing repository facts (surveyed 2026-08-06)

- **The stragglers are the only two.**
  `grep -rnE '\((Decision|item|step) [0-9]'` over `apps`, `packages`, `e2e`,
  `docs/adr` finds exactly the two sites the ticket names:
  `apps/web/src/components/league/members-section.tsx:39` and
  `apps/web/src/api/members.ts:56` — the same comment in both places ("Moved
  from the Danger Zone (item 4/5 consolidation) — every member, regardless of
  role, can leave from here; a sole member leaving deletes the league
  (server-enforced, unchanged)."). `docs/plans/*` legitimately numbers its own
  decisions and is excluded.
- **Both comment forms are widespread and both carry contract content.**
  ~95 `//` blocks sit directly above exported declarations across
  `apps/*/src` and `packages/*/src`, alongside widespread `/** */` usage.
  The ticket's example pair is actually one file —
  `apps/web/src/lib/league.ts` — and is the perfect specimen:
  `leagueHasStarted` carries its caller-facing contract as `/** */` (surfaces
  on hover at call sites), while `canActOnLeague` carries an equally binding
  caller obligation ("pass a `useAppNow()`-derived now, never a local `Date`")
  as `//`, invisible everywhere the function is called.
- **12 modules carry header comments** (of the non-test source files across
  `apps/*/src` and `packages/*/src`). Every one sampled states a whole-module
  why — package invariant (`packages/scoring/src/index.ts` zero-I/O), Clock
  contract (`packages/core/src/clock.ts`), barrel omission rationale
  (`apps/api/src/services/leagues/index.ts`), single-home rules
  (`format.ts`, `user.ts`). None is an export inventory. The proposed header
  rule describes existing good practice; the sweep expects zero header
  deletions.
- **Precedent for changing the rules file:** QLTY-1 rewrote
  `.claude/rules/engineering.md` with the PR audit table as the decision point
  and no ADR — the rules file is team policy but not a locked v0.3 doc, so no
  lock deviation and no `/adr` gate; the human gate is the PR review.

### Proposed stances (draft wording — the PR review rules)

All four land in `.claude/rules/engineering.md` §Quality, adjacent to the two
existing comment rules; each carries its failure sentence per the preamble.

1. **Doc-comment form follows visibility.** A comment documenting an exported
   symbol is a `/** */` doc comment; comments on non-exported declarations
   and inside bodies are `//`. *Failure prevented:* editors surface only
   `/** */` at call sites — a caller obligation written as `//` above an
   export (today: `canActOnLeague`) is a contract only readers of the
   defining file ever see, so call sites violate it in good faith.
   *Corollary:* a comment above an export that is really about an
   implementation choice moves into the body rather than converting.
2. **Module headers are for a whole-module why, never inventories.** A file
   gets a header only when the module as a whole carries a why no single
   export can — a package invariant, a barrel's deliberate omissions, a
   cross-file coupling. No mandatory headers; never a contents listing.
   *Failure prevented:* a mandatory header on a module with no whole-module
   why can only restate the filename or inventory the exports — a second copy
   of the module no compiler keeps honest, wrong after the first re-export.
3. **Where a decision gets recorded is a ladder, not a habit.** ADR: a choice
   that constrains work beyond the file it's made in, or deviates from /
   extends the locked docs. Code comment (citing durable IDs): a why local to
   the surface it shapes. `docs/` page: operator knowledge — how to run,
   drive, verify. Nothing: what the code already states. *Failure prevented:*
   without a stated ladder each author records by habit — rationale lands in
   a plan file that closes with its delivery, or a local choice mints an ADR
   that buries the real ones, or the why lands nowhere and the decision gets
   re-litigated at the next touch.
4. **Density has no quota.** The why-rule is the only density rule: every
   comment earns its place by stating a why; every non-obvious constraint
   must be stated. A file is never flagged for looking sparse or dense as
   such — only for a narrating comment or a missing why. *Failure prevented:*
   a density bar in either direction is a target authors write narration to
   hit or delete load-bearing whys to fit; density is an output of the
   why-rule, not a goal.

### Decisions flagged for the owner

None block starting; the PR review is the decision point for all three.

1. **Stance wording is team policy.** The four rules above are proposals; the
   PR presenting the rules diff is where they become policy (QLTY-1
   precedent).
2. **Sweep breadth.** Lean: convert all ~95 `//`-above-export blocks per
   stance 1 (placement-based, mechanical, comment-only) in this PR — the
   ticket says "a sweep to match it", and a placement rule swept mechanically
   avoids per-site judgment drift between agent-authored files. The cost is a
   ~95-site comment-churn diff; if the owner prefers, the fallback is rules
   now + opportunistic conversion, with only the two stragglers swept — but
   that leaves the inconsistency the ticket names in place.
3. **Straggler rewrite drops the narration, not just the parenthetical.**
   Lean: delete "Moved from the Danger Zone (item 4/5 consolidation) — "
   entirely and keep the invariant ("every member, regardless of role, can
   leave from here; a sole member leaving deletes the league,
   server-enforced"). "Moved from" is delivery history — the durable-ID rule's
   own test (the sentence must read correctly with the reference deleted)
   already condemns the parenthetical, and the move itself stops being news
   the day it merges.

### Ordered steps

1. **Rules edit** — write the four stances into `.claude/rules/engineering.md`
   §Quality, integrated with (not duplicating) the two existing comment
   rules. One commit, so the policy diff reviews clean of the churn.
2. **Straggler fix** — rewrite the two named comments per flag 3.
3. **Sweep** — convert `//` blocks directly above exported declarations in
   non-test source under `apps/*/src` and `packages/*/src` to `/** */`
   (relocating into the body any that are genuinely implementation notes);
   spot-check the 12 header files against stance 2 (expect zero deletions).
   Comment-only diff; no runtime token changes.
4. **Gates and evidence** — commands below; commit evidence; open one PR to
   `staging` from a feature branch (e.g. `chore/qlty-5-comment-stance`),
   carrying the stance table and sweep summary in the body.

### Scope

**In:** `.claude/rules/engineering.md`; comment-only edits to non-test
source under `apps/web/src`, `apps/api/src`, `packages/*/src`; the two named
straggler files.
**Explicitly out:** any behavior, runtime-token, or test change; test files
(the stances apply prospectively there); writing new ADRs or `docs/` pages
(the ladder is prospective); `CLAUDE.md` and `docs/agents/*`; `e2e/`;
anything under `docs/plans/` (plans legitimately number their own decisions).

### Verification map

| Criterion | Command / action | Expected | Evidence | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|
| Four stances written into §Quality, each naming its failure (preamble bar) | reviewer pass over the doc; human gate = PR review | owner approves the wording | PR diff + stance table in PR body | PR open | later edits to the doc |
| No plan-internal numbering refs in code or durable docs | `grep -rnE '\((Decision\|item\|step) [0-9]' apps packages e2e docs/adr docs/agents` (excluding `docs/plans` and the evidence root) | zero matches | grep transcript under evidence root | after step 2 | any comment edit |
| Sweep complete: no `//` block documents an exported declaration | the plan's awk scan over non-test src (comment line(s) directly preceding `export function\|const\|class`) | zero sites, or each residual justified in the closeout | scan output under evidence root | after step 3 | any src edit |
| Straggler invariant preserved | diff review: leave-league invariant sentence survives; narration + parenthetical gone | content preserved in both files | PR diff | with step 2 | — |
| Comment-only diff, no behavior change | `git diff` inspected for non-comment hunks; `pnpm test`; `pnpm --filter @picksleagues/web build` | no runtime tokens changed; unit suite passes; build clean | outputs under evidence root | after step 3 | any src edit |
| Static gates | `pnpm typecheck && pnpm lint && pnpm format:check` | clean | output under evidence root | before PR | any edit |
| Merge gate | `pnpm db:up` then `pnpm test:e2e` | 13/13 pass | output under evidence root | after step 3 | any SPA edit |

Not mapped: `pnpm test:integration` (no `apps/api` runtime change — comment
hunks only; if review finds any non-comment hunk under `apps/api/src`, this
becomes owed) and `pnpm contract:check` (no Zod schema, DTO, or route change).
Fixtures: none beyond the e2e stack's own (`picksleagues_e2e`, ports
5273/3100, `pnpm db:up` prerequisite; safe unattended).

Candidate evidence from planning: the two greps under "Load-bearing repository
facts" (straggler inventory, `//`-above-export count), environment: working
tree at `staging` (`c29e12a`), 2026-08-06. Invalidated by any comment edit
under `apps`/`packages` before implement starts.

### Human gate

Prerequisite: PR open with evidence committed. Human action: owner reviews —
rules the four stance wordings (flag 1), the sweep breadth actually delivered
(flag 2), and the straggler rewrite (flag 3). Expected result: merge to
`staging`. Post-check: owner (not the agent) marks QLTY-5 `[x]` in
`backlog/13-quality.md`. Never merge; never write `[x]`.

### DoD coverage cross-check

- "Decide each" (form, headers, decision ladder, density) → the four proposed
  stances, each individually ruled at PR review.
- "Write it into the rules file with the failure each prevents" → criterion 1
  (preamble-bar check on the doc diff).
- "Sweep the two known stragglers" → criteria 2 and 4.
- "A sweep to match it" → criteria 3 (style sweep) and the header spot-check,
  with the comment-only criterion bounding the blast radius.

---

# [PROGRESS] — QLTY-5

Branch `chore/qlty-5-comment-stance` off `staging` at `c29e12a`. Single
repository delivery, direct checkout, no worktrees: the three deliverables own
disjoint paths, workers were barred from committing and from repo-wide writes
(notably `pnpm format`), and the orchestrator made every commit by path. The
predicted zero file overlap was rechecked against the real commits at closeout
and held — no file appears in more than one deliverable commit.

| Deliverable | Scope | Worker / model | Commit |
|---|---|---|---|
| D1 | Four stances into `.claude/rules/engineering.md` §Quality | orchestrator, Opus 5 | `9d2555c` |
| D2 | `apps/web` sweep (71 sites / 45 files) + both straggler rewrites | `atlas-worker`, Sonnet | `ae54ebe` |
| D3 | `apps/api` + `packages/*` sweep (29 sites / 14 files) | `atlas-worker`, Sonnet | `fe4eb87` |
| — | Orchestrator review fixes (see AI Code Review finding 1) | orchestrator, Opus 5 | `cd65072` |

Sweep breadth: flag 2 was taken at its **lean** — the full mechanical
conversion, 99 of 100 scanned sites, rather than rules-now/convert-later.

# [AI CODE REVIEW] — QLTY-5

Single formal review, performed by the frontier orchestrator over the complete
integrated diff. Two axes.

## Axis 1 — technical implementation and spec conformity

**Finding 1 (blocking, resolved in `cd65072`) — the ticket's own straggler
grep was too narrow, and the sweep promoted one survivor into a doc comment.**
The scan keyed on `\((Decision|item|step) [0-9]`, which misses the same failure
worn differently: `(feedback item 11)` in `packages/schemas/src/leagues.ts`,
`(feedback round 4)` and `(feedback round 5)` in `pickem-week-detail.tsx`, and
`(feedback round 5)` in `sim-clock-banner.tsx`. Each points into a review round
that exists in no durable record — precisely what the standing rule forbids —
and D3 had just converted the first into a `/** */`, raising its visibility.
Fixed inline rather than returned to the workers: four localized wording
deletions across three files, no design change. Each sentence reads correctly
with the parenthetical removed, which is the rule's own test for decoration.

Deliberately **not** changed: references of the form `ADR-0018 decision 4`,
`ADR-0011 decision 4`, `arch §Simulator & Time point 2`. These name the record,
which is exactly what the rule endorses; treating them as violations would have
been a misreading of it.

**Finding 2 (non-blocking, accepted) — one residual `//` above an export.**
`apps/api/src/lib/default-hook.ts` keeps its line comment. The export already
carries a `/** */` contract; the residual note explains the `any` and sits
directly above an `eslint-disable-next-line` directive that must stay adjacent
to the line it suppresses. Converting it would leave the directive, not the doc
comment, nearest the declaration — inverting the rationale the stance exists to
serve. Accepted as correct application of the rule, not an exception to it.

**Finding 3 (non-blocking, accepted) — two comments relocated rather than
converted,** per the stance's corollary: `game-override-form.tsx`'s remount-key
strategy and `theme-toggle.tsx`'s hydration note describe how the body works
and are of no interest to a caller. Both moved into the function body as `//`.
Reviewed and correct.

**Observation (no action) —** `apps/web/src/lib/user.ts` cites "(PKM UX
feedback)". It carries no numbering, so it is outside the rule as written, but
it names no durable record either. Left alone rather than widened into scope.

Spec conformity: the four stances answer the four questions QLTY-5 names —
doc-comment form, module headers, the decision-recording ladder, density — each
with the failure it prevents, which is the preamble's bar the ticket invokes.
The motivating example is fixed: `canActOnLeague`'s `useAppNow()` obligation is
now a doc comment, one function below `leagueHasStarted`'s. Both named
stragglers are rewritten, keeping the leave-league invariant and dropping the
delivery narration.

## Axis 2 — coding standards

Conforms to `.claude/rules/engineering.md`, including the two rules this work
extends. Comment content is preserved verbatim throughout — this is a form
conversion, which matters most in `packages/schemas`, where several comments
state binding contract rules (the `.openapi()` registration hazard, settings
JSONB additivity, the league caps). No rule in the file contradicts the four
added stances; they sit adjacent to the two existing comment rules and
reference them rather than restating them. Module headers were spot-checked
against stance 2 across both sweeps: all are whole-module whys, zero deletions,
as the plan predicted.

No unresolved blocking findings on either axis.

# [CLOSEOUT] — QLTY-5

Repository delivery: `picksleagues`, branch `chore/qlty-5-comment-stance`,
base `staging` at `c29e12a`, verified at `cd65072`. Run surface: local only.
Pull request: https://github.com/paul-macfarlane/picksleagues/pull/35
Evidence root `docs/evidence/test-results`, cleared at the start of this work
package and committed on the branch.

## Verdicts

| Criterion | Verdict | Evidence |
|---|---|---|
| Four stances in §Quality, each naming its failure | **HUMAN GATE — pending** | The PR diff. By the plan's own design the owner rules the wording; no agent verdict is available or claimed. |
| No plan-internal numbering in code or durable docs | **PASS** | `sweep/scans.txt` §2 — zero matches in non-test source |
| Sweep complete: no `//` documents an exported declaration | **PASS** | `sweep/scans.txt` §1 — 99/100 converted, 1 residual justified above |
| Straggler invariant preserved | **PASS** | `ae54ebe` diff — invariant intact in both files, narration gone |
| Comment-only diff, no behavior change | **PASS** | `sweep/scans.txt` §3 — all 60 changed files byte-identical once comments are stripped |
| Static gates | **PASS** | `static-and-unit/gates.txt` — `pnpm typecheck`, `lint`, `format:check` all exit 0 |
| Unit suite | **PASS** | `static-and-unit/gates.txt` — 439 passed / 26 files |
| Web build | **PASS** | `static-and-unit/gates.txt` — `pnpm --filter @picksleagues/web build` exit 0 |
| Merge gate | **PASS** | `merge-gate/e2e.txt` — 13/13 Playwright specs passed |

`pnpm contract:check` was not owed (no Zod schema, DTO, or route change) but was
run anyway because `packages/schemas` comments were touched: exit 0, `openapi/`
unchanged — independent confirmation that nothing runtime moved.
`pnpm test:integration` was not owed and not run: the map made it owed only if
review found a non-comment hunk under `apps/api/src`, and none exists.

## Deviations from the plan

1. **Scope widened by three sites, deliberately.** The plan scoped the
   straggler fix to the two the ticket names. Review found three more of the
   same class in non-test source (AI Code Review finding 1). They sit inside
   the paths the sweep already owned and are comment-only, so they were fixed
   here rather than deferred — deferring would have shipped a PR that states
   the rule and leaves fresh violations of it in the files it just edited.
2. **Two survivors left out of scope, not fixed:** `(feedback item 10)` in
   `apps/api/test/invites-join.test.ts` and `(feedback round 6)` / `(round 5)`
   in `e2e/pickem-journey.sim.spec.ts`. The plan explicitly excludes test and
   `e2e/` files. Worth a follow-up ticket; not taken unilaterally.
3. **The completeness grep in the plan's verification map was too narrow** and
   is superseded by the widened scan recorded in `sweep/scans.txt` §2, which
   excludes ADR- and spec-anchored forms rather than only the three literal
   keywords.

## Human gate

Prerequisite (met): PR open with evidence committed. Owner action: rule the
four stance wordings (flag 1), the sweep breadth as delivered (flag 2), and the
straggler rewrite (flag 3). Expected result: merge to `staging`. Post-check:
the owner — not an agent — marks QLTY-5 `[x]` in `backlog/13-quality.md`.
