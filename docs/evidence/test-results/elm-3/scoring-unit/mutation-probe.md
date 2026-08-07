# Mutation probe — does the suite actually bite?

Run 2026-08-07 on `feat/elm-3-survivor-week-settlement`, before the review-fix
commit, against `packages/scoring/src/survivor.test.ts`.

A green suite proves the tests ran, not that they would catch a regression. Each
row below breaks one load-bearing rule in `survivor.ts`, runs the suite, and
restores the file. A rule whose mutation left the suite green would be a rule the
tests only appear to cover — none did.

| Rule broken | How | Result |
| --- | --- | --- |
| Everyone-out revival | `revived` forced to `false` | 4 failed / 33 passed |
| Cancellation returns the team | cancelled branch consumes it instead | 3 failed / 34 passed |
| A fatal tie eliminates | tie never eliminates, whatever the setting | 2 failed / 35 passed |
| A missed pick eliminates | the missed-pick branch stops eliminating | 4 failed / 33 passed |
| An incomplete week grades to nothing | the blocking-games early return is skipped | 5 failed / 32 passed |

The source was restored from a byte copy after the last mutation and the suite
re-run green (38 passed) before anything was committed.
