# PicksLeagues — Ways of Working V2 (Epic Mode)

> An experimental, lower-touch workflow for shipping larger chunks of work with the human out of the per-story review loop. Use this when you want to delegate an entire backlog section and come back to a PR for manual testing.
>
> If you want story-at-a-time control with a human gate between each story, use [WAYS_OF_WORKING.md](./WAYS_OF_WORKING.md) (V1) instead. V1 and V2 coexist — pick per epic.

---

## 1. Philosophy

V1 treats every story as a human-reviewed unit. V2 treats the **epic** as the reviewed unit:

- Clarifying questions happen **once**, at the start of the epic.
- A single **epic plan** is approved before any code is written.
- Stories inside the epic are implemented autonomously — no human gate between them.
- An AI **code reviewer** agent and an AI **spec tracer** agent replace the per-story human review.
- Manual testing and human approval happen at the **end of the epic**, via a pull request on a dedicated branch.

The tradeoff: less interruption, larger blast radius per mistake. The mitigations below (epic branch, halt conditions, strict AI review) exist because a runaway loop on main would be expensive to undo.

---

## 2. Document Hierarchy

Same as V1. When documents conflict: `BUSINESS_SPEC.md` > `ARCHITECTURE.md` > `TECH_STACK.md` > `BACKGROUND_JOBS.md`.

---

## 3. What Counts as an Epic

An **epic is a section of `work/Backlog.md`** (e.g., "2. ESPN Integration", "4. Leagues", "5. Picks & Scoring"). Sections are already dependency-ordered and sized, so no new grouping is needed.

An epic is eligible for V2 if:

- All stories inside it are `[ ]` (pending) or already `[x]` (complete). No half-finished `[~]` or `[!]` stories from a prior session.
- Its upstream dependencies are complete (all stories in earlier sections are `[x]`).
- It has no `[!]` blockers.

If an epic has a partially complete story in progress, finish or discard it using V1 before running V2.

---

## 4. Workflow

The preferred way to run this is the `/implement-epic` skill. The phases below describe what the skill does; follow them manually if running without the skill.

### Phase 1 — Epic Kickoff (human-assisted)

1. **Select the epic.** By section name or section number from `work/Backlog.md`.
2. **Read all stories** in the epic and the BUSINESS_SPEC sections they cite.
3. **Pull latest main.** `git checkout main && git pull origin main` — the epic branch must be cut from current main, not a stale checkout.
4. **Ask clarifying questions — once.** Consolidate everything ambiguous across the whole epic into a single round. Questions may cover: business rule edge cases, UX preferences, acceptance of cross-cutting approach choices. After this round, don't ask again mid-epic unless a **halt condition** (§7) is hit.
5. **Write the epic plan.** A single document that covers all stories:
   - Stories to be implemented, in order.
   - Cross-cutting technical decisions (shared schema changes, new lib modules, shared validators).
   - Known risks and how they'll be handled.
   - Any stories that need to be split, merged, or dropped — and why.
6. **Human approves the plan.** This is the one mid-epic gate. Once approved, the autonomous loop begins.

### Phase 2 — Branch Setup

1. Create the epic branch: `git checkout -b epic/<slug>` (slug from the section name, e.g., `epic/leagues`, `epic/picks-and-scoring`).
2. Mark all stories in the epic `[~]` in `work/Backlog.md`. Commit and push this status change (first commit on the branch).

### Phase 3 — Autonomous Story Loop

For each story in dependency order:

