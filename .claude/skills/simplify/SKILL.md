---
description: Reuse/dedup/accretion pass over a diff — the craft review the correctness evaluator skips by design
argument-hint: [<commit-range>] (defaults to the current branch vs staging)
---

Run a simplification pass over: **$ARGUMENTS** (default range: `staging..HEAD`).

The correctness evaluator hunts behavior and skips style by design — this pass is where
craft debt gets caught, typically at epic close-out (see /task step 4). Dispatch a
read-only reviewer (`evaluator` agent) over the full diff with this brief:

1. **Duplication:** logic/queries/fixtures/markup restated 3+ times across the diff (or
   2 in the diff + 1 pre-existing) that deserve the shared home the rule-of-three
   demands. Name the extraction target.
2. **Accretion:** files that grew past ~400 effective lines (`pnpm lint` max-lines
   warnings are the input list — run it) or that absorbed responsibilities belonging to
   an existing module; propose the split/re-home along responsibilities.
3. **Dead weight:** unused exports, stale comments describing removed behavior,
   abstractions with one caller that earn nothing, options/params nothing passes.
4. **Idiom drift:** places the diff solves an already-solved problem a second way
   (error mapping, pending state, query keys, test setup) instead of using the repo's
   established mechanism.

Findings come back ranked with file:line and a concrete proposed change each. Then:
confirmed findings → implementer (mechanical, behavior-preserving; gates per wave);
rejected findings → recorded rationale in the report. Never trade behavior for brevity —
if a simplification changes semantics, it's out of scope here and goes to the backlog.
