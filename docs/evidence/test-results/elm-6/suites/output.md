# Dashboard pick-status glance

The glance's states are covered in `apps/api/test/leagues.test.ts` beside the my-leagues
payload they ride on, rather than in a parallel file. Six cases: each of the four states,
a non-Survivor league carrying null, and elimination outranking a present pick.

Counted in the integration total in `../../elm-4/gates/output.md` (592 to 610 across the
work package). The worker also ran two mutation probes against the lock rule and reported
each failing the specific assertion that owns it:

- never treating a week as closed — failed the `locked` case (expected `locked`, got `pick_needed`)
- closing the week at the *first* kickoff instead of the last — failed the `pick_needed` case

The second is the Survivor-specific subtlety: a member may pick any unstarted game, so the
week closes against them only when every game has kicked off.
