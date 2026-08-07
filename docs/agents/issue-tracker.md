# Issue tracker: local markdown (`backlog/`)

Issues for this repo live as markdown checklists in `backlog/`, one file per epic.
There is no external tracker — this repo's GitHub Issues is unused and should stay
that way. Never run `gh issue create` for this repo.

## Conventions

- One file per epic: `backlog/<NN>-<slug>.md`. Each epic owns a stable ID prefix
  (`FND`, `SIMP`, `QLTY`, …); the table in `backlog/README.md` §Epics is authoritative.
- A task is one checkbox line:

  ```
  - [ ] **SIMP-3** — Short description. _(deps: SIMP-1)_
  ```

- **States — these four are the entire vocabulary. Do not invent others:**

  | Marker | Meaning                                               |
  | ------ | ----------------------------------------------------- |
  | `[ ]`  | todo                                                  |
  | `[~]`  | in progress                                           |
  | `[x]`  | done                                                  |
  | `[!]`  | blocked — always accompanied by a note saying by what  |

- **IDs are stable forever.** Commits, ADRs, and PRs reference them. Never renumber,
  never reuse. A new task appends the next number in that epic.
- **Deps** are inline: `_(deps: FND-6, LG-2)_` or `_(deps: none)_`.
- Tasks are written as **goals** — the outcome plus the `docs/mvp-spec.md` /
  `docs/architecture.md` section that defines it. A thin task line is normal and
  correct here: the doc section is the contract. Do not restate doc mechanics in the
  task line, and do not treat thinness as a readiness gap.
- Solo project — no assignee field. `[!]` plus a note is the whole impediment
  representation.

## Availability rule

A task is available when it is `[ ]` **and** every ID in its `deps:` is `[x]`.

## Ordering rule (load-bearing)

The next task walks epics in the order given by **`backlog/README.md` §Build order** —
_not_ the order the epic files sort in, and not the epic numbers. File numbers record
when an epic was written, not its priority, and `09-launch` is deliberately split
across two positions. Directory order is wrong here and cannot be fixed by renaming.

Read §Build order before selecting work; it is dated and changes. As of 2026-08-03:
`12-simplification` → `13-quality` → `09-launch` (visual + legal slice) →
`06-survivor` → `09-launch` (remainder) → `07-march-madness` → `10-trust-safety`.
`ID-4` and `ADM-3` are open stragglers in otherwise-complete epics — take them when
they block something, not for tidiness.

## When a skill says "publish to the issue tracker"

Append a task to the epic file it belongs to, taking the next unused number in that
epic's sequence. If no existing epic fits, stop and ask — a new epic file is a human
decision.

## When a skill says "fetch the relevant ticket"

Read the epic file and locate the ID. The user normally passes the ID directly (`SIMP-3`).

## Escalate, don't decide

`docs/mvp-spec.md` and `docs/architecture.md` are **locked at v0.3** and mutually
reconciled. A change that would deviate from either is a human decision and needs an
ADR first (`/adr`). Never resolve such a deviation autonomously.

<!-- atlas-v3:tracker:start -->

## Atlas tracker contract

Tracker type: **local**.

This document is the authoritative repository policy for tracker reads, writes,
readiness, availability, claims, ownership, transitions, human-only actions,
and planning-artifact publication.

## States

| State | Meaning |
|---|---|
| `[ ] todo` | Not started. Available to claim once every dependency ID is [x]. |
| `[~] in progress` | Claimed and being worked. This single marker covers planning, plan review, implementation, and both AI and human review -- the backlog does not distinguish those phases and must not be given new markers to do so. |
| `[x] done` | Delivered, verified against the gates, and merged. |
| `[!] blocked` | Impeded, always accompanied by a note naming what blocks it. Off-lifecycle: it is not a phase, it is a flag on a task in any phase. |

Human-only states: none.

Recommended lifecycle: `[ ] todo` → `[~] in progress` → `[x] done`.

`[!] blocked` is **not** a lifecycle position. It is a flag that can be set on a task in
any phase and cleared when the impediment lifts — it does not follow `[x] done`.

## Read and write rules

- Read the complete ticket and comments before planning or implementation.
- Check for available work before claiming. Available work is ready to
  implement, unclaimed, in an eligible state, has no active impediment or
  blocking decision, and every `blocked by` ticket is in
  `[x] done`. A dependency that is not a `blocked by` edge does
  not make work unavailable.
- Claim before starting work and use one active owner. Claiming means moving the task
  from `[ ] todo` to `[~] in progress`. Never write `[ ]` back onto a task that is
  already being worked.
- **`[~] in progress` covers every working phase** — planning, plan review,
  implementation, AI code review, human review, verification, and PR creation. Atlas
  distinguishes those phases internally; this backlog deliberately does not, and must
  not be given new markers to represent them. Moving between phases therefore involves
  **no tracker transition at all**: record the phase in the work package's own records
  (`[EXECUTION PLAN]`, `[PROGRESS]`, `[AI CODE REVIEW]`, …), not in the checkbox.
