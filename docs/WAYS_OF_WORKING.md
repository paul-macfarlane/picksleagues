# PicksLeagues — Ways of Working

> This document describes how work is organized, planned, implemented, reviewed, and shipped in the PicksLeagues project.

---

## 1. Document Hierarchy

Four specification documents govern this project. When there is a conflict, earlier documents in this list take precedence:

| Priority | Document                  | Describes                                                       |
| -------- | ------------------------- | --------------------------------------------------------------- |
| 1        | `docs/BUSINESS_SPEC.md`   | What the product does and how it behaves                        |
| 2        | `docs/ARCHITECTURE.md`    | How the codebase is structured and organized                    |
| 3        | `docs/TECH_STACK.md`      | Which technologies and libraries are used                       |
| 4        | `docs/BACKGROUND_JOBS.md` | Background job structure, schedules, and implementation details |

Business rules always override architectural preferences. Architecture always overrides technology choices.

---

## 2. Task Breakdown

### Starting Point

Work starts from the **Business Spec**. Each task should deliver a vertical slice of product functionality — not a horizontal layer (e.g., not "add DB tables", but "users can make picks for a phase").

### Vertical Slices

A vertical slice spans from the UI down to the database. A complete slice includes:

- Database schema changes (if needed)
- Data access layer
- Server actions or API route handlers
- UI components and pages
- Tests for critical business logic

### Chunk Sizing

Tasks should be small enough to review in one sitting and large enough to be independently valuable. A good target is something that can be fully implemented, tested, and verified in a single working session. If a task feels too large, split it.

### Dependencies

Identify dependencies before starting. If Task B requires data or components from Task A, Task A must be completed first. Dependencies should be noted in the backlog.

---

## 3. Implementation Workflow

The preferred way to run this workflow is via the `/implement` Claude Code skill, which automates the steps below. For manual implementation, follow these steps in order:

### Step 1: Understand

- Read the relevant sections of the Business Spec
- Identify what data, UI, and behavior the task requires
- Clarify any ambiguities before writing code

### Step 2: Plan

- Describe the approach in plain language before touching code
- Identify which files will be created or modified
- Consider edge cases and error states

### Step 3: Implement

- Write the code following architecture and tech stack conventions
- Keep components focused — server-side logic stays out of React components
- Validate all inputs on the server (Zod schemas in server actions)
- Use `pnpm` for all package operations

### Step 4: Test

- Write Vitest tests for critical business logic
- Focus tests on correctness of rules (scoring, standings, permissions)
- Tests live alongside the code they test

### Step 5: Verify

- Run `pnpm build` — must pass with no errors
- Run `pnpm lint` — must pass with no warnings
- Run `pnpm test` — all tests must pass
- Manually exercise the feature in the local dev server

### Step 5.5: Self-Review

Run the `/self-review` Claude Code skill. This performs an automated review pass against the task requirements, architecture, and tech stack before human review.

### Step 6: Human Review

- Present the changes with a summary of what was done
- Highlight any decisions made, trade-offs, or areas of uncertainty
- Request specific feedback if needed

### Step 7: Document

Write the task notes file at `work/tasks/<ID>.md` (see §4, _Task Notes_). Capture decisions, deviations, and gotchas while they are fresh.

### Step 8: Ship

- Address any feedback
- Commit directly to `main` (include the task notes file in the same commit series) and push
- No pull requests — commit and push when changes are approved

---

## 4. Progress Tracking

The backlog lives at `work/Backlog.md`. This is the single source of truth for what needs to be done, what is in progress, and what is complete.

### Status Markers

| Marker | Meaning     |
| ------ | ----------- |
| `[ ]`  | Not started |
| `[~]`  | In progress |
| `[x]`  | Complete    |
| `[!]`  | Blocked     |

### Backlog Format

```markdown
## Backlog

- [ ] Task title — brief description of what it delivers
- [~] Task in progress — brief description
- [x] Completed task — brief description

## Blocked

- [!] Blocked task — what is blocking it
```

