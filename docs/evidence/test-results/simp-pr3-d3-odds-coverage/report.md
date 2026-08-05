# SIMP-16 — odds coverage across the ESPN week boundary

Work package `simp-pr3`, deliverable D3. Branch `feat/simp-pr3-presets-and-closeout`,
base `staging` @ `9f80131`. Commit `49612a3`.

_Placed by the frontier orchestrator: the worker's harness refused its own file write and
it reported that rather than routing around the refusal. The boundary data below was
gathered by the orchestrator against the live API, not taken from the worker._

## The finding: the Tuesday gap is real

Observed against the live ESPN core API on 2026-08-05 —
`sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/types/{2,3}/weeks/{n}`,
the same endpoint `EspnProvider.#fetchNflWeeks` reads:

```
reg wk  1: start=2025-09-04T07:00Z (Thu)  end=2025-09-10T06:59Z (Wed)
reg wk  2: start=2025-09-10T07:00Z (Wed)  end=2025-09-17T06:59Z (Wed)
reg wk  3: start=2025-09-17T07:00Z (Wed)  end=2025-09-24T06:59Z (Wed)
reg wk 10: start=2025-11-05T08:00Z (Wed)  end=2025-11-12T07:59Z (Wed)
post wk 1 (Wild Card): start=2026-01-07T08:00Z (Wed) end=2026-01-14T07:59Z (Wed)
```

After the opening week an ESPN week runs Wednesday ~3:00am ET → the following Wednesday
~2:59am ET (07:00Z under EDT, 08:00Z under EST) and consecutive windows are contiguous —
no gap. So `startsAt <= now < endsAt` matches at essentially every in-season instant, and
on a **Tuesday** it matches the week whose games were all played the preceding
Thursday/Sunday/Monday. Every one fails the job's `kickoffAt > now` filter, so the old
current-week-only target priced **zero games** on a Tuesday and the coming weekend carried
no spread until Wednesday 3am ET. Locking is `kickoff > now`, so members could already
pick that weekend; in an ATS league every such pick was refused `spread_unavailable`.

The ticket asked "verify picks genuinely open on Tuesday." They did not.

Worth recording: the week-window literals in `packages/core/src/espn-provider.test.ts`
were **Thursday-anchored and constructed** — plausible-looking data that was never real,
and the shape that hid this gap from the test suite. They now follow the observed
Wednesday-anchored windows, with the verification date noted in the file.

## The change

`syncNflOdds` prices the anchor week plus the week following it. The anchor is unchanged
(week in progress, else next upcoming); the follower is the earliest week in the same
season starting after the anchor, found **by start time rather than week type**, so
regular week 18 pulls in postseason week 1 — a type filter would have left the Wild Card
slate unpriced through the last regular week. A named week (`?week=`) still targets that
week alone, so a one-week manual backfill never rewrites a neighbour.

Per-week pricing moved into `priceUnstartedGames`, which keeps the per-game predicate
(`kickoffAt > now` + `UNSTARTED_GAME_STATUSES`), the leave-an-unpriceable-game-alone rule,
the unchanged-line skip, and the provider-fields-only write untouched. The extraction was
forced rather than cosmetic: the old `unstartedGames.length === 0` early return would
otherwise have short-circuited the second week on exactly the Tuesday this ticket exists
for.

## Commands (repo root)

| Command | Exit | Salient output |
| --- | --- | --- |
| `pnpm vitest run --project integration nfl-sync-odds` (red, before implementation) | 1 | `Tests 5 failed \| 22 passed (27)` — only the new cases fail |
| `pnpm format` | 0 | rewrapped `sync-odds.ts` only |
| `pnpm lint` | 0 | `eslint .` clean, no Clock-discipline violation |
| `pnpm typecheck` | 0 | all projects `Done` |
| `pnpm test` | 0 | 27 files, 526 tests passed |
| `pnpm db:up && pnpm test:integration` | 0 | 27 files, 490 tests passed |
| `pnpm contract:check` | 0 | `openapi/` regenerated clean |

`pnpm test:e2e` was deliberately not run here — the orchestrator runs it on the integrated
candidate, and its result is in `../simp-pr3-aggregate/report.md`.

## New test cases

`apps/api/test/nfl-sync-odds.test.ts`, describe
`syncNflOdds: real ESPN week windows (the Tuesday gap)`, seeded with the real
Wednesday-anchored windows:

- `Tuesday, with the current week fully played: the coming week's games still come out priced`
- `mid-week: prices what is left of the current week and all of the next`
- `re-running over both weeks leaves row state identical`
- `an explicit week targets that week and only that week`
- `the week following the last regular week is the first postseason week`

Pre-existing coverage kept green unchanged: unstarted-only pricing, postponed vs
cancelled, clock-stamped `updated_at`, unpriced-game counting, same-response idempotency,
line movement, `override_spread` surviving a re-sync, pre-season fall-forward,
`no_current_week`, `week_not_synced`, `season_not_synced`, and the offseason roll-forward
block.

## Cadence: unchanged, and why

`nfl-sync-odds` stays at `0 12,17,22 * * *`. Two-week coverage removes the boundary
dependency outright rather than relying on a run landing soon after the Wednesday
rollover. What remains is ordinary line-movement freshness: the overnight gap is 6pm ET →
8am ET, so a late-moving line can be ~14h stale on the board. That is bounded by design —
the accepted number is pinned per pick as `spread_at_pick` with the staleness refusal
behind it, so no member is graded against a number they did not see. A fourth tick is the
cheap answer if freshness complaints ever appear; it was not made.

## Out of scope, reported not fixed

`requiredPickemPickCount` returning 0 during the gap (ADR-0018 decision 2 excludes unpriced
ATS games from the required set) is **not** a hazard. Traced at both call sites:

- API (`apps/api/src/services/pickem/picks.ts`): with `required === 0`, an empty submission
  passes both size checks and then hits the `if (submissions.length > 0)` guard, which
  skips the insert entirely. Nothing is written, and the already-submitted gate counts
  `pickem_picks` rows — so the member is *not* marked submitted and can submit the real
  sheet once the lines land.
- SPA (`apps/web/src/components/league/pickem-picks.tsx`): `complete` requires
  `required > 0`, and an `awaitingLines` branch already suppresses the action bar in this
  exact state.

The only imprecision is that an API-only client gets a 200 for a submission that persisted
nothing. That is a contract question, not a bug, and no ticket was created for it.

No secrets, tokens, or database URLs appear in this file or in the diff.
