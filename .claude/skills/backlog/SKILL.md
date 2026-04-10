---
description: View, add to, or manage the project backlog in work/Backlog.md.
user_invocable: true
---

# /backlog — Backlog Management

Manages the project backlog stored in `work/Backlog.md`.

## Arguments

`$ARGUMENTS` determines the action:

### No arguments or "view"

Display the current backlog with a status summary:
- Count of completed `[x]`, in-progress `[~]`, blocked `[!]`, and pending `[ ]` stories
- Show all stories grouped by epic/section

### "add {description}"

Add a new story to the appropriate section of the backlog:
- Assign the next available PL-XXX ID
- Place it in the correct epic section based on content
- Mark as `[ ]` (pending)
- If the description suggests it belongs in a new epic, ask the user where to place it

### "next"

Show the next unstarted story that is ready to work on:
- Find the first `[ ]` story whose dependencies are met (all stories above it in the same section are `[x]`)
- Display the story with any relevant BUSINESS_SPEC.md context
- Suggest running `/implement` to start working on it

### "status"

Show a compact summary:
```
Backlog Status:
  Completed: X
  In Progress: X
  Blocked: X
  Pending: X
  Total: X
```

### "prioritize"

Review the backlog ordering with the user:
- Show current order
- Ask if any stories should be reordered
- Update the backlog based on feedback