Tasks move through statuses as work progresses. Completed tasks can be archived periodically to keep the backlog readable.

### Task Notes

Every backlog story gets a notes file at `work/tasks/<ID>.md` (e.g., `work/tasks/PL-001.md`). It captures the durable context that commit messages are too terse to hold: the decisions made, the deviations from the story as written, and anything a future reader (human or AI) would want to know before touching the same area.

Write the file **before** committing — it is part of the deliverable, not an afterthought. Keep it terse; link to the commit(s) rather than restating the diff.

Template:

```markdown
---
id: PL-XXX
title: <story title>
status: complete | in-progress | blocked
commits: <sha>[, <sha>...]
---

## Summary

One or two sentences on what this story delivered.

## Business Spec Coverage

Which BUSINESS_SPEC.md sections this addresses (or "N/A — foundation story").

## Decisions

- **<decision>**: why, and what was rejected
- ...

## Deviations from the Story

Anything in the backlog entry that was changed, dropped, or deferred, and why.

## Notable / Gotchas

Surprises, upstream-library quirks, places a future reader should double-check before changing things.

## Follow-ups

Anything left for a later story (link by ID if one exists).
```

Omit sections that don't apply rather than filling them with "none".

---

## 5. Spec Maintenance

Specs are living documents. They should be updated when:

- A business rule is clarified or changed by the product owner
- An architectural decision is made that is not yet reflected in the docs
- A technology choice changes (e.g., a library is replaced)
- Implementation reveals that a spec was incomplete or ambiguous

**Do not update specs to match wrong code.** If the code diverges from the spec incorrectly, fix the code. Only update the spec when the spec itself needs to change.

When updating a spec, note what changed and why if the reason is not obvious from the diff.

---

## 6. Code Review

Before human review, a self-review should be performed (Step 5.5 above, using `/self-review`). The review covers the following checklist:

### Business Logic Correctness

- [ ] The implementation matches the behavior described in the Business Spec
- [ ] Edge cases are handled (empty states, permission boundaries, deadlines)
- [ ] No business rules are silently skipped or approximated

### Architecture Compliance

- [ ] Server-side business logic is not in React components
- [ ] Data access is separated from business logic
- [ ] Server actions validate all inputs with Zod
- [ ] File locations follow the project structure (no `src/` prefix, sport-specific logic in `lib/nfl/`, etc.)

### Tech Stack Compliance

- [ ] Only approved libraries are used (see `docs/TECH_STACK.md`)
- [ ] `pnpm` used for all package operations
- [ ] Date/time operations use `date-fns` and `date-fns-tz`
- [ ] Forms use `react-hook-form` + Zod resolvers
- [ ] Icons use `lucide-react`
- [ ] Toasts use `sonner`

### Testing

- [ ] Vitest tests exist for critical business logic
- [ ] Tests assert correctness of rules, not just that functions run
- [ ] All tests pass

### Code Quality

- [ ] TypeScript strict mode — no `any` without justification
- [ ] No dead code or unused imports
- [ ] No commented-out code blocks
- [ ] Error states are handled, not silently swallowed
- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes

---

## 7. Assessing Completeness

A task is complete when all of the following are true:

### Functional

- [ ] The feature works end-to-end in the local dev server
- [ ] All acceptance criteria from the Business Spec are met
- [ ] No regressions in adjacent functionality

### Code Quality

- [ ] Self-review checklist passed (Section 6)
- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes

### Test Coverage

- [ ] Critical business logic has Vitest test coverage
- [ ] Tests are meaningful — they would catch real bugs

### Spec Sync

- [ ] No spec documents need updating as a result of this work (or they have been updated)
- [ ] The implementation matches the spec — the spec has not been silently ignored

### No Loose Ends

- [ ] No TODO comments left in newly written code
- [ ] No placeholder data or stub implementations
- [ ] No console.log or debug artifacts
- [ ] Task notes file exists at `work/tasks/<ID>.md` with decisions, deviations, and gotchas

### Human Approval

- [ ] Changes have been reviewed and approved by the product owner
- [ ] Committed to `main` and pushed
