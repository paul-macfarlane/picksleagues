# 0034. March Madness: standard doubling only; seed corrections are handled by hand

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** `docs/mvp-spec.md` §Game Mode 3 (League Settings, Scoring,
  Edge Cases); backlog SWP-6 (`backlog/15-scope-sweep.md`), epic 07
  (`backlog/07-march-madness.md`); [0013](0013-admin-role-in-database.md)
  (the admin capability the by-hand procedure leans on)

## Context

March Madness is the last MVP mode and is unbuilt — epic 07 hasn't started
and league creation is gated (LNCH-12) — which makes now the cheapest moment
to trim it. The 2026-08-09 scope sweep (SWP-6) flagged two slices of slated
work:

- **The Custom scoring model**: a commissioner-configured per-round value
  table beside Standard Doubling. It already existed as a settings surface
  (MM-1 landed with the league scaffolding): a discriminated-union schema, a
  scoring-model radio plus six round-value inputs on two forms, and a
  planned second branch through `scoreBracket` with its own test matrix. A
  friends' pool doesn't tune per-round values.
- **The pre-deadline seed-correction wipe-and-resubmit flow** (MM-6): if a
  wrong seed/region ships and is corrected before the deadline, the spec had
  all brackets wiped and members prompted to resubmit — a build-out for a
  once-a-tournament case.

## Decision

**Scoring is Standard Doubling for every pool.** The Custom model is cut
before the mode is built: `MarchMadnessSettingsSchema` collapses to
`{ maxBracketsPerMember }`, the scoring-model radio and round-value inputs
leave both settings forms, and the future `scoreBracket` (MM-4) carries the
doubling table as constants with a single scoring path. A stored settings
row from the old shape parses — the retired `scoringModel`/`roundValues`
keys are stripped, the same way every other retired setting ages out.

**Pre-deadline seed corrections are an admin-by-hand procedure.** The admin
corrects the data (ADR-0013's role, the existing override surfaces) and
tells affected members to resubmit; no automated wipe, no prompt flow, no
code. The spec's edge case is amended to say so. Post-deadline freezing is
unchanged.

**Vacated-slot auto-advance stays.** It is grading correctness — a bracket
must still score when the field changes under it — not a feature to trim.
MM-4/MM-6/MM-7/MM-8 keep it.

## Consequences

- Epic 07 shrinks before it starts: MM-4 loses the custom-values half of its
  test matrix, MM-6 loses a whole flow, and the settings surface is already
  down to one number field. The mode's only setting is Max Brackets Per
  Member.
- **Lost: per-round value tuning.** Restorable by reopening this ADR and
  re-adding the union + the second scoring branch — mechanical, and
  justified only by a real pool asking.
- **Lost: the automated wipe path.** A pre-deadline seed correction now
  depends on an admin noticing and acting. At one tournament a year for a
  friends-scale audience, that is the honest cost of not building a flow for
  it; if it ever actually happens twice, that is the signal to revisit.
