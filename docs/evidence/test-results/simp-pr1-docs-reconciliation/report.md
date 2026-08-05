# SIMP PR 1 — captured verification output

Work package `simp-pr1` (SIMP-1, SIMP-2, SIMP-3, SIMP-17, SIMP-21).
Integrated candidate: `f1f05ac5b396d1033a55b295aa18963b4e9bb6e9` on `docs/simp-pr1-decisions-and-docs`.
Captured 2026-08-04. This is a docs-only work package — no code, schema, route, or test file
changed — so the runtime surface is unchanged and the evidence is the repo gates plus the
dead-term sweep that proves the two locked documents carry no rule the ADRs removed.

## Gates

```
$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!

$ pnpm lint
$ eslint .
(eslint exited 0, no findings)

$ pnpm typecheck
packages/scoring typecheck: Done
packages/core typecheck: Done
packages/db typecheck: Done
apps/web typecheck$ tsc -b
apps/api typecheck$ tsc
apps/web typecheck: Done
apps/api typecheck: Done

$ pnpm test
 Test Files  27 passed (27)
      Tests  528 passed (528)
   Start at  00:51:33
   Duration  1.01s (transform 1.52s, setup 0ms, import 4.03s, tests 305ms, environment 2ms)

```

`pnpm test:integration` and `pnpm contract:check` were not run, and the omission is
deliberate rather than a gap: their triggers in `docs/agents/testing.md` are an API, DB,
service or schema change and a Zod/DTO/route change respectively, and this work package
makes neither. `pnpm test:e2e` is human-gated and belongs to PR 2, where the behaviour it
exercises actually changes.

## Dead-term sweep over both locked documents

```
$ grep -n -i -E 're-pick|repick|push/tie|odds_snapshot|differential|week move' \
    docs/mvp-spec.md docs/architecture.md
docs/mvp-spec.md:5:**Amendments:** v0.3 stays locked and is amended by recorded ADRs rather than re-versioned. ADR-0018 (a Pick'em week is one atomic, …
docs/mvp-spec.md:145:4. **Push/Tie Resolution** — on an ATS push or SU tie: member advances and the team is consumed (default), or member is eliminate …
docs/mvp-spec.md:296:Confidence scoring · Money Pick · Elimination lives > 1 · Buy-back · Elimination extension weeks ("continue until one winner") ·  …
docs/mvp-spec.md:303:| Cancellation re-picks | Shipped, then removed (ADR-0018); a cancelled game's pick pushes and the push stands | …
docs/architecture.md:69:**1. Unit — `packages/scoring` (exhaustive).** Table-driven tests, one case per rule and edge case in the MVP spec: Pick'em's  …
docs/architecture.md:301:| Cancellation re-picks (Pick'em) | **Removed** (ADR-0018) | No substitute endpoint; a cancelled game's pick pushes and the p …
docs/architecture.md:303:| Pick'em tiebreaker | **Removed** (ADR-0018) | No `differential` columns anywhere; the ranking core sorts on points and shar …
docs/architecture.md:304:| Week moves | **Not modelled** (ADR-0019) | `moved` leaves the game-status set; a real move is an admin `cancelled` override …
docs/architecture.md:307:| Push/tie resolution config | Elimination only (ADR-0018) | Pick'em's push is the constant 0.5 inside its scoring function;  …
docs/architecture.md:329:Each handles its mode's edge-case matrix from the product spec: Pick'em's fixed half-point push, Elimination's advance-or-eli …
docs/architecture.md:376:**Both documents stay locked at v0.3 and are amended by recorded ADRs rather than re-versioned.** The Pick'em rule surface de …
```

Account for every hit:

- `mvp-spec.md:5`, `architecture.md:376` — the two amendment notes, which name the ADRs by
  the rules they remove. Naming a removed rule is the point of the note.
- `mvp-spec.md:145` — **Elimination's own** Push/Tie Resolution setting (advance vs eliminate,
  not a point value). Deliberately retained; plan §Decisions 3 and ADR-0018 both exempt it.
- `mvp-spec.md:296`, `mvp-spec.md:303` — the Out of Scope list and the Decisions Log row that
  record re-picks as shipped-then-removed. The log is a history of decisions, so the row
  survives with a corrected outcome rather than being deleted.
- `architecture.md:69`, `:329` — Elimination's advance-or-eliminate resolution in the scoring
  test list and the settlement matrix. Still true; `settleEliminationWeek` still handles it.
- `architecture.md:301`, `:303`, `:304`, `:307` — MVP Rule Scope rows recording each removal
  and its architectural consequence. That table exists to record exactly this.

No hit survives for `odds_snapshots`, the `/repick` route, the `Diff` column, or a Pick'em
tiebreaker.
