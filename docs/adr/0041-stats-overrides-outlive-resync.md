# 0041. Stats tables carry override parallels after all

- **Status:** Accepted (amends [0040](0040-game-stats-are-ingested-display-data.md))
- **Date:** 2026-08-13
- **Related:** architecture.md §Manual Sports Data Overrides / D15, backlog STAT-7

## Context

ADR-0040 shipped `nfl_team_season_stats` and `nfl_game_stat_context`
deliberately override-free: display-only data, never feeding settlement or
locking, with "the next sync run" as the recourse for a bad value. The owner
reversed that trade (2026-08-13): the next sync run is only a recourse when
the *provider* is right and our copy is stale — when the provider itself is
wrong (a bogus injury entry, a wrong record split), every sync re-asserts the
error, and a direct edit to the provider columns would be silently clobbered
by the next run. Display data still faces members deciding picks; a correction
that lasts exactly until 5am is not a correction.

The games precedent (arch D15) already answers the shape for the record-facts
table: parallel `override_*` columns, `override_* ?? provider_*` at read,
`admin_audit` in the write's transaction. The context table is JSONB, where a
column-for-column parallel doesn't exist, so its override shape was this
task's decision.

## Decision

- **`nfl_team_season_stats` gets the full D15 treatment:** twelve `override_*`
  column parallels plus `overridden_by`/`overridden_at`, a three-state PUT
  (omit keeps, null clears, value sets), and audit rows whose prior value is
  the override layer. Precedence resolves in `services/nfl/game-stats.ts` —
  the one home — and **derivations follow the resolved facts**: PPG, and the
  league-wide rank pool, are computed from effective values, so a corrected
  record ranks as corrected for every team.
- **`nfl_game_stat_context` gets a *sparse* `override_payload`:** a JSONB
  layer holding, per side, any of `injuries`, `fpiWinPct`, `atsSummary`,
  `lastFive`. A present field wins whole; an absent field falls through to the
  provider payload — field-level `override ?? provider`, the JSONB analogue of
  column parallels. Sparseness is the point: masking one wrong injury report
  must not freeze FPI/ATS/last-five at override-time values while the sync
  keeps refreshing them. The write is a PUT-replace of the whole layer (it is
  one value, not columns), normalized so an empty layer stores NULL — a
  cleared row is indistinguishable from one never corrected.
- **Overriding a field to empty is expressible (`injuries: []`); overriding a
  nullable scalar to null is not.** Hiding a provider FPI or ATS outright is
  suppression, not correction, and no failure so far needs it.
- **No settlement recompute, no lock-state guard.** Stats feed no outcome —
  the write is exactly the correction plus its audit row, unlike
  `setGameOverride`.
- The admin **Stats** tab (browsers + editors over both tables, provider /
  override / resolved side by side) is the operating surface, NFL-named like
  every stats surface (ADR-0040).

## Consequences

- ADR-0040's "no `override_*` parallels" bullet is superseded; its other
  decisions (ingestion-only data path, NFL naming, derive-at-read, prior-season
  fallback, tiered surface) stand.
- The stats sync is unchanged — it writes only provider fields, so the
  D15 invariant "a re-sync can never clobber a correction" holds by
  construction and is pinned by integration tests.
- A context override rides the additive-evolution rules: a new payload field
  ships in both the storage schema and the override schema, both with parse
  paths that materialize defaults.
- Two new audit vocabularies (`nfl_team_season_stats_override`,
  `nfl_game_stat_context_override`) and two new refusal codes
  (`team_season_stats_not_found`, `game_stat_context_not_found`) — correction
  never creates a row, so overriding an unsynced target is a 404, not an
  upsert.
