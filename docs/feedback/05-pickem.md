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
| W1-2 | Settings form needs a warning before a change discards everyone's picks | **Done** — inline warning + confirm dialog with real counts, backed by a new `GET /leagues/{id}/pickem/pick-summary`; `pickemSettingsInvalidatePicks` moved to `packages/schemas` and the client parses through `LEAGUE_SETTINGS_SCHEMAS` so both surfaces share the rule *and* its inputs. A failed or errored summary query fails safe (warn + confirm without a count) rather than reading as "nothing at risk". The client's answer is advisory — the server's transactional read is authoritative — so a concurrent second commissioner can still see the two disagree. ADR-0015 updated. |
| W1-3 | Why `side` instead of a team id — referential-integrity risk? Could it change? | **Answered, kept, guarded.** `side` is deliberate: schedule sync `UPDATE`s `home_team_id`/`away_team_id` in place when the provider corrects a game, so a team-id pick would silently point at the wrong team or match neither and make settlement throw. It has no dangling-reference risk (the pick FKs `games`; `side` selects a column of that row) and spreads are home-relative, so `side` is what scoring consumes directly. Residual risk — a home/away *swap* silently repoints an existing pick — is now surfaced by `warnOnTeamCorrectionWithPicks`. |
| W2-1 | Are `pick_results`/`standings` really shared across modes, or Pick'em-specific? | **Forked per mode** → `pickem_pick_results`, `pickem_standings`. This deviates from locked architecture D9; recorded as **ADR-0016** with architecture.md and engineering.md amended. Spec evidence: Elimination's board is a survivor board with no points or rank, and March Madness ranks one row *per bracket*. `packages/scoring/src/standings.ts` stays generic — the ranking core was the only real reuse. |
| W3-1 | No code feedback | — |

**Decisions the reviewer made this round:** fork the tables rather than widen them with
nullable per-mode FKs; mode-scope HTTP paths as well as code; warn with real counts
rather than a static caveat.

**Carried forward:** `/admin/leagues/{id}/rebuild` keeps its mode-agnostic name and
dispatches to Pick'em only — it becomes a real per-mode dispatch when Elimination and
March Madness settlement land.

## Round 2 — 2026-07-27 (UX, after hands-on testing)

Eleven items from using the app. Landed on `feat/pkm-ux`, branched off
`feat/pkm-wave-3` so PR #20 stayed reviewable as the epic. Built by six agents over
disjoint file sets, then reviewed as one diff — the cross-agent inconsistencies that
parallelism invites were the review's main quarry, and it found several.

| # | Item | Resolution |
| --- | --- | --- |
| 1 | Odds missing for the 2026 season — bug? | **Yes, a real one.** `nflSeasonYearFor` returns `utcYear - 1` Jan–Jul, so all offseason a bare `sync-odds` targeted the *concluded* season, no-op'd, and never saw next season's already-ingested games. Not harmless: locking is `kickoff > now`, so an ATS league created in the offseason refuses every pick with `spread_unavailable`. `sync-odds`/`sync-scores` now roll forward to `seasonYear + 1` — query-only, never creating a row. Skipped runs also stopped reporting as successes. |
| 2 | Standings name truncated on mobile; want consistent user display | Shared `UserIdentity`: display name primary, `@username` secondary where there's room, dropped rather than truncating the name on tight surfaces. Email stays the session menu's exception (the viewer's own, possibly pre-claim, account). Codified in engineering.md. |
| 3 | Show wins/losses/pushes | Three columns on `pickem_standings`, tallied in the mode-agnostic `aggregateStandings`. Ranking deliberately unchanged — spec §Tiebreakers is points then differential; W-L-P is display data. |
| 4 | Sortable standings columns | Pure `sortStandingsRows`; server-assigned `rank` travels with its row and is never recomputed, so ties keep sharing a rank. |
| 5 | Team logos in the picks UI | Pure render — the pipeline already ran end to end and `apps/web` simply never referenced the fields. |
| 6 | Submitting requires scrolling past 16 games | Fixed action bar carrying progress and Save. `fixed`, not `sticky`: `Card`'s `overflow-hidden` would clip a sticky descendant. |
| 7 | Sticky league header and tabs? | **Tabs yes, header no.** Tabs are navigation and one line tall; the header is a title block already read, and pinning it would cost a large share of a 375px viewport on exactly the long-scroll screens. Offset by a measured `--app-header-height` because the sim banner changes the header's height. |
| 8 | Collapse to made picks after submitting? | **No — keep the full slate, mark what's picked.** ADR-0015's whole-week replace means changing your mind usually means picking a *different* game, which a made-picks-only view can't show. |
| 9 | Times show seconds | `formatDateTime` was a bare `toLocaleString()`; fixed in the helper so all 20 call sites follow. |
| 10 | Native date picker | shadcn CLI at the repo's `base-nova` style → Base UI popover + `react-day-picker` calendar. Verified it generated Base UI, not Radix. |
| 11 | Admin editing of games/scores/status | **ADM-2 built**: `PUT /admin/games/:id/override`, `admin_audit`, re-settlement via the existing `settlePicksForGames`. |

**Scope change:** `admin_audit` moved from ADM-3 into ADM-2 — engineering.md requires
every override to write it, which an override endpoint can't satisfy against a table
that doesn't exist. ADM-3 keeps the audit view. Rebuild auditing stays owed, and the
rule now says so instead of overclaiming.

**The review's most valuable catch** was an ADM-2 guard written against a *transition*
rather than a resulting state — orchestrator error in the spec, faithfully implemented.
Two paths (a status-only edit on a wrongly-scheduled game; a three-step edit ending by
clearing the status override) left a played game unlocked and pickable, letting members
pick a game whose final score the UI was already showing. Fixed to assert the invariant
on the post-write state.
