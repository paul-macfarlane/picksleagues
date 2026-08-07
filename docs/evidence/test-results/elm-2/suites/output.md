# ELM-2 — unit and integration suites

Run against the integrated branch tip `29fbe00`. Integration runs in-process
Hono against **real Postgres** (`picksleagues_test`, auto-created and migrated by
the suite's global setup on port 5433) — there are no mocked repositories
anywhere in this work package.

## `pnpm test` (unit)

```
$ vitest run --project unit
 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues
 Test Files  28 passed (28)
      Tests  481 passed (481)
```

## `pnpm test:integration`

```
$ vitest run --project integration
 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues
 Test Files  32 passed (32)
      Tests  592 passed (592)
   Duration  31.33s
```

## The ELM-2 cases, and what each one actually pins

From `apps/api/test/survivor-picks.test.ts`,
`apps/api/test/survivor-settings.test.ts`, and `apps/api/test/league-weeks.test.ts`.

| Criterion | Test |
|---|---|
| Both constraints exist in the migrated database, and the team ledger is **partial** | `survivor_picks constraints > enforces one pick per member per week, and the team ledger as a PARTIAL unique` — queries `pg_indexes` and asserts the index definition carries a `WHERE … released` predicate, not merely that an index by that name exists |
| One pick per week; the upsert replaces | `replaces the week's pick rather than adding one — a pick is changeable until kickoff` |
| Lock re-validated inside the write transaction (arch D11) | `409s once the picked game has kicked off, leaving the stored pick untouched` |
| A pick cannot be changed once its **own** game has kicked off | `409s a change out of a pick whose own game has kicked off, even into an unstarted one` |
| Team consumption refused at the service | `409s a team the member has already used in another week` |
| …and enforced by the **database** | `has the database refuse the reuse too, under the name the service maps` — bypasses the service, catches the real driver error, asserts `isUniqueViolation(caught, "survivor_picks_member_team_unique")` |
| A released team is re-pickable (spec §Game Mode 2 — cancelled game) | `lets a released team be picked again — a cancellation hands it back` |
| Eliminated member refused; lag-window pick accepted | three-case `it.each` over the settled ledger: no row → 200, row without an elimination week → 200, row naming one → 409 |
| Visibility filtered in the query layer (spec §Pick Visibility) | `hides another member's pick until its game kicks off, while showing that they picked`; `always shows the caller their own pick` |
| ATS spread acceptance | `409s a spread that has moved under the submission`; `stores the accepted spread when it is still current`; `409s a game with no line posted yet`; `accepts a straight-up pick with no spread at all` |
| `consumedTeamIds` is viewer-scoped and excludes the requested week | `lists the caller's consumed teams, excluding the week they are still free to change`; `does not leak another member's consumed teams` |
| `listLeagueWeeks` serves Survivor | `serves a Survivor league too — both NFL modes carry a start/end week range` |
| A settings change that would strand picks clears them | `clears every pick on the instance when Pick Type changes, and commits the settings write with it` |
| …and is refused once any pick has locked, **without** applying the settings | `409 picks_locked`, pick still present, stored `pickType` unchanged — the last assertion is what proves the reset and the settings write share one transaction |
| A change that strands nothing clears nothing | `pushTieResolution`-only change → 200, both picks survive |
| Pick summary counts what a save would delete, and is commissioner-gated | counts over a fixture including a `released: true` row and a non-picking member; 403 `not_commissioner` for an ordinary member |
| Sim reset reports the Survivor rows it destroys | `counts the Survivor tables it deletes, rather than letting them vanish by cascade` (`sim-reset.test.ts`) — added after runtime verification found the omission; asserts the **counts**, since the rows would cascade either way and the count is what the sim panel reports |

Pick'em's own suites — including its `picks_locked` and pick-summary blocks —
were **not modified** and pass unchanged inside the 592-test run. That is the
regression proof for the shared settings-reset refactor and the
`PickemPickSummary` → `LeaguePickSummary` component rename.