- Record blocks, approved scope changes, proof of work, and the PR URL.
- Compare the next Atlas phase with the last-known tracker state from the
  initial ticket read or most recent successful transition. Do not fetch the
  ticket solely for this comparison. When both map to the same state, record
  the phase in its configured phase record or comment without requesting a
  same-status transition.
- Never enter `[x] done`; a human does that after reviewing the PR.
- When blocked, preserve work, record the exact reason and resume instructions,
  and follow the configured blocked-state behavior. On resume, reread the ticket
  and avoid duplicating claims, transitions, workers, commits, or comments.
- **Planning artifact storage: `repository` — and here that means a specific path,
  not "somewhere in the repo".** A technical plan is written to
  **`docs/plans/<work-package-id>.md`**, lowercased: `docs/plans/simp.md` for an
  epic, `docs/plans/simp-3.md` for a single ticket. The epic file gets a short
  pointer to it under a `## Technical plan` heading and **nothing more**.
  Never inline a plan into a `backlog/` epic file.

  This needs saying explicitly because the tracker is itself markdown in this
  repository, so `repository` and `tracker` storage would otherwise be the same
  physical medium and the setting would carry no instruction. The reason to keep
  them apart: epic files are a thin contract of goal-shaped ticket lines, and a
  400-line plan inlined among them destroys that. See `docs/plans/README.md`.

- **Scope of the record convention below.** `[EXECUTION PLAN]` names a *section
  inside the plan file*, not a record appended to the ticket. `[PROGRESS]`,
  `[SCOPE CHANGE]`, `[BLOCKED]`, `[AI CODE REVIEW]`, and `[CLOSEOUT]` are
  execution records and belong in the plan file too, appended as work proceeds.
  The epic file receives only checkbox transitions and the plan pointer.
- Drafts before approval: **true**.
- Preview exact plan writes and transitions before publishing them. If drafts
  are not permitted, return the draft without presenting it as tracker state.
- **Exception — Atlas execution.** Invoking `/atlas-implement` is itself the
  approval to claim the tickets that work package names and to write its
  execution records (`[EXECUTION PLAN]`, `[PROGRESS]`, `[AI CODE REVIEW]`,
  `[CLOSEOUT]`). Those writes proceed without a preview — the human gate is the
  PR review, and an autonomous run has nobody to preview them to. The preview
  requirement still binds anything that changes a ticket's **text**, adds or
  renumbers a ticket, or writes `[x]`.

  This needs stating because the two rules otherwise contradict each other: the
  skill treats invocation as approval to deliver, this document asks for a
  preview first, and a run with no human watching resolves that conflict
  arbitrarily.
- Preserve stable ticket/spec requirements. Record evolving execution in
  `[EXECUTION PLAN]`, `[PROGRESS]`, `[SCOPE CHANGE]`, `[BLOCKED]`,
  `[AI CODE REVIEW]`, and `[CLOSEOUT]` records rather than silently rewriting
  the contract. **All of those records live in the plan file at
  `docs/plans/<work-package-id>.md`** (see the storage rule above), never
  appended to the `backlog/` epic file. Write the complete AI Code Review output
  there before requesting human review.

Before creating, classifying, prioritizing, or decomposing tickets, also read
and follow `docs/agents/triage-labels.md`. Do not infer labels or priority from
this document.

## Readiness

Ready to plan: The task exists in a backlog/ epic file with a stable ID, and the behavior it names is defined by a section of docs/mvp-spec.md (what) or docs/architecture.md (how). Tasks are deliberately written as thin goals pointing at those sections rather than restating mechanics, so a short task line is normal and is NOT a readiness gap.

Ready to implement: The task is [ ] and every ID listed in its _(deps: ...)_ is [x]. No further ticket detail is required; the referenced doc section is the contract.

Available to claim: The task is [ ] and every ID in its deps is [x], selected by walking epics in the order given by backlog/README.md section 'Build order' -- NOT the order the epic files sort in and not the epic file numbers. File numbers record when an epic was written, not its priority, and 09-launch is deliberately split across two positions in the build order.

## Sources and pull requests

| Repository | Path | Source host | Base branch | PR creation command |
|---|---|---|---|---|
| `picksleagues` | `.` | github | `staging` | `gh pr create --base staging --head <feature-branch>` |

Open one PR per affected repository.

The tracker and source host may differ. Never infer tracker operations from the
source host.

## Atlas closeout record

Record every repository delivery, deliverable and worker/model, each DoD
outcome and evidence, deviations, verified run command, deployed smoke when
applicable, every PR URL, and the AI Code Review output.
<!-- atlas-v3:tracker:end -->
