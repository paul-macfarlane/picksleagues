# 0046. Manual sports-data overrides are removed; the database is a provider cache

- **Status:** Accepted
- **Date:** 2026-08-26
- **Related:** architecture.md §Manual Sports Data Overrides, §Testing Strategy (integration list), D13, D15; backlog epic `21-override-removal.md` (OVR-1–5)
- **Supersedes:** [0041](0041-stats-overrides-outlive-resync.md), [0042](0042-team-identity-overrides.md)
- **Amends:** [0019](0019-week-moves-out-of-scope.md) — the `cancelled` *override* it names as the week-move remedy becomes a documented SQL edit; the rest of 0019 stands

## Context

Every provider-synced table members see carries `override_*` parallels
(arch D15): seven on `games`, five on `teams`, twelve on
`nfl_team_season_stats`, a JSONB layer on `nfl_game_stat_context`. Around them
sit a three-state merge helper, a precedence "single home" per table, an
unlock guard that reasons about lock state, settlement re-run on write, an
anomaly detector re-expressing the guard over the whole database, four admin
forms with their patch helpers, four audit actions, and ~2,700 lines of
integration tests. The architecture justified all of it with one sentence:
ESPN's unofficial feed will occasionally be wrong and there is no vendor SLA.

Through a real launch and a full season of simulator replays, the owner has
never used an override. The two jobs it was meant to do went elsewhere:
manual values for testing are edited into simulator fixtures, and a bad value
in production is a bug in ingestion the owner would rather fix at the source
than paper over with a temporary correction. `docs/mvp-spec.md` never mentions
overrides — the product rules (a cancelled game pushes, and so on) are stated
in terms of game state, not of how the state got corrected — so this is an
architecture commitment with no product surface behind it.

What overrides cost is not the columns but the second source of truth. The
repo's load-bearing data rule is "jobs ingest external data into our tables;
reads serve our tables" — the database is a cache of the provider. Overrides
made it a cache *plus* a human-authored layer, and every intricate piece above
exists to keep the two from disagreeing: precedence homes so a correction
can't resolve one way at read and another at settlement, the guard so a
corrected kickoff can't reopen a decided game, re-settle-on-write so standings
follow the correction. Remove the layer and the machinery has nothing to
reconcile.

Options weighed: keep game status alone as the ADR-0019 remedy (rejected —
one field keeps the whole mechanism); keep the columns but hide the UI
(rejected — the precedence homes and guard remain in every read path, which
is the cost).

## Decision

- **All `override_*` parallels, `overridden_by`/`overridden_at`, and their
  readers are removed** from `games`, `teams`, `nfl_team_season_stats`, and
  `nfl_game_stat_context`. Reads and settlement consume provider columns
  directly; `resolveGameOverrides`, `effectiveKickoffAtSql`,
  `resolveTeamIdentity`, `effectiveTeamColumns`, the stats resolution home,
  `mergeOverrideField`, and the `override_unlocks_game` refusal are deleted.
- **The correction path is re-sync, then a documented SQL edit.** A stale copy
  is fixed by the next sync run (idempotent, admin-triggerable). A provider
  value that is itself wrong — including ADR-0019's week move — is fixed by an
  admin editing the provider column in the database console, following a
  procedure in `docs/runbooks/jobs.md`. Ingestion overwrites provider columns
  on every run, so such an edit holds only while the provider agrees with it;
  the procedure says so.
- **`admin_audit` survives for `league_rebuild`**; the four override actions
  leave `ADMIN_AUDIT_ACTION`. The anomaly detector goes with the guard it
  mirrored.
- **The member avatar override (`users.image_override`, ADR-0022) is
  untouched** — a member preference over an OAuth default, not an operator
  correction of provider data.
- **`docs/architecture.md` is amended in the closing task** (OVR-5), not
  ahead of the code: v0.4 describes the shipped system, and until OVR-4 lands
  the shipped system still has the columns.

## Consequences

- Every serializer and settlement input loader loses a coalesce; the sim
  clock's kickoff bounds collapse to the provider kickoff; `spreadSource` no
  longer needs a suppression rule. "Override precedence" leaves the
  evaluator's mandatory-review list.
- **Accepted failure mode:** a wrong provider value that ESPN does not
  self-correct has no in-app fix and no audit trail — the fix is a console
  edit by the owner, and it lasts only as long as the provider keeps agreeing.
  At friends scale, with a feed that has not been wrong in production yet,
  that is the trade.
- The column drop (OVR-4) is a data-loss migration. It is gated on a
  production check that no `overridden_at` is set; any live correction is
  re-applied to the provider column or knowingly let lapse before merge.
- ADR-0040's original "display-only, no overrides" stance for stats is
  restored; ADR-0041 and ADR-0042 are superseded rather than reverted, since
  their reasoning (a re-sync only helps when the provider is right) is exactly
  the failure mode this ADR accepts on purpose.
- **Revisit if** a provider error in production ever costs a member a graded
  pick and the console edit proves too slow or too risky to make in the
  window between a game going final and its week settling. That is the case
  the layer was built for, and one real instance of it is the evidence
  reinstating it would need.
