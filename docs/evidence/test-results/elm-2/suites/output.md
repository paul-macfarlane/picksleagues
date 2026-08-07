# ELM-2 — unit and integration suites

Run against the integrated branch tip `9dc144f`. Integration runs in-process
Hono against **real Postgres** (`picksleagues_test`, auto-created and migrated by
the suite's global setup on port 5433) — there are no mocked repositories
anywhere in this work package.

## `pnpm test` (unit)

```
$ vitest run --project unit
 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues
 Test Files  28 passed (28)
      Tests  480 passed (480)
```

## `pnpm test:integration`

```
$ vitest run --project integration
 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues
 Test Files  32 passed (32)
      Tests  582 passed (582)
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
| `consumedTeamIds` is viewer-scoped and excludes the requested week | `lists the caller's consumed teams, excluding the week they are still free to change`; `does not leak another member's consumed teams` |
| `listLeagueWeeks` serves Survivor | `serves a Survivor league too — both NFL modes carry a start/end week range` |
| A settings change that would strand picks clears them | `clears every pick on the instance when re-resolution advances the start week, and commits the settings write with it` |
| …and is refused once any pick has locked, **without** applying the settings | `409s picks_locked — and leaves both the pick and the settings untouched — when a locked pick would be stranded`; the settings half of that assertion is what proves the reset and the write share one transaction |
| A change that strands nothing clears nothing | `clears nothing when only Push/Tie Resolution changes — settlement reads it at grading time` |
| Sim reset reports the Survivor rows it destroys | `counts the Survivor tables it deletes, rather than letting them vanish by cascade` (`sim-reset.test.ts`) — added after runtime verification found the omission; asserts the **counts**, since the rows would cascade either way and the count is what the sim panel reports |

**ATS coverage was deleted, not moved.** ADR-0026 made Survivor straight-up
only, so the spread-acceptance block, the Survivor `pickType` schema cases, and
the pick-summary endpoint's tests all describe behaviour that no longer exists.
Deleting a rule deletes its tests; the suite counts fall accordingly (unit
481→480, integration 592→582) and that drop is the expected shape of this
change, not a coverage regression.

The settings-reset suite was **rewritten rather than dropped**, because the rule
survives even though its old trigger did not. It now drives the surviving one: a
save whose server-side re-resolution advances the start week past a week already
under way, stranding a pick in it — ADR-0015's "a league re-enters pre-start
mid-season" state, arranged with a start week that holds no games.

Pick'em's own suites — including its `picks_locked` and pick-summary blocks —
were **not modified** and pass unchanged inside the 582-test run. That is the
regression proof for the shared settings-reset refactor and for reverting the
`PickemPickSummary` component back out of its brief mode-agnostic name.
