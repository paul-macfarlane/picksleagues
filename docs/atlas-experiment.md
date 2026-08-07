# Atlas experiment

Running [`atlas-v3`](https://github.com/JahnelGroup/atlas-plugin-v3) as this repo's development harness in place of the repo's own `/task` pipeline, to find out whether it's a net improvement for a solo, single-repo project.

**Status:** set up. `/setup-matt-pocock-skills` and `/setup-atlas` both ran on 2026-08-03; the scaffold verifier passes every check except the git-hook activation, which is a deliberate human prerequisite (see §7). No real work package has gone through `/atlas-implement` yet.

Everything below lives on the `chore/atlas-experiment` branch (off `staging`). Reverting is `git checkout staging && git branch -D chore/atlas-experiment` plus the two commands under [Rollback](#rollback).

---

## 1. What Atlas is

A plugin providing five skills — `/setup-atlas`, `/atlas-plan`, `/atlas-implement`, `/atlas-red-team`, `/atlas-improve` — and three agent profiles (`atlas-worker`, `atlas-planner`, `atlas-red-team-reviewer`). `/setup-atlas` runs a Python scaffold that generates a `CLAUDE.md` router section, `docs/agents/*.md` policy documents, `.claude/settings.json` deny/ask rules, a `guard.py` PreToolUse hook, and `.githooks/{pre-commit,pre-push,commit-msg}`. The other skills then execute against those generated documents.

It is designed for **teams with a real issue tracker and multi-repository workspaces**. This repo is neither, so parts of it (per-repo worktrees, cross-repository aggregate verification, PR-per-repository, `.claude/atlas-state/*.json`) are overhead here. Atlas degrades gracefully — it explicitly says not to create worktrees where they add no safety benefit — but that mismatch is one of the things the experiment is measuring.

## 2. Prerequisites (done)

| Item | State |
| --- | --- |
| `mattpocock-skills@claude-plugins-official` | Installed, **exactly `1.2.0`** — Atlas hard-stops before apply on any other version |
| `atlas-v3@atlas-local` | Installed from a local marketplace wrapper |
| Local marketplace | `~/.claude/local-marketplaces/atlas/` — a `marketplace.json` plus a symlink `atlas-v3 → ~/code/atlas-plugin-v3`, so edits to the checkout take effect on `claude plugin update` |
| `python3` | 3.12.0 — required by the scaffold and all generated hooks |
| `gh` | 2.86.0 |
| Docker | running |
| `gitleaks` | installed (`/opt/homebrew/bin/gitleaks`) — the generated pre-commit uses `gitleaks git --staged --redact` and **fails closed**; the documented lower-strength fallback never engages |

The `~/code/atlas-plugin-v3` checkout is **not a git repository** and has no `marketplace.json` of its own, which is why the wrapper exists. If the real repo later publishes a marketplace, replace the wrapper with a normal `claude plugin marketplace add`.

## 3. What was parked, and why

Moved to `.claude/_parked/` (not a location Claude Code loads from). See `.claude/_parked/README.md` for the full table. Summary:

| Parked | Replaced by |
| --- | --- |
| `/task` | `/atlas-implement` (+ optional `/atlas-plan`) |
| `/backlog` | generated `docs/agents/issue-tracker.md` |
| `/feedback` | `/atlas-implement` against the feedback file as the stable contract |
| `/simplify` | **nothing** — real coverage gap |
| `/verify` | content moved to `docs/agents/verification-runbook.md`; policy to generated `docs/agents/testing.md` |
| `implementer` agent | `atlas-worker` |
| `evaluator` agent | **nothing** — deliberate, see §6 |

Kept active: `/adr`, `/ask`, the `scout` agent, `.claude/rules/engineering.md`, and `.claude/hooks/guard-destructive.sh`.

`/adr` staying is a deliberate call, not an oversight. What's parked is the *delivery pipeline*; `/adr` and `/ask` are authoring and read-only tools orthogonal to it. Atlas disclaims ADR authoring outright — `/setup-atlas` is instructed not to manufacture ADR content, and the planning guidance it generates tells agents to escalate and record an ADR, i.e. it assumes an external mechanism. Parking `/adr` would test Atlas on a capability it never claimed and confound the four measurements in §6 with a result that means nothing either way.

## 4. Answers for `/setup-atlas`'s confirmation steps

Setup asks for confirmation in ten numbered sections. These are the answers — give them rather than letting it infer.

**1 — Workspace identity.** Single-repository workspace. Repository ID `picksleagues`, path `.`, source host GitHub (`paul-macfarlane/picksleagues`). **Base branch is `staging`, not `main`** — feature branches cut from `staging`, PRs target `staging`, and `staging → main` promotes to production. `origin/HEAD` points at `staging` but GitHub's configured default branch is `main`; if setup reads the GitHub default it will get this wrong. Protected branches: `staging` and `main`. PR command: `gh pr create --base staging`.

**2 — Tracker.** Local Markdown, in `backlog/`. Do **not** let it invent states. The real conventions, from `backlog/README.md`:
- One file per epic; each task is `- [ ] **FND-1** — Description. _(deps: none)_`
- States: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked
- IDs are stable once created and are referenced by commits, ADRs, and PRs. Never renumber; new tasks append the next number in that epic.
- **Availability rule:** a task is available when it is `[ ]` and every ID in its `deps:` is `[x]`.
- **Ordering rule (load-bearing):** the next task walks epics in the order given by `backlog/README.md` §Build order — *not* the order the epic files sort in. File numbers record when an epic was written, not its priority, and `09-launch` is deliberately split across two positions. Directory order is wrong and cannot be fixed by renaming.
- Ownership/impediment: solo project — no assignee field. `[!]` plus a note is the impediment representation.
- Human-only transitions: none, but scope changes and deviations from the locked docs are human decisions (see §5).

**3 — Ready meanings.** Ready-to-implement = the task's `deps:` are all `[x]` and the behavior is defined by `docs/mvp-spec.md` (what) and `docs/architecture.md` (how). Tasks are deliberately written as goals pointing at doc sections rather than restating mechanics, so "the ticket is thin" is normal here and is **not** a readiness gap — the doc section is the contract.

**4/5 — Commands.** Classify honestly; all `verified` entries below were executed successfully on this branch on 2026-08-03.

| Command | Status | Covers / when |
| --- | --- | --- |
| `pnpm typecheck` | verified | `tsc` across all workspaces. Every change. |
| `pnpm lint` | verified | ESLint, incl. the Clock rule and `max-lines` warnings. Every change. |
| `pnpm test` | verified | Vitest unit, no DB. Every change. |
| `pnpm test:integration` | verified | In-process Hono against real Postgres; auto-creates and migrates `picksleagues_test`. Any API/DB/service change. |
| `pnpm contract:check` | verified, clean | Fails if `openapi/` is stale. Any Zod schema or route change. |
| `pnpm db:up` / `pnpm db:migrate` | verified | Docker Postgres on **port 5433**; applies `packages/db/migrations`. |
| `pnpm test:e2e` | verified | Playwright against the full local stack; starts or reuses both dev servers itself. The merge gate. |
| `pnpm format` / `format:check` | inferred | Prettier. |
| **`pnpm build`** | **unavailable at root** | There is no root `build` script. The only build is `pnpm --filter @picksleagues/web build` (`tsc -b && vite build`); `apps/api` and all packages have none. Do not let setup record `pnpm build` as a gate. |

**6 — Evidence.** Evidence root is **`docs/evidence/test-results`**, not `test-results/`. `test-results/` is gitignored Playwright scratch and stays that way; Atlas requires `PASS` evidence to be committed, so evidence is curated under `docs/evidence/` instead. Cleared per work package, one subdirectory per test name. Full policy in `docs/evidence/README.md`. This repo's primary verification harness is the **season simulator**, so a driven-simulator transcript is usually stronger proof than a screenshot — mechanics in `docs/agents/verification-runbook.md`.

> The `test-results` path segment is **not optional**: `atlas_scaffold.py` hard-rejects any `evidence.test_results_dir` whose parts don't include one (`"test-results" not in results_dir.parts`). A bare `docs/evidence` fails validation, which is why the root is one level deeper than this section originally specified. The scaffold appends `!docs/evidence/test-results/` and `!docs/evidence/test-results/**` to `.gitignore` so the path escapes the repo's existing `test-results/` ignore rule; verified committable with `git add --dry-run`.

**7 — Plugins.** Already installed and relevant: `vercel`, `context7`, `frontend-design`, `code-review`, `ralph-loop`. Genuinely applicable and *not* installed: `typescript-lsp` (requires `typescript-language-server` on PATH — verify before recommending) and `playwright`. Decline the AWS/Azure/Terraform families — none apply.

**8 — Guardrails.** Keep the existing `.claude/hooks/guard-destructive.sh` registration; Atlas merges its own hooks additively rather than replacing it. That hook covers three repo-specific risks Atlas's generic `guard.py` knows nothing about: `vercel --prod`/`promote`/`rollback`, `drizzle-kit push|migrate` against a non-localhost `DATABASE_URL`, and `curl` to `/jobs/*` or `/sim/*` on a non-local host.

**9 — Planning.** Red-team review on demand rather than mandatory — this is a solo repo and `/atlas-red-team` on every plan is not worth the tokens. Escalate to the human (do not decide autonomously) when a change would deviate from `docs/mvp-spec.md` or `docs/architecture.md`, both **locked at v0.3 and mutually reconciled**; a deviation needs an ADR first via `/adr`.

**10 — Files.** Review the preview list before approving apply. Expect `CLAUDE.md` (appended marker section), `docs/agents/*.md`, `.claude/settings.json`, `.githooks/*`, `.claude/hooks/atlas/guard.py`, `.gitignore`, `.atlas/manifest.json`.

## 5. Conflicts and how they were resolved

**Git hooks — the one destructive change.** Only one `core.hooksPath` can be active. The repo is currently on `.husky/_` (husky → `lint-staged`); Atlas requires `.githooks`. **Decision: go full Atlas for the experiment.** After `/setup-atlas` applies:

```sh
git config core.hooksPath .githooks     # husky/lint-staged stops running on commit
```

`lint-staged` formatting is then no longer enforced at commit time — `pnpm lint` and `pnpm format:check` in the pipeline are the backstop. In exchange you gain a staged-secret scan, conventional-commit subject enforcement, and a pre-push guard that hard-blocks pushes to `staging`/`main` and remote branch deletion (stricter than the current hook, which only prompts).

**Evidence root.** Resolved by pointing Atlas at `docs/evidence/` — see §4.6.

**`Edit(CLAUDE.md)` prompts.** Atlas adds `Edit(CLAUDE.md)`, `Edit(**/.claude/settings.json)`, and `Edit(**/.claude/hooks/**)` to `permissions.ask`. Expect extra prompts when editing those.

## 6. What to judge the experiment on

The two things most likely to make or break it:

1. **Loss of the risk-gated `evaluator`.** Atlas requires the orchestrator to perform the single formal code review *itself* and explicitly forbids delegating the accept/reject judgment; `atlas-worker` is told not to spawn review agents. The repo's own rule was the opposite: a fresh-context Opus `evaluator` was **mandatory** on diffs touching `packages/scoring`, lock/visibility semantics, settlement/recompute, override precedence, or a migration — on the stated grounds that this repo's bugs will live there. Atlas's self-review by the same context that orchestrated the work is a weaker check on exactly that surface. Watch for it.
2. **No `/simplify` equivalent.** Atlas reviews correctness and standards conformity, not craft debt — duplication, accretion past ~400 lines, idiom drift. Epic-scale close-outs previously ran a dedicated pass. Nothing in Atlas does this.

Also worth measuring: whether Atlas's per-criterion verification map is genuinely better than the old "run the gates plus drive the flow" step, or just more ceremony; and how much the multi-repo apparatus costs in tokens on a single-repo project. `/atlas-improve` is built to answer the token question — run it after the first work package and compare against a `/task` run of similar size.

**The baseline is the game-clock epic (PR #22, `9a0844b`), pinned 2026-08-03 before any Atlas work package ran.** Naming it in advance is the point: a comparator chosen after seeing Atlas's result is not a comparator. It is the most recent `/task` work and the closest in size to a `SIMP` package.

## 7. Next steps

1. ~~Restart Claude Code~~ — done. Both plugins load; note that all five Atlas skills and `setup-matt-pocock-skills` carry `disable-model-invocation: true`, so **only a human can start them** by typing the slash command.
2. ~~`/setup-matt-pocock-skills`~~ — done. Wrote `docs/agents/{issue-tracker,triage-labels,domain}.md`. The seed `issue-tracker-local.md` template (`.scratch/<feature>/spec.md`, per-ticket files) was discarded and the doc written from scratch against the real `backlog/` conventions.
3. ~~`/setup-atlas`~~ — done, applied after a worktree dry-run diff. 12 targets; `.claude/settings.json` merged additively and kept `guard-destructive.sh`.
4. **`git config core.hooksPath .githooks`** — still owed, and deliberately human-only: an agent that can install the enforcement path could also remove it. Then rerun:
   ```sh
   python3 "$HOME/.claude/local-marketplaces/atlas/atlas-v3/scripts/atlas_scaffold.py" verify --repo .
   ```
   Top-level `passed` stays `false` until the hook path is active; every other check already passes.
5. Commit the setup as one commit on `chore/atlas-experiment`.
6. Run one real backlog task end-to-end via `/atlas-implement`. `SIMP` or `QLTY` epic tasks are good candidates — meaningful but not on the scoring hot path, so a weaker review is lower risk for a first run.
7. Run `/atlas-improve` on it and compare against the `/task` baseline.

### Defects found in the scaffold's output (patched locally)

All three blocks are written by `initialize_guidance`, meaning Atlas writes them once and treats them as team-owned thereafter — so these edits survive a scaffold rerun.

- **`issue-tracker.md` lifecycle collapse.** Atlas wants seven lifecycle slots; this backlog has four markers, and the validator permits several slots to name one state. The generator then emitted the mapping literally: "Enter `[ ] todo` only when starting any work" (inverted), three separate "Enter `[~] in progress` only when …" lines, and a lifecycle reading `… → [x] done → [!] blocked`. Rewritten to say what is actually true — claiming moves `[ ] → [~]`, `[~]` covers every working phase with **no** transition between them, and `[!]` is an orthogonal flag rather than a terminal state.
- **`.gitignore` marker syntax.** Atlas writes `<!-- … -->` HTML comments into a file whose comment character is `#`, so git parsed the two marker lines as literal patterns. Inert (they match nothing) but wrong; prefixed with `# `. Safe because marker detection is a substring test.
- **`CLAUDE.md` cloud overclaim.** It asserted "Mutating cloud and infrastructure actions are denied by default" while generating denies only for Terraform/CDK/kubectl. Vercel has no deny rule; its protection is this repo's `guard-destructive.sh`, which *prompts*. Corrected to say so.
- **`format:check` regression.** The generated `.atlas/manifest.json` is not Prettier-formatted, so `pnpm format:check` — a recorded gate — started failing. `.atlas` and `.githooks` added to `.prettierignore` rather than reformatting a machine artifact the verifier integrity-checks.
- **Configured plan storage was ignored** (found on the first `/atlas-plan` run, 2026-08-04). `planning.publication.storage` was set to `repository`, but the plan was appended to `backlog/12-simplification.md`, taking the epic from 63 lines to 460. Cause: `atlas-plan/SKILL.md` routes the storage decision to `docs/agents/issue-tracker.md`, where the setting renders as a bare noun — `Planning artifact storage: **repository**` — with no path, filename, or format. Five lines below it, `atlas_scaffold.py:841-845` emits *unconditionally* (no branch on the storage value) a concrete instruction to record `[EXECUTION PLAN]` and friends in the ticket. The planner followed the instruction that had a mechanism attached. `planning.md` never closes the gap either: it defines `repository` storage only for the spec-file flow and says tracked work "uses the configured storage", which is circular. For a markdown tracker the two settings also name the same physical medium, so there was no contradiction to detect from inside. Fixed by making the path normative in `issue-tracker.md` (`docs/plans/<work-package-id>.md`) and scoping the record convention to that file; see `docs/plans/README.md`.

### The pattern worth watching

Two of the five defects above — the lifecycle collapse and the plan-storage miss — are the same failure: **an abstract configured value lost to a concrete unconditional instruction elsewhere in the same generated document.** That is a property of how the scaffold composes guidance, not two unrelated bugs, and it predicts where the next one will be. When configuring Atlas, a setting that renders as a bare noun with no mechanism should be treated as not yet configured.

## Rollback

```sh
# 1. restore the harness
git checkout staging && git branch -D chore/atlas-experiment

# 2. restore husky
git config core.hooksPath .husky/_

# 3. optional — remove the plugins
claude plugin uninstall atlas-v3@atlas-local
claude plugin marketplace remove atlas-local
# keep mattpocock-skills; it is useful independently
```

If the branch was already merged, restore just the harness with:

```sh
git mv .claude/_parked/skills/* .claude/skills/
git mv .claude/_parked/agents/* .claude/agents/
git mv docs/agents/verification-runbook.md .claude/skills/verify/SKILL.md   # re-add its frontmatter
```
