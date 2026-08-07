# ELM-1 — the settings form ships one fewer setting

The epic header's outcome ("ELM-1 ships one fewer setting than it was written
for") and ADR-0024's consequence ("removing the control is not the same as
hiding the answer") are both visual claims, so they were verified by driving the
real stack at phone width — 390×844, mobile-first per the engineering rules.

Captured by a **temporary** Playwright spec, deleted before the PR was opened.
It was not kept: form shape is a branch, and repo policy keeps branches out of
the browser ("E2E covers journeys, not branches"). The assertions are reproduced
below so the check is repeatable without the spec.

## Run output

```
Running 1 test using 1 worker

CREATE FORM: 2 controls + read-only range, 0 week comboboxes
CREATED survivor league 3f82050e-73e8-4628-9bd9-23510629d7ed
SETTINGS EDITOR: resolved range shown read-only, 0 week comboboxes
  ✓  1 [chromium] › ELM-1 evidence: Survivor settings surfaces at phone width (1.2s)

  1 passed (5.8s)
```

## What was asserted

On `/leagues/new` with the Survivor mode selected, and again on an actual
created league's `/settings`:

- the `Survivor settings` heading renders;
- `getByRole("combobox", { name: /start week/i })` and the `end week` equivalent
  both have **count 0** — the two week dropdowns are gone;
- a `Season range` heading renders with the range stated read-only;
- the `Pick type` and `Push / tie result` groups render — the two settings a
  commissioner still chooses.

The create form (no stored refs yet) states what creation will resolve:
`Regular season, through week 18 — starting at the first week that hasn't kicked
off yet.` The settings editor of a real league states the refs the server
actually stored: `Regular season, weeks 1–18.` — resolved to week 1 because the
seeded season is entirely in the future.

This also exercised the whole path end-to-end for the first time: a Survivor
league was created **through the real form**, whose request now carries no range
at all, and the server resolved and stored one.

## Images

Screenshots of both surfaces are attached to the pull request rather than
committed, per the evidence policy in `docs/agents/testing.md`.
