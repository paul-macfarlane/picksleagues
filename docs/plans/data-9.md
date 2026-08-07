# DATA-9 — Unseeded playoff games must not be pickable

Work package: `DATA-9` (`backlog/02-game-data.md`). Status at planning time: `[ ]`, deps none,
tagged `_(needs-triage)_`.

**Plan status: DRAFT — unapproved.** Written by `/atlas-plan` (2026-08-06) under the owner's
delegated boundary decision ("I just want to make sure the game isn't pickable. I'll lean on
your discretion here"). Per the Atlas planning contract, invoking `/atlas-implement DATA-9`
approves this plan; ADR-0021 is drafted as step 1 of implementation, not pre-written here.

**Revision 2026-08-06 — season-range resolver fallback folded in.** The first draft accepted a
consequence the owner rejected on review: a Postseason (or Full Season) league could not be
*created* in the gap between a round kicking off and the next round being seeded. That window is
not a consequence of the ingestion boundary — it is an artifact of `resolvePickemSeasonRange`
selecting candidate start weeks by an inner join on `games`. `weeks.starts_at`/`ends_at` are
`NOT NULL` and land from the ESPN season *structure* months before seeding, so the database
already knows the round is ahead. The plan now carries that fix (step 3 below) and the trade-off
is removed rather than accepted.

**Red-team review:** performed 2026-08-06 (risk gate: the plan carries a database migration).
Verdict: no blocking findings; seven advisories (A1 deploy-race post-check on prod, A2
partial-seeding forfeit into ADR consequences, A3 honest creation-window scale, A4 comments that
would start lying, A5 predicate parity/sport scoping, A6 evidence-root clearing, A7 AC2 is
compositional) — all folded into the sections below at the markers `(red-team A#)`. A3 is
superseded by the revision above: the window it asked to be scaled honestly is now closed.

## [EXECUTION PLAN]

### Intent and relationship to the contract

The ticket is the contract: ESPN publishes each playoff round months ahead as real events whose
competitors are a shared TBD placeholder (`team.id` `-1`/`-2`, abbreviation `TBD`) with
placeholder kickoffs. Ingestion currently creates junk `teams` rows and pickable `games` rows for
them; a pick stores `side`, not a team, so seeding silently converts a submitted pick into a pick
on a team the member never chose, and ADR-0018's submit-once rule leaves no remedy. The ticket
asks for a decision on where the boundary lives (skip at ingestion vs. ingest and mark
unpickable), plus a record of that decision. The owner delegated the boundary choice
("I'll lean on your discretion here — I just want to make sure the game isn't pickable",
/atlas-plan invocation, 2026-08-06).

### The decision: skip at ingestion, detected in the ESPN adapter

**An event whose competitors are undetermined is not yet a game in our domain.**
`EspnProvider.fetchNflWeekGames` excludes any competition where **either** competitor is a
placeholder; the game row is created by the normal `sync-schedule` upsert on the first sync after
ESPN seeds the matchup. A one-time data migration removes the placeholder rows already ingested.
Recorded as **ADR-0021** (step 1 below drafts it; `/atlas-implement` invocation approves it per
the planning contract).

Paired with it, **`resolvePickemSeasonRange` stops deriving "is this week ahead?" from games
alone** (step 3), so a not-yet-seeded round is still a selectable start week. The two together are
the decision: skipping is what makes the game unpickable; the resolver fallback is what keeps the
skip from leaking into league creation. Recording them in one ADR keeps the reader from finding
the boundary rule without the compensation.

Detection lives in the adapter because the encoding (`team.id` `-1`/`-2`, abbr `TBD`) is an ESPN
shape, and provider shapes never leak (engineering rules). Predicate, applied per competitor
inside `mapCompetitionToGame`'s caller:

- numeric `team.id` < 0, **or** `abbreviation` equals `TBD` (case-insensitive).

Belt-and-suspenders on purpose: real NFL team ids are positive integers and no real abbreviation
is `TBD`, so false positives are ~impossible, while either signal alone identifies today's
placeholders. The `GameDataProvider.fetchNflWeekGames` doc comment gains the contract sentence —
returned games always name determined competitors — so `SimulatedProvider` (whose fixtures are
terminal truths of completed seasons and satisfy it by construction) and any future adapter
inherit the obligation.

**Why this beats ingest-and-mark** (the alternative the ticket names):

1. `games.home_team_id`/`away_team_id` are NOT NULL FKs (`packages/db/src/schema/sports.ts`) —
   marking requires either keeping the junk `teams` rows or a nullability migration.
2. Everything downstream already answers correctly for an *absent* game and wrongly for a
   *present-but-placeholder* one. ADR-0008 states "no games ingested for the start week ⇒
   pre-start"; `leagueStartAt` → `nflWeekFirstKickoffAt` (`apps/api/src/services/leagues/start.ts`)
   returns null over an empty week — so a league whose start week is unseeded is pre-start: joins
   open, settings editable, and the start becomes the real first kickoff the moment ESPN seeds
   the round. Ingest-and-mark would instead teach that computation (plus the slate `pickable`
   derivation, plus `requiredPickemPickCount`, plus the SPA row rendering) to ignore placeholder
   kickoffs — amending ADR-0008 and touching five surfaces instead of one. Note that
   ingest-and-mark does **not** buy back the creation window for free either: the only way it
   closes that window on its own is by letting an ESPN-invented kickoff drive league start, which
   makes the join cutoff and the displayed start time fabricated numbers that jump when seeding
   lands. Step 3's resolver fallback gets creation working with a start time that is honestly
   unknown until it is known, which is strictly better.
3. Placeholder kickoffs are junk data. Serving them (join cutoff, discovery `startsAt`,
   `start_week_passed` refusals, kickoff labels in the UI) means boundaries and labels derived
   from numbers ESPN invented.
4. The existing `pickable` boolean (`apps/api/src/services/slate.ts`) plus `GAME_NOT_PICKABLE`
   refusal would carry a mark cheaply — but only with a stored "unseeded" flag or a downstream
   check against placeholder team identity, which is exactly the provider-shape leak the adapter
   boundary avoids.

**Accepted trade-offs** (into ADR-0021's consequences):

- A postseason week shows an empty slate until its round is seeded (members can land there via
  `resolveCurrentWeekId`, which reads `weeks.starts_at`/`ends_at`, not games). Honest, and
  identical to the provisional-season presentation that already exists.
- ~~A Postseason league cannot be *created* during the window after a round's kickoffs have
  passed but before the next round is seeded.~~ **Rejected by the owner and fixed, not accepted**
  — step 3. ADR-0021 records the window as a consequence the boundary *would* have had, and the
  resolver fallback as what removes it, so a later reader doesn't reintroduce the inner join.
- **Partial-seeding forfeit** (red-team A2): rounds can seed across a sync boundary (each
  conference's games finish hours apart), so a member who submits while only part of the round's
  slate exists submits `required = min(cap, submittable)` over the seeded subset, and
  `ALREADY_SUBMITTED` permanently excludes them from games seeded later. Both boundary options
  share this, and it is congruent with ADR-0018 decision 2's accepted shape for late arrivals
  and unpriced ATS games — but it belongs in ADR-0021's consequences explicitly.
- If ESPN ever changes the placeholder encoding, unmatched placeholders would ingest again — the
  failure mode is the status quo ante, not new corruption, and
  `warnOnTeamCorrectionWithPicks` (`apps/api/src/services/nfl/team-correction-warning.ts`)
  remains the tripwire that logs when a picked game's teams change on re-sync.

**Considered, no change needed** (verified against the code during planning):

- `leagueStartAt`, `nflWeekFirstKickoffAt`, `isPreStart`: null/empty-week semantics already
  correct (above). A league whose start week is unseeded must stay pre-start — that is the
  property step 3 relies on, so it is load-bearing, not merely untouched.
- `startablePickemSeasonRangePresets`: no edit of its own; it inherits step 3 through
  `resolvePickemSeasonRange`, which is exactly why the availability answer and the
  `start_week_passed` refusal cannot disagree after the change.
- `sync-scores` / `sync-odds`: update-only by design (ADR-0007 sync-role split) — provider games
  with no matching row are ignored.
- Empty-week submission: `SubmitPickemPicksRequestSchema.picks` has no `.min(1)` and
  `requiredPickemPickCount` returns 0 over an empty slate, so an empty submission is a no-op that
  inserts nothing and does not consume the member's one submission (`held` counts existing rows).
  Same behavior as the fully-locked-week case that already exists; not this ticket's surface.
- Settlement: loads games by `pick.gameId` only; no picks can exist on skipped games.
- SPA: renders server-computed `locked`/`pickable`; an empty slate uses the existing
  `QueryState` empty handling. Zero web changes.

### Repository areas and interfaces affected

- `packages/core/src/espn-provider.ts` (+ `espn-provider.test.ts`) — the boundary.
- `packages/core/src/game-data-provider.ts` — contract doc comment on `fetchNflWeekGames`.
- `apps/api/src/services/leagues/season-range.ts` — the resolver fallback (step 3), plus the
  doc-comment sentences that currently present the inner join as the mechanism.
- `apps/api/test/league-season-range.test.ts`, `apps/api/test/pickem-season-range-presets.test.ts`
  — resolver and availability coverage for the unseeded-round cases.
- `packages/db/migrations/` — one custom data migration (cleanup).
- `apps/api/test/nfl-sync-schedule.test.ts` — reframe the existing TBD-teams test (lines
  ~719–780: it proves the ADR-0010 partial bootstrap index tolerates shared abbreviations, which
  stays true; its comment must stop presenting TBD ingestion as the normal provider path, and its
  fixture description should match real ESPN behavior — one shared `-1`/`-2` pair per round —
  consistently with the ADR (red-team A5)).
- **Comments that would start lying** (red-team A4): the `teams` table header comment presenting
  TBD ingestion as live provider behavior (`packages/db/src/schema/sports.ts` ~55–75) and
  `enrichTeamsFromListing`'s "(e.g. still a TBD playoff placeholder)"
  (`apps/api/src/services/nfl/ingest-season.ts` ~149–153) get the same past-tense reframing the
  test gets — the partial index stays, its justification becomes historical + bootstrap-general.
- `docs/adr/0021-*.md` (new), `docs/adr/0010-normalized-teams.md` (one-line amendment pointer:
  placeholder teams no longer ingest; the partial index stays for provider-id-less bootstrap
  rows), `docs/adr/0020-season-range-presets.md` (amendment pointer: the mid-week resolution rule
  now judges a games-less week by its own calendar window — see step 3).

**Explicitly out of scope:** any DB schema change; `slate.ts`/`pickable` semantics; any
`apps/web` change; `leagueStartAt`/`nflWeekFirstKickoffAt`/`isPreStart` (unchanged — step 3
touches candidate *selection* in `resolvePickemSeasonRange` only, never how a start instant is
derived once games exist); a second placeholder guard inside
`ingest-season.ts` (single boundary at the adapter, contract documented on the interface — a
duplicate guard would need the provider encoding downstream, the exact leak this design avoids);
Elimination/March Madness (unbuilt); new e2e specs (branch coverage pins lower — E2E covers
journeys).

### Ordered steps

1. **ADR-0021** "Unseeded playoff games are excluded at ingestion" via the `/adr` template —
   decision, alternatives (ingest-and-mark), consequences and revisit-ifs as above. It must carry
   **both halves**: the ingestion boundary, and the season-range resolver fallback that keeps
   league creation working across an unseeded round — including why `weeks.ends_at`, not
   `starts_at`, is the fallback bound. One-line amendment notes on ADR-0010 (placeholder teams no
   longer ingest) and ADR-0020 (a games-less week in range is now selectable). Cites: DATA-9,
   ADR-0007/0008/0010/0018/0020, spec §Game Mode 1 Core Rules, arch §Domain Model.
2. **Adapter boundary.** Placeholder-competitor predicate + exclusion in
   `espn-provider.ts` week-games mapping; contract sentence on
   `GameDataProvider.fetchNflWeekGames`. Unit tests (table-driven where cases differ only in
   inputs): both competitors TBD → excluded; one TBD one real → excluded; negative id with
   non-TBD abbreviation → excluded; `TBD` abbreviation with positive id → excluded; real
   matchup → passes through unchanged; a week mixing seeded and unseeded games → only seeded
   returned.
3. **Season-range resolver fallback** (`apps/api/src/services/leagues/season-range.ts`). Today
   the candidate scan inner-joins `games`, so a week with no games cannot be selected as a start
   week at all — which, once step 2 stops ingesting unseeded rounds, would refuse Postseason and
   Full Season league creation for the whole gap between a round kicking off and the next round
   being seeded. Change the join to a `leftJoin` and carry `weeks.endsAt` into the selected row
   alongside the `min(effectiveKickoffAtSql)` aggregate (group by already includes `weeks.id`, so
   `endsAt` is functionally dependent and adds no grouping key). In the existing TS loop, judge
   each candidate by `row.firstKickoffAt ?? row.endsAt`:

   - A week **with** games keeps today's exact rule — its first *effective* kickoff must be ahead
     (`override_kickoff_at ?? kickoff_at`, arch D15), so resolution still cannot disagree with
     `leagueStartAt` or the lock derivation about which week has begun.
   - A week **without** games is a candidate until its own calendar window ends. `weeks.starts_at`
     is deliberately *not* the fallback: ESPN's week windows open days before the first kickoff,
     so a `starts_at` comparison would mark a round "underway" while it is still entirely ahead
     and skip it. `ends_at` is the honest bound — the round has not been played yet, and
     ADR-0008 keeps the resulting league pre-start until games land regardless.

   Rewrite the two doc-comment passages that name the inner join as the mechanism (the
   `resolvePickemSeasonRange` header's ADR-0020 explanation and the inline comment at the join) —
   they would otherwise describe the opposite of what the code does. The header's existing
   paragraph defending the range-confinement (a Regular Season league created during the playoffs
   must find nothing and meet `start_week_passed`) stays true and stays.

   Coverage, in `league-season-range.test.ts` and `pickem-season-range-presets.test.ts`:
   Wild Card kicked off and Divisional unseeded → Postseason resolves to postseason 2 and is
   reported startable; same instant, Full Season also resolves to postseason 2; same instant,
   Regular Season still resolves to nominal and is **not** startable (range confinement intact);
   after the Super Bowl, Postseason is not startable; offseason/provisional season with weeks but
   no games → Regular Season resolves to nominal and is startable (unchanged); a seeded-and-ahead
   round still resolves by kickoff, not by window.

4. **Integration coverage.** In `nfl-sync-schedule.test.ts`: reframe the TBD-teams test per
   above; confirm (add if absent) an assertion that a sync whose provider omits a game one week
   and returns it the next creates the row on the later sync (the seeding transition is the
   existing upsert path); confirm (add if absent) that a Pick'em league whose start week has no
   games is pre-start — joinable, settings editable, Postseason preset startable
   (`start_week_passed` not triggered). Note for the worker (red-team A7): AC2's "sync serves an
   unseeded round → no rows" is proved **compositionally** — the integration suite injects a
   fake `GameDataProvider`, so the ESPN exclusion is exercised only at the unit layer, and the
   integration layer proves that a sync over a provider omitting the games creates nothing. Do
   not try to route ESPN HTTP fixtures through the integration suite.
5. **Cleanup migration.** Custom SQL migration (`drizzle-kit generate --custom`, following the
   `0010_partial-unique-abbreviation-teams.sql` naming precedent): in one transaction, (a) guard
   — raise if any `pickem_picks` row references a game whose home or away team matches the
   placeholder predicate, so member picks are never destroyed silently and a failed deploy
   surfaces the situation to the owner; (b) delete matching `games`; (c) delete the
   now-unreferenced placeholder `teams` rows. Predicate mirrors the adapter's, sport-scoped and
   case-insensitive (red-team A5):
   `sport = 'nfl' AND (provider_team_id LIKE '-%' OR upper(abbreviation) = 'TBD')`.
   Comment cites ADR-0021. Idempotent by construction (second run matches nothing) — but note
   drizzle never re-runs an applied migration, which is why the human gate below covers the
   deploy race. The `pickem_picks.game_id` RESTRICT FK is the hard backstop; the guard exists to
   fail with a clear message rather than a bare constraint error.
6. **Gates + evidence + PR** per the verification map; PR via
   `gh pr create --base staging --head <feature-branch>`.

Dependencies between steps: 2 → 4 (test reframing references the new contract); 1 is
independent but first so code comments can cite ADR-0021 and the ADR-0020 amendment; 3 is
independent of 2 in code but is what makes 2 shippable, so neither merges without the other;
5 independent of 2/3/4; 6 last.

### Acceptance criteria

- **AC1** — `EspnProvider.fetchNflWeekGames` never returns a game with an undetermined
  competitor (predicate cases above), and returns seeded games of the same week unchanged.
- **AC2** — After a sync in which ESPN serves a playoff round unseeded, no `games` or `teams`
  rows exist for the unseeded events; after a later sync in which the same `providerGameId`
  arrives seeded, the game row exists with real team FKs and normal locking/pickability.
- **AC3** — A Pick'em league whose start week has no ingested games is pre-start: joins open,
  settings editable, preset startable — no `start_week_passed` refusal for a future round that
  is merely unseeded.
- **AC4** — At an instant where the current postseason round has kicked off and the next is
  unseeded, `resolvePickemSeasonRange` advances the Postseason and Full Season presets to the
  unseeded round and `startablePickemSeasonRangePresets` reports both startable; a league created
  there is pre-start and adopts the round's real first kickoff once seeded. At the same instant
  Regular Season resolves to nominal and is not startable, and after the Super Bowl no preset is.
- **AC5** — The migration removes all previously ingested placeholder games and teams rows;
  with a pick referencing a placeholder game, it raises and applies nothing.
- **AC6** — ADR-0021 exists, records the boundary decision, its alternatives, and the resolver
  fallback that keeps league creation working; ADR-0010 and ADR-0020 carry amendment pointers.

### Verification map (run surface: local only)

Before capturing any evidence, **clear `docs/evidence/test-results`** (it currently holds LG-11
directories; the root intentionally contains only the latest work package's evidence — red-team
A6, `docs/agents/testing.md`).

| Criterion | Surface / command | Real deps | Expected | Evidence (committed) | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|---|
| AC1 | unit: `pnpm vitest run --project unit packages/core/src/espn-provider.test.ts` | none | all placeholder cases excluded, seeded pass through | `docs/evidence/test-results/espn-provider-unit/output.txt` | end of step 2 | edits to `espn-provider.ts`, its fixtures, or `game-data-provider.ts` |
| AC2, AC3 | integration: `pnpm db:up && pnpm test:integration` | Docker Postgres :5433 (`picksleagues_test`, auto-created/migrated) | suite green incl. reframed TBD test, seeding-transition, pre-start assertions | `docs/evidence/test-results/integration/output.txt` | end of step 4 | any api service, db schema/migration, or test change |
| AC4 | integration: same command, cases in `league-season-range.test.ts` + `pickem-season-range-presets.test.ts` (fixtures set the simulated clock and the seeded/unseeded week shape; no ESPN involved) | same | Postseason + Full Season advance and are startable; Regular Season unchanged | same file | end of step 3 | edits to `season-range.ts`, `start.ts`, or `PICKEM_NOMINAL_RANGE` |
| AC5 | manual, local dev db: seed placeholder teams+games via psql; `pnpm db:migrate`; assert rows deleted. Re-seed with a referencing `pickem_picks` row; re-apply; assert raise + no deletion | Docker Postgres :5433 (dev db — **ask before wiping**; use throwaway rows only) | first run deletes exactly the placeholder rows; guarded run raises | `docs/evidence/test-results/migration-cleanup/transcript.txt` (sanitized: no DATABASE_URL) | end of step 5 | any edit to the migration SQL |
| AC6 | static: files exist, citations greppable (`grep -l "ADR-0021" docs/adr/`) | none | ADR + both pointers present | PR diff | end of step 1 | ADR edits |
| DoD | `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check` | none | green | `docs/evidence/test-results/gates/output.txt` | step 6 | any edit |
| DoD | `pnpm contract:check` | none | **no diff** — this change adds no schema/route; a dirty `openapi/` here is a scope violation, not a regeneration chore | same | step 6 | schema/route edits (none planned) |
| DoD | `pnpm test:e2e` (merge gate; brings up its own stack/db/ports) | Docker Postgres server | green, no new specs | `docs/evidence/test-results/e2e/output.txt` | step 6 | any edit |

Fixtures: AC1 needs a canned ESPN scoreboard fixture with `-1`/`-2` competitors (modeled on the
ticket's verified description; none exists in `espn-provider.test.ts` today) — checked in with
the test. AC4 needs no new fixture kind: the integration suite already builds seasons, weeks, and
games directly and drives a simulated clock. AC5's seeded junk rows are created and torn down
inside the transcript itself; the dev database is otherwise untouched (repo guardrail: ask before
wiping dev — this plan never wipes).

Candidate evidence from planning: none executed — planning was static reading. The repo facts
cited above (NOT NULL team FKs, inner-join null semantics, `requiredPickemPickCount`, sync-role
split) were verified by direct file reads on `staging` @ `7e82de6`, and are invalidated by any
change to the named files before implementation. The revision's load-bearing fact — `weeks`
carries `NOT NULL` `starts_at`/`ends_at` (`packages/db/src/schema/sports.ts:104-105`) populated
from the ESPN season *structure* independently of games
(`apps/api/src/services/nfl/ingest-season.ts:288-340`), so all four postseason rounds have real
windows long before seeding — was verified the same way.

### Human gate (merge/deploy)

Migrations apply to staging/prod via GitHub Actions on merge (ADR-0003), so the cleanup runs
against real data at deploy time.

- **Prerequisite:** PR approved, gates green.
- **Human action:** before merging, run against staging and prod (read-only):
  `SELECT count(*) FROM pickem_picks p JOIN games g ON p.game_id = g.id JOIN teams t ON t.id IN (g.home_team_id, g.away_team_id) WHERE t.provider_team_id LIKE '-%' OR upper(t.abbreviation) = 'TBD';`
- **Expected:** 0. If nonzero, stop — the migration will (correctly) fail the deploy; owner
  decides the remedy for those picks first.
- **Post-check (staging, then again on prod after the `main` deploy — red-team A1):** the
  migration applied green and
  `SELECT count(*) FROM teams WHERE provider_team_id LIKE '-%' OR upper(abbreviation) = 'TBD'`
  returns 0. The prod re-check matters because `migrate.yml` and the Vercel deploy race
  independently: if the daily 6am ET `nfl-sync-schedule` tick lands between the migration and
  the new adapter serving, the old code re-ingests placeholders and no migration ever removes
  them again. **Remediation if nonzero:** re-run the cleanup SQL manually against that
  environment (same statements, same guard).

### Repository-specific considerations (docs/agents/planning.md)

- *Locked docs:* spec §Game Mode 1 says "all of the week's games are eligible" — an unseeded
  event is resolved as **not yet a game**, so this is a gap-fill recorded by ADR (the
  configured escalation vehicle), not a deviation; the owner's delegation in the invocation, plus
  the explicit rejection of the creation-window trade-off on review, are the human decisions.
  ADR-0007 already anticipated this: "how playoff weeks interact with each game mode's rules is a
  separate product decision the mode epics must settle."
- *ADR-0020:* step 3 changes its mid-week resolution rule (a games-less week in range is now
  selectable). Recorded as an amendment pointer from ADR-0020 into ADR-0021 rather than a second
  ADR — one decision, one record.
- *Clock:* no new "now" reads anywhere in the change.
- *Migration policy:* forward-only data migration; rollback is re-running `sync-schedule` after
  reverting the adapter (rows recreate); stored-row compatibility n/a (no shape change).
- *Jobs:* `sync-schedule` stays idempotent — skipping is stateless; re-runs converge.
- *Scoring/settlement:* untouched.
