# NFL Pick'em epic — feedback log

Rounds of human review feedback on `backlog/05-pickem.md` and how each item resolved.
See [README](README.md) for the convention.

## Round 1 — 2026-07-27

Review of PRs #18 (`feat/pkm-wave-1`), #19 (`feat/pkm-wave-2`), #20 (`feat/pkm-wave-3`).
All items were applied to `feat/pkm-wave-3` at the reviewer's direction — waves 1 and 2
keep their original naming, so the stack only reads consistently once #20 merges.

| # | Item | Resolution |
| --- | --- | --- |
| W1-1 | `routes/picks.ts` and the schemas are named generically, but a Pick'em pick is mode-specific; wanted repo-wide | **Done** — mode-scoped rename across DB tables, Zod schemas + OpenAPI components, API routes/services, HTTP paths, web modules, query keys, and components (`fdfa7cf`). Codified as an engineering rule so the next mode doesn't re-litigate it. |
| W1-2 | Settings form needs a warning before a change discards everyone's picks | **Done** — inline warning + confirm dialog with real counts, backed by a new `GET /leagues/{id}/pickem/pick-summary`; `pickemSettingsInvalidatePicks` moved to `packages/schemas` so UI and API share one rule. ADR-0015 updated. |
| W1-3 | Why `side` instead of a team id — referential-integrity risk? Could it change? | **Answered, kept, guarded.** `side` is deliberate: schedule sync `UPDATE`s `home_team_id`/`away_team_id` in place when the provider corrects a game, so a team-id pick would silently point at the wrong team or match neither and make settlement throw. It has no dangling-reference risk (the pick FKs `games`; `side` selects a column of that row) and spreads are home-relative, so `side` is what scoring consumes directly. Residual risk — a home/away *swap* silently repoints an existing pick — is now surfaced by `warnOnTeamCorrectionWithPicks`. |
| W2-1 | Are `pick_results`/`standings` really shared across modes, or Pick'em-specific? | **Forked per mode** → `pickem_pick_results`, `pickem_standings`. This deviates from locked architecture D9; recorded as **ADR-0016** with architecture.md and engineering.md amended. Spec evidence: Elimination's board is a survivor board with no points or rank, and March Madness ranks one row *per bracket*. `packages/scoring/src/standings.ts` stays generic — the ranking core was the only real reuse. |
| W3-1 | No code feedback | — |

**Decisions the reviewer made this round:** fork the tables rather than widen them with
nullable per-mode FKs; mode-scope HTTP paths as well as code; warn with real counts
rather than a static caveat.

**Carried forward:** `/admin/leagues/{id}/rebuild` keeps its mode-agnostic name and
dispatches to Pick'em only — it becomes a real per-mode dispatch when Elimination and
March Madness settlement land.