1. **Implement** — follow architecture layer order (schema → `data/` → `lib/` → `actions/` → `components/` → `app/` → tests). Adhere to all `rules/*.md` files.
2. **AI code review** — invoke the `code-reviewer` agent (see §6). It reviews only the uncommitted diff for this story and returns findings. Fix every blocker. Acknowledge every non-blocker in the task notes if not fixed.
3. **AI spec trace** — invoke the `spec-tracer` agent on any story that cites BUSINESS_SPEC sections. It verifies the implementation matches the cited sections. Fix any divergence or surface it as a halt.
4. **Automated checks** — run `pnpm check`. Must pass. If it fails, attempt self-repair once; if it still fails, **halt** (§7).
5. **Write task notes** — create `work/tasks/<ID>.md` using the template in [WAYS_OF_WORKING.md §4](./WAYS_OF_WORKING.md#4-progress-tracking).
6. **Commit** — one commit per story on the epic branch. Commit message style matches V1. Include `work/tasks/<ID>.md` in the same commit.
7. **Mark story `[x]`** in `work/Backlog.md`. Commit the status change either with the story or batched at epic end (skill decides).
8. **Do not push per story.** All commits stay local on the epic branch until Phase 5.

### Phase 4 — Epic Validation

After the last story in the epic is committed:

1. Run `pnpm check` one more time against the full diff from `main`.
2. Run the `code-reviewer` agent against **the full epic diff** (not just the last story). This catches cross-story issues that per-story review misses — e.g., a helper extracted in story 3 that was duplicated in story 1.
3. Fix any findings, commit as a final cleanup commit if needed.

### Phase 5 — Pull Request

1. `git push -u origin epic/<slug>`
2. Open a PR against `main` with `gh pr create`. PR body must include:
   - **Summary** — one paragraph on what the epic delivers.
   - **Stories shipped** — bulleted list with IDs, titles, commit SHAs.
   - **BUSINESS_SPEC coverage** — sections this epic implements.
   - **Manual test plan** — specific flows to exercise in dev, including regression-prone adjacent flows. Written so the human can pick it up cold.
   - **Known limitations / follow-ups** — anything deferred, any spec ambiguity resolved, any technical debt knowingly taken on.
3. Report the PR URL and stop.

### Phase 6 — Human Review & Merge

1. The human pulls the branch, runs through the manual test plan, and exercises the feature in the local dev server.
2. If changes are needed: comment on the PR or request changes in chat. The autonomous loop can be re-invoked on the branch to address feedback.
3. Once approved, the human merges the PR **without squashing** — preserves the per-story commit history.
4. Delete the branch after merge.

---

## 5. Commit & Branch Rules

- **One branch per epic.** Named `epic/<slug>`.
- **One commit per story.** Commit messages use the same style as V1 (`feat(PL-XXX): …`, `fix(PL-XXX): …`, etc.).
- **Include task notes in the story commit.** Not a separate commit.
- **Never push to main from V2.** V2 only pushes to its own epic branch.
- **Never rebase or force-push** the epic branch once the PR is open.
- **Never merge the PR on behalf of the human.** That's the manual-testing gate.
- **Never squash-merge.** It collapses the per-story history that V1's conventions rely on.

---

## 6. AI Review Replaces Human Review

Two agents (defined in `.claude/agents/`) run in place of the per-story human review:

### `code-reviewer`

Strict reviewer. Checks architecture rule violations, layer boundaries, TypeScript quality, test coverage, and code style. Returns findings as **blockers** (must fix) or **non-blockers** (surface in task notes). Invoked twice per epic: after each story on that story's diff, and once on the full epic diff before opening the PR.

### `spec-tracer`

Verifies the implementation matches the BUSINESS_SPEC sections the story cites. Catches silent spec drift — the biggest risk when a human isn't in the loop. Invoked on any story that cites BUSINESS_SPEC sections.

If either agent flags a **blocker** that can't be resolved automatically, treat it as a halt condition.

---

## 7. Halt Conditions

The autonomous loop **must stop and hand back to the human** when any of these fire. Do not power through.

- **Clarification gap** — a business-rule ambiguity is discovered mid-epic that wasn't covered in the Phase 1 clarification round.
- **`pnpm check` fails twice** — one self-repair attempt per failure. If it still fails, halt.
- **Reviewer blocker** — `code-reviewer` flags an architecture rule violation that the implementer can't see a clean fix for.
- **Spec drift** — `spec-tracer` reports the implementation diverges from the cited BUSINESS_SPEC section in a way that isn't a clear bug to fix.
- **Out-of-scope schema change** — a story would require schema changes to a table outside the epic's declared scope. Adding a column to a table the epic owns is fine; modifying an unrelated table is a halt.
- **Coverage regression** — tests that existed before the epic now fail or were deleted without being replaced.
- **Dependency surprise** — adding a new package not already in `docs/TECH_STACK.md`.
- **Silent spec update** — the implementation would require an update to `BUSINESS_SPEC.md` to be correct. Never update business rules silently; halt and ask.

On halt: post the reason to the user, leave the epic branch in place with all prior commits intact, and wait for direction.

---

## 8. Progress Tracking

Same backlog format as V1 (`[ ]`, `[~]`, `[x]`, `[!]`). Differences:

- The whole epic is in-progress while the loop is running (all stories `[~]`).
- Stories flip to `[x]` as each autonomous iteration completes.
- Task notes at `work/tasks/<ID>.md` are mandatory, same template as V1.

---

## 9. Spec Maintenance

Same rule as V1: **never update specs to match wrong code.** If the implementation reveals a spec bug, halt and ask. Spec updates during V2 require explicit human approval — do not batch them into the epic PR without a flag.

---

## 10. When NOT to Use V2

V2 is wrong for:

- **Cross-cutting changes** that touch many epics at once (e.g., auth refactor, schema-wide rename). Use V1 story-by-story.
- **Spec exploration** — if the epic's BUSINESS_SPEC sections are still being written, don't run V2 on them.
- **Work that needs intermediate UX feedback** — e.g., an early polish epic where the point is iterative design. V2's gate is only at the end.
- **Time-sensitive bug fixes.** V2 has more ceremony than a one-off fix needs.

Default to V1 when unsure.
