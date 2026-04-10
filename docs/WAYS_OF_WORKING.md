# PicksLeagues — Ways of Working

> This document describes how work is organized, planned, implemented, reviewed, and shipped in the PicksLeagues project.

---

## 1. Document Hierarchy

Four specification documents govern this project. When there is a conflict, earlier documents in this list take precedence:

| Priority | Document | Describes |
|---|---|---|
| 1 | `docs/BUSINESS_SPEC.md` | What the product does and how it behaves |
| 2 | `docs/ARCHITECTURE.md` | How the codebase is structured and organized |
| 3 | `docs/TECH_STACK.md` | Which technologies and libraries are used |
| 4 | `docs/BACKGROUND_JOBS.md` | Background job structure, schedules, and implementation details |

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

### Step 7: Ship
- Address any feedback
- Commit directly to `main` and push
- No pull requests — commit and push when changes are approved

---

## 4. Progress Tracking

The backlog lives at `work/Backlog.md`. This is the single source of truth for what needs to be done, what is in progress, and what is complete.

### Status Markers

| Marker | Meaning |
|---|---|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Complete |
| `[!]` | Blocked |

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

### Human Approval
- [ ] Changes have been reviewed and approved by the product owner
- [ ] Committed to `main` and pushed
