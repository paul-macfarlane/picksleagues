# Epic: Override Removal (OVR)

Removes the manual sports-data override layer — the admin-written `override_*`
parallels on `games`, `teams`, `nfl_team_season_stats`, and
`nfl_game_stat_context`, with the merge helper, the precedence "single homes",
the unlock guard, re-settle-on-write, the anomaly detector, and the four admin
forms that front them. The DB goes back to being a cache of the provider, full
stop. Ref: ADR-0046; arch §Manual Sports Data Overrides, D15.

Decisions (owner, 2026-08-26):

- **All four families go, not a subset.** Keeping one field (say, game status)
  keeps the whole mechanism — merge helper, precedence home, audit action,
  form — for a case that has never fired.
- **Correction is re-sync, then a documented SQL edit.** A wrong provider value
  is fixed by the next sync run; the once-a-decade case ADR-0019 assigned to a
  `cancelled` override (a game moved between weeks) becomes a hand SQL edit on
  the provider column, written up in `docs/runbooks/jobs.md`. Ingestion only
  writes provider columns and ESPN agrees about a real cancellation, so the
  edit is not fought by the next sync.
- **Testing needs are met by the simulator.** Scenario fixtures are edited
  directly when a run needs a manual value; the override forms were never the
  tool actually reached for.
- **`admin_audit` stays.** `league_rebuild` writes it; only the four override
  actions leave the enum. The audit-log view survives if it still earns its
  place with one action — the task decides.
- **Not in scope:** the member-set avatar override on `users.image_override`
  (ADR-0022) — same word, different feature; it is a member preference, not
  an operator correction.

Shape constraints the tasks inherit: the column drop is a data-loss migration,
so it lands last and only after a production check for live overrides; game
overrides sit under lock and settlement semantics, so that diff takes the
mandatory `evaluator` round; `docs/architecture.md` is locked at v0.4 and
describes the *shipped* system, so its amendment (§Manual Sports Data
Overrides, D15, D13's "supplied instant" exception, the admin-surface
inventory) rides with the closing task rather than ahead of the code.

- [x] **OVR-1** — Remove the display-only override families: NFL season stats,
  NFL stat context (ADR-0041) and team identity (ADR-0042) — columns' readers,
  `resolveTeamIdentity`/`effectiveTeamColumns` and the stats resolution home
  collapse to direct column reads; the two admin-nfl-stats PUT routes and the
  teams PUT route, their services, forms, patch helpers, tests, and the three
  audit actions go. Columns stay in the schema until OVR-4. _(deps: none)_
- [x] **OVR-2** — Remove game overrides: `PUT /admin/games/{id}/override`, the
  `override_unlocks_game` guard, re-settle-on-write, `mergeOverrideField`,
  `resolveGameOverrides` and its SQL twins (readers go straight to provider
  columns — league-weeks, slate, both settlements, the sim clock's
  `least/greatest` kickoff bounds, `spreadSource` suppression), the game
  override form and patch helper, and the `game_override` audit action.
  Evaluator round mandatory (lock + settlement). _(deps: OVR-1)_
- [~] **OVR-3** — Retire the detectors and views that only made sense beside a
  fix path: `GET /admin/games/anomalies` and its card; the "provider / override
  / resolved" three-layer rendering in the admin browsers becomes one value.
  Decide whether the audit-log view stays for `league_rebuild` alone.
  _(deps: OVR-2)_
- [ ] **OVR-4** — Drop the columns: every `override_*` plus `overridden_by` /
  `overridden_at` on the four tables, one migration. Pre-flight (human):
  `SELECT` each table for a non-null `overridden_at` in production and record
  the result in the PR — a live row is a correction the drop destroys and must
  be re-applied to the provider column (or let lapse) before merge.
  Regenerate the contract. _(deps: OVR-3)_ _(ready-for-human)_
- [ ] **OVR-5** — Docs and rules: amend `docs/architecture.md` v0.4 (the
  override section, D15, D13's exception, admin inventory, the integration-test
  list), `.claude/rules/engineering.md` (delete the precedence rule and the
  `mergeOverrideField`/`admin-overrides.ts` citations; drop "override
  precedence" from the evaluator mandate in `engineering.md`, `evaluator.md`
  and the `/task` skill), `docs/runbooks/jobs.md` (the SQL-edit correction
  procedure), `docs/runbooks/verification.md`, and the ADR index
  (0019 amended, 0041/0042 superseded by 0046). _(deps: OVR-4)_
