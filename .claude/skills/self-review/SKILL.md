---
description: Review current changes against project standards before presenting to user. Catches common issues early.
user_invocable: true
---

# /self-review — Pre-Review Checklist

Reviews the current uncommitted changes against all project rules and standards.

## Workflow

### 1. Identify Changes

Run `git diff` and `git diff --cached` to see all modified and staged files.

### 2. Spawn Review Agent

Launch a subagent using the prompt in `subagents/self-review.md` to review the changes. The agent will check against:

- Business logic correctness (does it match BUSINESS_SPEC.md?)
- Architecture compliance (layer boundaries, action pattern, sport-specific modules)
- Code style (naming, TypeScript, no `any`, no business logic in components)
- Testing (business logic tested, mocks at import boundaries, edge cases covered)

### 3. Run Automated Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

### 4. Report Findings

Present a summary:

**Review Results:**

- Issues found and fixed (list what was corrected)
- Issues found and unresolved (if any need user input)
- Automated check results (lint, typecheck, test — pass/fail)
- **Ready for review**: Yes / No (with reason if no)

If issues were found and fixed, re-run the automated checks to confirm everything passes.
