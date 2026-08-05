# Aggregate gate evidence — simp-pr3

Integrated candidate **`2988dde`** on `feat/simp-pr3-presets-and-closeout`, base `staging`
at `9f80131`. 12 commits, 53 files, +2146/−2426.

Every command below was run by the frontier orchestrator on the integrated candidate. None
is transcribed from a worker report. Raw output: `raw/gates.txt` and `raw/e2e.txt`.

| Gate | Command | Exit | Result |
|---|---|---|---|
| format | `pnpm format:check` | 0 | clean |
| lint | `pnpm lint` | 0 | `eslint .` clean, including the Clock-discipline rule |
| typecheck | `pnpm typecheck` | 0 | 7 workspace projects + `e2e/tsconfig.json` |
| unit | `pnpm test` | 0 | **27 files, 526 tests** |
| contract | `pnpm contract:check` | 0 | regeneration a no-op; `openapi/` committed and not stale |
| web build | `pnpm --filter @picksleagues/web build` | 0 | built in 444ms |
| integration | `pnpm db:up && pnpm test:integration` | 0 | **27 files, 490 tests** against real local Postgres |
| **e2e (merge gate)** | `pnpm test:e2e` | 0 | **14 passed, 0 skipped**, 13.8s |

## The e2e gate is not a human gate, re-confirmed against the code

PR 2 corrected the stale claim that `pnpm test:e2e` deletes every dev league. Rather than
inherit that correction on trust, the isolation was re-read here before the run:
`e2e/setup/e2e-env.ts:23` sets `E2E_DATABASE_NAME = "picksleagues_e2e"` and swaps it into
`DATABASE_URL` at `:59`; `E2E_WEB_PORT = 5273` / `E2E_API_PORT = 3100` at `:19-20`. The
stack is genuinely separate from dev, which is what lets the journey reset the simulator
with `scope: "environment"`. Run unattended, no human gate.

## What the e2e run proves for this PR specifically

The six-test Pick'em journey creates its leagues through the **new preset path** — the
UI-driven create through the form's Season range select, and the cap-2 league through a
direct API post carrying `seasonRangePreset` and no week refs. Both resolve server-side and
produce a league whose weeks behave exactly as before:

```
✓ commissioner creates a Pick'em league; a second member joins via invite
✓ both members commit week 1 as one irreversible full set
✓ a cap shorter than the slate asks for the cap, then freezes to what was picked
✓ before kickoff, another member's picks are hidden behind a count
✓ past one kickoff: that pick locks, is revealed, and the week refuses a second submission
✓ after every game goes final, settlement produces the expected standings
```

That is the whole-system check only the integrated state can make: SPA → API → Postgres →
settlement → back, with the preset resolution sitting underneath it.
