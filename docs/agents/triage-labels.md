# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to
the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding label string from this table.

**How a label is applied here.** This repo's tracker is `backlog/` — markdown checkboxes
with no label field (see `issue-tracker.md`). Write the label as a trailing tag on the
task line, e.g. `_(deps: none)_ _(needs-info)_`. It does **not** replace the task's
`[ ]`/`[~]`/`[x]`/`[!]` state marker, which is a separate axis and whose vocabulary is
closed.

Edit the right-hand column to match whatever vocabulary you actually use.
