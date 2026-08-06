# Evidence — simp-pr3 D2 (SIMP-20): one season-range preset select

Commit `9993bd8` on `feat/simp-pr3-presets-and-closeout`.

_This file is written by the frontier orchestrator, not the implementation worker: the
worker's harness refused its file write ("subagents should return findings as text"),
and it complied rather than routing around the refusal via Bash — which is the right
call. The screenshots below were captured by the worker and **inspected by the
orchestrator** before this file was written; the command-level gates are recorded in
`../simp-pr3-aggregate/report.md`, run by the orchestrator on the integrated candidate,
rather than transcribed from a worker report here._

## Visual proof — phone width (390×844)

`pickem-season-range-fieldset/`

| Artifact | What it proves |
|---|---|
| `01-create-form-390px.png` | The Pick'em fieldset carries **one** full-width "Season range" select reading `Regular Season`. The two `(week type, week number)` dropdown pairs are gone. The control spans the card's column like Max members and Picks per week, rather than the `grid-cols-2` pair that previously put two truncating dropdowns side by side at this width. |
| `02-season-range-open-390px.png` | All three presets — Regular Season, Postseason, Full Season — resolve as `option` roles. |
| `03-keyboard-selected-postseason-390px.png` | The trigger takes keyboard focus and commits a selection via Tab → Enter → ArrowDown → Enter, satisfying the keyboard-operable rule. |

Captured against the **isolated e2e stack** (`picksleagues_e2e`, ports 5273/3100) by a
throwaway Playwright spec that was deleted after the run; the dev database was never
touched and the minted user was removed. The spec addressed elements by accessible role
and name only — never by copy, column index, or CSS class — per the UI-tests rule.

## Behavior pinned by test, not by screenshot

`packages/schemas/src/league-settings.test.ts` gained 11 cases. The ones that matter:

- Each preset's nominal range parses against `PickemSettingsSchema`'s ordering refine —
  so a preset can never resolve to a range the stored schema rejects.
- A `changing the season-range preset` table asserting the **domain** answer of
  `pickemSettingsInvalidatePicks`: regular→postseason, full→regular, full→postseason and
  postseason→regular strand picks; regular→full and postseason→full strand nothing; and
  a mid-week-resolved league keeping its preset raises no spurious warning.

No assertions on labels, copy, or layout — the visual layer stays the owner's to change
(engineering rules §Quality, "don't unit-test presentation policy").

## Not proved here

The Pick'em fieldset **inside the settings editor** at phone width was not captured
separately. It renders the same `PickemSettingsFields` component the create form does,
so the layout is identical by construction; reaching it needs a seeded league and season.
Recorded as a known gap rather than claimed as covered.
