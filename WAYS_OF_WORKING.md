# PicksLeagues — Ways of Working

> How AI agents (primarily Claude Code) should approach tasks in this codebase: breaking down work, tracking progress, implementing changes, reviewing code, and keeping specs in sync.
>
> This document does not define **what** to build or **how** to build it — those are covered by the spec documents below. This document defines the **process** for working effectively.

---

## Table of Contents

1. [Document Hierarchy](#1-document-hierarchy)
2. [Task Breakdown](#2-task-breakdown)
3. [Implementation Workflow](#3-implementation-workflow)
4. [Progress Tracking](#4-progress-tracking)
5. [Spec Maintenance](#5-spec-maintenance)
6. [Code Review](#6-code-review)
7. [Assessing Completeness](#7-assessing-completeness)

---

## 1. Document Hierarchy

Four spec documents govern this project. Each has a distinct scope, and they should be consulted in this order of precedence when resolving conflicts:

| Priority | Document                                   | Governs                                                                                            | When to Consult                                                                                       |
| -------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1        | [BUSINESS_SPEC.md](./BUSINESS_SPEC.md)     | **What** the product does — all business rules, user flows, permissions, and constraints           | Before implementing any feature or behavior. This is the single source of truth for product behavior. |
| 2        | [ARCHITECTURE.md](./ARCHITECTURE.md)       | **How** to structure code — patterns, conventions, layer boundaries, testing approach              | When writing or reviewing code. Defines where code goes and how it should be organized.               |
| 3        | [TECH_STACK.md](./TECH_STACK.md)           | **What technologies** to use — framework versions, libraries, project structure, deployment        | When choosing tools, setting up new features, or verifying technology decisions.                      |
| 4        | [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) | **How background work runs** — Inngest jobs, ESPN sync pipeline, scheduling, game window detection | When working on data sync, live scores, odds, or standings recalculation.                             |

**Precedence rule**: If BUSINESS_SPEC.md says "picks lock at game kickoff" and ARCHITECTURE.md shows a pattern that doesn't account for individual game locking, the business spec wins — update the code to match the business rule.

---

## 2. Task Breakdown

All work should be decomposed into small, testable, validatable chunks. The business spec drives what gets built; the architecture and tech stack docs drive how.

### 2.1 Start from the Business Spec

Before writing any code, identify which section(s) of BUSINESS_SPEC.md the task relates to. Every implementation task should trace back to a specific business rule or user flow. If a task doesn't map to the business spec, either:

- The task is infrastructure/tooling (proceed, but keep it focused)
- The business spec is missing something (update it — see [Section 5](#5-spec-maintenance))

### 2.2 Decompose into Vertical Slices

Break work into slices that each deliver a complete, testable behavior — not horizontal layers. A good slice touches the data layer, business logic, action, and UI for one specific behavior.

**Good decomposition** (pick submission feature):

1. Create the pick validation schema and business logic (`lib/validators/picks.ts`, `lib/scheduling.ts`)
2. Create the data layer functions for picks (`data/picks.ts`)
3. Create the Server Action for submitting picks (`actions/picks.ts`)
4. Create the pick selection UI component (`components/picks/interactive-pick.tsx`)
5. Wire up the page to compose data fetching + UI (`app/(app)/leagues/[leagueId]/my-picks/page.tsx`)
6. Add tests for business logic and action (`lib/scheduling.test.ts`, `actions/picks.test.ts`)

**Bad decomposition**:

1. Create all data layer functions
2. Create all Server Actions
3. Create all components

### 2.3 Chunk Sizing

Each chunk should be:

- **Testable**: You can write a test or manually verify the behavior
- **Reviewable**: The changes are small enough to reason about in isolation
- **Completable in one pass**: You shouldn't need to leave a chunk half-done
- **Tied to one business rule**: Avoid mixing unrelated behaviors in a single chunk

### 2.4 Identify Dependencies

Before starting implementation, note which chunks depend on others. Work in dependency order:

- Schema/migrations before data layer
- Data layer before actions
- Business logic before actions that use it
- Actions before UI that calls them

---

## 3. Implementation Workflow

Follow these steps for each chunk of work. Don't skip steps — the order exists to catch problems early.

### Step 1: Understand the Requirement

- Read the relevant BUSINESS_SPEC.md section(s)
- Read any related existing code to understand current patterns
- Identify edge cases explicitly called out in the spec (e.g., "sole commissioner cannot self-demote")

### Step 2: Plan the Changes

- Identify which files need to be created or modified
- Verify the planned approach matches ARCHITECTURE.md patterns (e.g., business logic in `lib/`, data access in `data/`, mutations in `actions/`)
- If the approach requires deviating from established patterns, flag it before proceeding

### Step 3: Implement

- Follow the patterns in ARCHITECTURE.md exactly — consistency matters more than cleverness
- Follow TECH_STACK.md for technology choices — don't introduce new libraries without justification
- Write code in layer order: schema → data layer → business logic → action → UI
- Reference BUSINESS_SPEC.md constants directly (e.g., league size 2–20, picks per week 1–16) rather than hardcoding magic numbers

### Step 4: Test

- Write tests for business logic functions (`lib/*.test.ts`) — these are pure functions and the highest-value tests
- Write tests for Server Actions (`actions/*.test.ts`) — mock the data layer and auth, verify orchestration
- Follow the testing patterns in ARCHITECTURE.md Section 10: use Vitest, mock at import boundaries, inject time for time-dependent logic
- Run existing tests to verify nothing is broken: `npx vitest run`

### Step 5: Verify

- Check that the implementation matches the business spec — not just "it works" but "it works as specified"
- Verify edge cases from the spec are handled
- Run the linter: `npx next lint`
- Run the formatter: `npx prettier --check .`

### Step 6: Human Review

After automated checks pass, **pause and present the work to the human for review before committing**. Include:

- A summary of what was implemented and which spec sections it covers
- List of files created or modified
- Any decisions or trade-offs made during implementation
- Anything you're unsure about or want a second opinion on

Do not commit, move on to the next task, or mark the task complete until the human approves. If the human requests changes, make them and re-run Steps 4–5 before presenting again.

> **Note**: This gate exists for the early stages of the project to build confidence in patterns and conventions. It may be relaxed later for well-established patterns.

---

## 4. Progress Tracking

Progress is tracked in [BACKLOG.md](./BACKLOG.md) — a persistent markdown file at the project root. This file survives across Claude Code sessions and is readable by both humans and AI agents. It is the source of truth for what's been done, what's in progress, and what's next.

Within a single session, Claude Code's built-in task management (TaskCreate/TaskUpdate/TaskList) can also be used for fine-grained tracking of active work. But BACKLOG.md is the durable record.

### 4.1 BACKLOG.md Format

Tasks are grouped by feature area, with each group referencing the relevant BUSINESS_SPEC.md section. Items use markdown checkboxes with status indicators:

```markdown
## League Creation & Settings (BUSINESS_SPEC §3)

- [x] League creation with all configurable settings
- [x] Season format presets (Regular, Postseason, Full)
- [~] League settings edit (in progress — working on in-season lock)
- [ ] League deletion
- [!] League image upload — blocked: need S3 bucket setup

### Notes

- In-season detection depends on week sync being complete
```

Status markers:

- `[ ]` — Not started
- `[~]` — In progress
- `[x]` — Complete
- `[!]` — Blocked (reason noted inline)

### 4.2 When to Update BACKLOG.md

- **Starting a new feature area**: Add a new section with all planned tasks, ordered by dependency
- **Starting a task**: Change `[ ]` to `[~]`
- **Completing a task**: Change `[~]` to `[x]`
- **Hitting a blocker**: Change to `[!]` with an inline explanation
- **Discovering new work**: Add new items to the appropriate section
- **End of session**: Ensure BACKLOG.md reflects the current state — this is what the next session will read

Update the status summary table at the top of BACKLOG.md when making changes.

### 4.3 Session Start Routine

At the start of a new session, read BACKLOG.md to understand:

- What's already been completed (don't redo work)
- What's currently in progress (pick up where the last session left off)
- What's blocked (check if the blocker has been resolved)
- What's next (identify the highest-priority unstarted task)

### 4.4 When Blocked

If a task is blocked (e.g., missing spec clarity, upstream dependency, external issue):

- Mark it as `[!]` in BACKLOG.md with the reason
- Move to the next unblocked task
- If the blocker is something the user needs to resolve, flag it explicitly

---

## 5. Spec Maintenance

The spec documents are living documents. When business logic changes, the specs must be updated to stay accurate.

### 5.1 When to Update BUSINESS_SPEC.md

Update BUSINESS_SPEC.md when:

- The user requests a change to business behavior (e.g., "change the default picks per week from 5 to 3")
- A new feature is being added that introduces new business rules
- An existing rule is being modified or removed
- An edge case is discovered that the spec doesn't address

**Do not** update BUSINESS_SPEC.md for:

- Implementation details (that belongs in ARCHITECTURE.md)
- Technology changes (that belongs in TECH_STACK.md)
- Bug fixes that don't change intended behavior

### 5.2 When to Update ARCHITECTURE.md or TECH_STACK.md

Update these when:

- A new architectural pattern is established (e.g., a new convention for how something is organized)
- A technology is added, replaced, or upgraded
- An existing pattern is modified based on experience

### 5.3 How to Update

- Make the spec change in the same work session as the code change
- Keep updates minimal and focused — change only what's affected
- Maintain the existing document structure and formatting style
- If adding a new section, place it logically within the existing table of contents

### 5.4 Spec-Code Consistency

Code must match the spec. If you find code that contradicts BUSINESS_SPEC.md:

- The spec is assumed correct unless the user says otherwise
- Fix the code to match the spec
- If the spec is actually wrong (the user confirms the code is the intended behavior), update the spec

---

## 6. Code Review

When reviewing code (your own or existing code), check against these standards. Items are ordered by importance — architectural violations and business logic errors are more critical than style issues.

### 6.1 Business Logic Correctness

- [ ] Does the code implement the business rules from BUSINESS_SPEC.md accurately?
- [ ] Are edge cases from the spec handled (e.g., sole commissioner, league at capacity, game already started)?
- [ ] Are business constants correct (league size 2–20, picks per week 1–16, scoring: win=1, push=0.5, loss=0)?
- [ ] Is pick locking handled at both levels — week lock time AND individual game kickoff?

### 6.2 Architecture Compliance

- [ ] Business logic lives in `lib/`, not in components, pages, or actions?
- [ ] Data access (Drizzle calls) lives only in `data/`?
- [ ] Server Actions follow the pattern: validate → authenticate → authorize → check business rules → execute → revalidate → return?
- [ ] Auth/permission errors are thrown (for error boundaries), business errors are returned as `ActionResult`?
- [ ] Components don't contain business logic — they render data and handle UI interactions?
- [ ] Validation schemas are shared between client forms and Server Actions (defined once in `lib/validators/`)?

### 6.3 Tech Stack Compliance

- [ ] Server Components are the default — `"use client"` only when interactivity is needed?
- [ ] All dynamic APIs are awaited (`params`, `searchParams`, `headers()`, `cookies()`)?
- [ ] No client-side data fetching (`useEffect` + `fetch`) for data that can be server-fetched?
- [ ] Parallel data fetching with `Promise.all` where applicable?
- [ ] Transactions used for multi-step writes (via `withTransaction` from `data/utils.ts`)?
- [ ] No `any` types — use `unknown` with type guards?
- [ ] Types inferred from Drizzle schemas and Zod schemas, not manually declared?

### 6.4 Testing

- [ ] Business logic functions in `lib/` have tests?
- [ ] Server Actions with non-trivial logic have tests?
- [ ] Tests mock at import boundaries (`vi.mock("@/data/...")`) — no database required?
- [ ] Time-dependent logic accepts an optional `now` parameter?
- [ ] Edge cases from the business spec have corresponding test cases?

### 6.5 Code Quality

- [ ] No N+1 queries — use `with` clause or `inArray()` for batch lookups?
- [ ] No duplicate business logic — same rule defined in one place, imported everywhere?
- [ ] Error handling follows the two-mechanism pattern (throw for auth, return for business errors)?
- [ ] File and function naming follows conventions (kebab-case files, `get*`/`insert*`/`update*` data functions, `assert*` permission checks)?
- [ ] No unnecessary `"use client"` directives?

---

## 7. Assessing Completeness

A task is done when all of the following are true. Don't move on until each is satisfied.

### 7.1 Functional Completeness

- [ ] The implemented behavior matches the relevant BUSINESS_SPEC.md section(s) — not approximately, exactly
- [ ] All edge cases mentioned in the spec are handled
- [ ] The feature works for all user roles affected (member, commissioner)
- [ ] Permissions are enforced as defined in BUSINESS_SPEC.md Section 13

### 7.2 Code Quality

- [ ] Code follows ARCHITECTURE.md patterns — correct layer boundaries, naming conventions, error handling
- [ ] Code uses the tech stack as defined in TECH_STACK.md — no unauthorized libraries or patterns
- [ ] Linter passes: `npx next lint`
- [ ] Formatter passes: `npx prettier --check .`
- [ ] TypeScript compiles with no errors: `npx tsc --noEmit`

### 7.3 Test Coverage

- [ ] Business logic functions have tests covering the happy path and spec-defined edge cases
- [ ] Server Actions with business rule checks have tests
- [ ] All tests pass: `npx vitest run`

### 7.4 Spec Sync

- [ ] If the task changed business behavior, BUSINESS_SPEC.md is updated
- [ ] If the task introduced new patterns, ARCHITECTURE.md is updated
- [ ] If the task changed technology choices, TECH_STACK.md is updated
- [ ] No code contradicts the spec documents

### 7.5 No Loose Ends

- [ ] No TODO comments left in the code (either resolve them or create a tracked task)
- [ ] No commented-out code
- [ ] No temporary workarounds without a tracked follow-up task

### 7.6 Human Approval

- [ ] Work has been presented to the human for review (Step 6 of the implementation workflow)
- [ ] Human has approved the changes
- [ ] Changes have been committed only after approval
