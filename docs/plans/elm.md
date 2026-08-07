# [EXECUTION PLAN] — ELM epic

_Work package: the **ELM** epic (`backlog/06-survivor.md`, 6 tickets —
ELM-6 appended 2026-08-07 with owner approval, decision 6). The ticket list
in that file, plus its three owner-decision headers (playoffs:
regular-season only, recorded in ADR-0007; season range: preset resolution
reaches the mode with **Regular Season as the only preset**, owner
2026-08-02 via SIMP-17; mode name: **Survivor**, owner 2026-08-07,
decision 10), is the stable contract; this file is the technical
plan and never amends it._

_Recorded by `/atlas-plan`, 2026-08-07. Status: **owner-ruled at plan review
the same day** — every flagged decision is resolved (see §Decisions);
invoking `/atlas-implement ELM` is the remaining approval-to-execute.
Red-team review: **required** by the risk-gated policy in
`docs/agents/planning.md` — this epic adds a `packages/scoring` module, pick
locking, pick-visibility filtering, settlement/recompute, and database
migrations. The review record is at the end of this file. Run surface: **local
only**. Verification commands and evidence policy: `docs/agents/testing.md`;
evidence root `docs/evidence/test-results/`, one directory per PR
(`elm-1/` … `elm-6/`), never cleared. No plan-phase candidate evidence exists —
no verification command was run while planning._

### Intent

Ship the second game mode on the settlement core Pick'em proved (backlog
README: "ELM and MM integrate with it rather than rebuilding it"). The mode's
rules live in spec §Game Mode 2; the table shapes in arch §Domain Model as
amended by ADR-0016; pick-entry semantics deliberately differ from Pick'em
(changeable until kickoff — spec §Core User Flows 4 — versus ADR-0018's one
immutable submission). This plan's added value: (a) a survey (2026-08-07) of
what already exists — Elimination's settings schema, create/edit forms, mode
label, `leagueStartAt` derivation, and the `all-eliminated` sim scenario are
**already shipped**, so ELM-1 is a wire-shape rework, not a green-field build;
(b) resolved technical decisions for the two places the spec's rules are in
tension (team-ledger DB constraint vs. cancellation returning the team;
week-complete settlement vs. Pick'em's per-game-final path); (c) a
criterion-level verification map per ticket.

### Decisions flagged for the owner

None change the contract; each is either a recording of an already-made owner
decision or a technical allocation the PR review rules on.

_Owner ruled on every flag at plan review, 2026-08-07: decisions 1–9 stand as
written (the sticky-release and verbatim-renewal defaults confirmed), ELM-6
is approved and appended to the epic, and the mode is renamed **Survivor**
(decision 10, new). The sections below are revised to match — artifacts this
plan creates are named `survivor*`; shipped code keeps its `elimination*`
names in the current-state facts and is renamed by ELM-1._

1. **ELM-1 carries an ADR + spec amendment.** Spec §Game Mode 2 League
   Settings still lists Start Week / End Week; the owner decided (2026-08-02,
   epic header; anticipated by ADR-0020 §Scope) that at this build-out the
   range leaves the form and only a resolved Regular Season range is stored.
   Shipping ELM-1 without amending the locked spec would leave code deviating
   from it, so ELM-1 records a short ADR (via `/adr`, **written at the start
   of implementation, before code** — planning policy letter) capturing the
   already-made decision, plus the matching spec §Game Mode 2 text update in
   the same PR. This is recording, not deciding; the owner pre-confirmed the
   approach at plan review (2026-08-07) and the PR review confirms the text.
2. **Pick-entry UI ("My Picks") is allocated to ELM-2**, alongside the pick
   endpoint. No ticket names the pick-entry screen (spec §Screens requires
   it, and ELM-5's journey cannot run without it); ELM-2 is where it costs
   least — it needs no settlement, and ELM-4 already carries the board UI.
3. **`survivor_pick_results` exists and lands with ELM-4.** ELM-2's ticket
   names the picks + state tables only, but the survivor
   board's pick history needs per-pick outcomes, and the engineering rules
   name the per-mode triple. It ships in ELM-4's migration, beside the
   settlement that writes it.
4. **Team-consumption constraint shape** (the one genuinely contestable
   technical call — see §ELM-2): a partial unique index over a
   settlement-maintained `released` flag, reconciling "unique team per member
   per league as a DB constraint" (ELM-2) with "cancelled game: the team is
   not consumed" (spec §Game Mode 2). **Release is sticky once relied upon**
   (red-team finding 2): recompute clears `released` only while no later
   `NOT released` pick by the same member on the same team exists. Without
   this rule, reverting a cancellation *after* the member legally re-picked
   the returned team would make recompute recreate two live ledger rows,
   abort on the unique index, and leave the league-season permanently
   unsettleable — the exact failure class ADR-0015 §3 refused for Pick'em.
   With it, settlement always completes; the reverted game's pick still
   grades normally for survival, and the team having effectively been used
   twice is the audited consequence of the operator's flip-flop
   (`admin_audit`), not a member action. **Owner confirmed sticky-release
   (2026-08-07).** Refusing the override was considered and rejected: games
   are shared across leagues, so one member's re-pick in one league would
   block correcting shared game data for every league, and a truly-played
   game would be left with no legal correction path.
5. **Consumption semantics stated once:** a pick on a game that was **played**
   consumes the team — correct, incorrect, push, and eliminated-by-it picks
   alike (spec: "a member may pick each NFL team at most once per league";
   the ADVANCE push resolution says "advances and the team is consumed").
   Only a **cancelled** game returns the team. Revival restores the life
   only; teams consumed by the busting picks stay consumed.
6. **Dashboard pick-status glance is out of ELM-4's scope — it is ELM-6.**
   Spec §Screens wants "picks in / picks needed / locked" at a glance; no
   original ELM ticket named the dashboard. **Owner approved (2026-08-07):**
   ELM-6 appended to the epic (deps: ELM-4) rather than silently widening
   ELM-4. Deliberately thin — the ticket line + spec §Screens is the
   contract; see §ELM-6.
7. **Renewal copies Survivor settings verbatim — including the resolved
   range** (red-team finding 3 corrected an earlier false claim here:
   `renewLeagueSeason` copies settings verbatim for every mode, by recorded
   decision — ADR-0009, `apps/api/src/services/leagues/renew.ts` comment —
   and no Pick'em re-resolution at renewal exists to mirror). Consequence
   worth the owner's eyes: a league created mid-season (stored start = reg
   week 5) renews into next season still carrying reg week 5, and
   post-ELM-1 the form has no range control — but **any** pre-start settings
   save re-resolves the range server-side, which is the existing remedy
   Pick'em relies on too. Plan default: no `renew.ts` change, one
   verification row proving a post-renewal settings save re-resolves.
   **Owner confirmed the default (2026-08-07)** — renewal keeps ADR-0009's
   verbatim copy.
8. **Eliminated members cannot submit picks, judged on *settled* state.**
   The spec grants eliminated members full *visibility* only (§Game Mode 2);
   entry is unstated (red-team finding 4). Rule: the pick endpoint refuses a
   member whose settled `survivor_state` says eliminated (new
   `member_eliminated` wire code); between busting and their week settling,
   the state still reads alive and picks are **accepted** — deliberately,
   because settlement is the moment of truth (spec: "resolved at settlement
   after the week completes") and this lag is what keeps the revival rule
   honest: members keep picking until settlement declares the week, and if
   everyone busts, the revived members' next-week picks were legitimately
   made. A pick landed in the lag window by a member whose elimination then
   settles grades to nothing (ELM-3's no-zombie-grading case) and consumes
   nothing. UI: an eliminated member's My Picks week shows their eliminated
   status instead of a pick sheet.
9. **A second ADR at ELM-2 records the persistence + settlement design and
   amends arch §Domain Model** (red-team finding 6): the `released` ledger
   (decision 4), `survivor_state`'s concrete shape
   (`eliminated_week_id`/`revived_count` vs. the arch sketch's
   "`eliminated_at`, revived flags"), `survivor_pick_results`, the
   eliminated-member entry rule (decision 8), and ELM-4's prefix-ordered
   settlement invariant. These constrain work beyond the files they land in
   — ADR-shaped per the decision ladder — and the arch Domain Model lines
   they refine are amended in the same PR that ships the tables, keeping the
   locked doc reconciled.
10. **The mode is named Survivor, not Elimination** (owner decision,
    2026-08-07, made at plan review): "survivor pool" is the industry term;
    ESPN's "Eliminator" and the UK's "Last Man Standing" are minority
    synonyms, and the legacy "suicide pool" name is deliberately avoided.
    This deviates from the locked spec/arch wording ("NFL Elimination"), so
    ELM-1 records it in its **own short ADR** — separate from the range ADR;
    two decisions, two records — and sweeps the name in the same PR: spec
    §Game Mode 2, arch (mode lists + §Domain Model table names), `backlog/`
    (epic file → `06-survivor.md`, README §Epics/§Build order, epic title
    and ticket wording — **ELM IDs are stable forever and do not change**),
    `.claude/rules/engineering.md`'s passing mentions, `LEAGUE_MODE`
    (`"elimination"` → `"survivor"`, key `SURVIVOR`) with a one-statement
    data migration rewriting stored `leagues.mode` (the column is plain
    `text` — no enum to alter), and the shipped schema/const/form/copy
    names (`SurvivorSettingsSchema`, `SURVIVOR_PUSH_TIE_RESOLUTION`,
    `SurvivorSettingsFields`, …). **Member-state vocabulary is unchanged**:
    "alive", "eliminated", "revived" are standard survivor-pool terms, so
    the `member_eliminated` wire code, `eliminated_week_id`, the
    `all-eliminated` sim scenario slug, and the ELM-3 rule matrix keep
    their names.

### Load-bearing repository facts (surveyed 2026-08-07)

Already shipped — do not rebuild:

- `LEAGUE_MODE.ELIMINATION`, `ELIMINATION_PUSH_TIE_RESOLUTION`
  (`{ADVANCE, ELIMINATE}`, default ADVANCE), and `EliminationSettingsSchema`
  (`startWeek`/`endWeek` as `nflRegularWeekRef`, `pickType`,
  `pushTieResolution`) all exist in
  `packages/schemas/src/league-settings.ts`; both
  `LEAGUE_SETTINGS_SCHEMAS` and `LEAGUE_SETTINGS_INPUT_SCHEMAS` already map
  Elimination (currently to the same schema — no separate input shape yet).
- `CreateLeagueRequestSchema` has a full Elimination union member
  (`packages/schemas/src/leagues.ts`); create form
  (`apps/web/src/routes/_authed/leagues/new.tsx`) and settings editor
  (`apps/web/src/components/league/settings-section.tsx`) render
  `EliminationSettingsFields`
  (`apps/web/src/components/league-settings-fields.tsx`) **including the
  Start/End Week dropdowns ELM-1 removes**.
- `leagueStartAt` (`apps/api/src/services/leagues/start.ts`) already derives
  Elimination's start/join-cutoff from `settings.startWeek` generically —
  zero changes needed.
- `listLeagueWeeks` (`apps/api/src/services/league-weeks.ts:43`) refuses
  non-Pick'em modes with `wrong_league_mode`; its comment names ELM as the
  widen point. `GET /weeks/{weekId}/games` is already mode-agnostic
  (`apps/api/src/routes/weeks.ts`).
- Settlement orchestration (`apps/api/src/services/pickem/settlement.ts`)
  filters to Pick'em in `loadSettleableSeason` with a comment naming ELM-4;
  entry points `settlePicksForGames`, `settleSweep`, `rebuildLeagueSeason`,
  and `POST /jobs/settle-sweep` (`apps/api/src/routes/jobs.ts:121`) are where
  Elimination dispatch hooks in.
- `packages/scoring/src/standings.ts` (`aggregateStandings`/`rankStandings`)
  is deliberately mode-agnostic but **Elimination does not rank** — the board
  is a survivor ledger (ADR-0016); the shared core is not needed here.
  Grading helpers in `packages/scoring/src/pickem.ts` (`pickMargin`, line
  172) are reusable for SU/ATS grading.
- `isUniqueViolation(error, constraint)` — `packages/db/src/errors.ts`.
  Migrations via `pnpm --filter @picksleagues/db generate` (drizzle-kit),
  `packages/db/migrations/0000…0020` exist; none touch elimination. **No
  `elimination.ts` exists in `packages/db/src/schema/`, `packages/scoring/src`,
  `apps/api/src/routes`, `apps/api/src/services`, or `apps/web/src/api`.**
- Sim scenario `all-eliminated`
  (`apps/api/src/services/sim/scenarios/all-eliminated.ts`, slug
  `"all-eliminated"`, four games where every favorite loses) exists for
  ELM-5's revival week; game-data fixture only.
- E2E pattern to mirror: `e2e/pickem-journey.sim.spec.ts` — `*.sim.spec.ts`
  naming, `test.describe.serial`, drives `/api/sim/reset`,
  `/api/sim/scenarios/{slug}/load`, `/api/sim/clock`, `/api/sim/settle`;
  binds to `data-testid`/roles, never copy. Seed helpers in
  `e2e/setup/league-seed.ts` are mode-agnostic.
- Existing tests that reference Elimination (update, don't duplicate):
  `packages/schemas/src/league-settings.test.ts`,
  `apps/api/test/{leagues,league-weeks,pickem-picks,pickem-season-range-presets,pickem-standings}.test.ts`.

### Delivery strategy — six PRs, one ticket each

Order: **ELM-1 → (ELM-2 ∥ ELM-3) → ELM-4 → (ELM-5 ∥ ELM-6)**, branches off
`staging`, PRs to `staging` (`gh pr create --base staging --head <branch>`).
ELM-3 is pure `packages/scoring` + `packages/schemas` types and only needs
ELM-1's settings shape conceptually (it reads the settings schema ELM-1
renames to `SurvivorSettingsSchema` — already shipped), so it can run in a
parallel worktree beside ELM-2 — they are diff-disjoint (scoring/ vs
db+api+web). ELM-4 integrates both. ELM-6 (dashboard glance, web-only) and
ELM-5 (one e2e spec) are diff-disjoint and may also run in parallel.
Evidence per PR under `docs/evidence/test-results/elm-<n>/`; text committed,
images to the PR. Every PR:
`pnpm format && pnpm lint && pnpm typecheck && pnpm test`;
`pnpm contract:check` on any schema/route change (ELM-1, -2, -4);
`pnpm test:integration` on any API/DB change (ELM-1, -2, -4);
`pnpm --filter @picksleagues/web build` on any web change
(ELM-1, -2, -4, -5, -6);
`pnpm test:e2e` before every PR (merge gate; needs `pnpm db:up`).

---

### ELM-1 — Survivor rename + settings wire shape + form rework, resolved range stored

**Scope:** `packages/schemas/src/league-mode.ts`,
`packages/schemas/src/league-settings.ts` (+ its test),
`apps/api/src/services/leagues/season-range.ts` (where
`resolveLeagueSettings` actually lives; `crud.ts` only calls it),
`apps/web/src/components/league-settings-fields.tsx`,
`apps/web/src/routes/_authed/leagues/new.tsx`,
`apps/web/src/components/league/settings-section.tsx`, every other file the
rename grep turns up (mode labels, test literals), a data migration in
`packages/db/migrations` rewriting `leagues.mode`, `openapi/` regen, **two
ADRs** + `docs/mvp-spec.md` §Game Mode 2 + `docs/architecture.md` +
`backlog/` sweep (decisions 1 and 10 above), `apps/api/test/leagues.test.ts`.
**Excluded:** any pick surface; any change to Pick'em's preset machinery;
the settings JSONB *shape* (unchanged — resolved refs stay, so the only data
migration is decision 10's one-statement `leagues.mode` rewrite, and
existing dev leagues keep parsing).

**Steps:**

1. **Survivor rename (decision 10), ADRs first:** both ADRs (decisions 1 +
   10) via `/adr` before code; then `LEAGUE_MODE.SURVIVOR = "survivor"`,
   rename the shipped Elimination schemas/consts/fields/copy
   (`SurvivorSettingsSchema`, `SURVIVOR_PUSH_TIE_RESOLUTION`,
   `SurvivorSettingsFields`, …) and the tests pinning the mode set;
   generate the data migration rewriting stored `leagues.mode`; sweep
   spec §Game Mode 2, arch, `backlog/` (epic file → `06-survivor.md` +
   README §Epics/§Build order; **IDs unchanged**), and engineering.md
   wording.
2. Add `SurvivorSettingsInputSchema` = `{ pickType, pushTieResolution }`
   (no range — Survivor's one preset is implicit, so unlike Pick'em the
   wire carries no preset field either), registered as its own OpenAPI
   component; point `LEAGUE_SETTINGS_INPUT_SCHEMAS[SURVIVOR]` and the
   `CreateLeagueRequestSchema` Survivor member at it. Stored schema
   untouched.
3. In `resolveLeagueSettings` (`season-range.ts`), add the Survivor
   branch mirroring ADR-0020's mid-week rule with a fixed Regular Season
   nominal range: `startWeek` = later of (regular week 1, next
   regular-season week whose first **effective** kickoff —
   `min(coalesce(override_kickoff_at, kickoff_at))` — is after
   `clock.now()`); `endWeek` = regular week 18; no-games fallback → regular
   week 1. Reuse the Pick'em resolution helper rather than restating it —
   including its range-exhausted behavior: a season with games but **no
   future regular-season kickoff left** (created during the playoffs or
   later) resolves to nominal and is then refused by `createLeague`'s
   `start_week_passed` 409, which is the load-bearing half of "never born
   already-started" at that edge. Re-resolution runs on every pre-start
   settings write; **renewal copies verbatim and does not re-resolve**
   (decision 7 — ADR-0009).
4. Web: `SurvivorSettingsFields` drops the two week dropdowns (and the
   now-unused start/end-week defaults); create form and settings
   editor assemble `{ pickType, pushTieResolution }` only. Display the stored
   resolved range read-only where Pick'em shows its range today.
5. Regenerate `openapi/` (`pnpm contract:check` clean).

**Verification map:**

| Criterion (source) | Check / command | Expected | Evidence | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|
| Rename complete (decision 10): stored leagues parse as `"survivor"`; no stale mode-name references | integration (leagues.test.ts) + `git grep -iw elimination` | data migration rewrites rows; grep hits only historical records (ADRs, plans, evidence) and member-state vocabulary | `elm-1/rename/` | after step 1 | any rename edit |
| Input schema rejects a range; stored schema still parses refs (epic: "stored, not chosen") | unit: `pnpm test` (league-settings.test.ts cases) | input with `startWeek` rejected; stored round-trips | `elm-1/schemas-unit/` | after step 2 | any schema edit |
| Mid-week resolution: create in sim-advanced clock → startWeek = next future-kickoff week; end = reg 18 (ADR-0020 rule) | integration: `pnpm test:integration` (leagues.test.ts) | stored settings carry resolved refs | `elm-1/leagues-integration/` | after step 3 | crud/renew edits |
| No-games fallback → reg week 1 (ADR-0020) | integration, provisional-season case | startWeek = reg 1 | same | after step 3 | same |
| League never born already-started (spec §Membership) | integration: create after week 1 kickoff → `leagueStartAt` in future | join still allowed pre-start | same | after step 3 | same |
| Range exhausted → refused (ADR-0020 edge) | integration: create with clock past reg week 18 | 409 `start_week_passed` | same | after step 3 | same |
| Renewal copies verbatim; a post-renewal pre-start settings save re-resolves (decision 7) | integration (renewal.test.ts + leagues.test.ts) | copied refs unchanged at renew; refreshed after save | same | after step 3 | renew/season-range edits |
| Form ships one fewer setting (epic header) | phone-width screenshot of create + settings editor | no week dropdowns; pickType + pushTie only | PR images | after step 4 | form edits |
| Contract in sync | `pnpm contract:check` | clean | `elm-1/contract/` | after step 5 | any schema/route edit |
| Spec/ADR reconciled (planning policy) | both ADR files + spec/arch/backlog diff in PR | owner approves at PR review | PR diff | PR open | — |

**Human gate:** owner confirms both ADR texts record their decisions
faithfully — the 2026-08-02 range decision and the 2026-08-07 Survivor
rename (prerequisite: ELM-1 PR open; action: review ADRs + spec/arch/backlog
diff; expected: approval or corrections; post-check: PR merged with ADRs
included).

---

### ELM-2 — survivor_picks + survivor_state schema, pick endpoint, pick-entry UI

**Scope:** new `packages/db/src/schema/survivor.ts` + barrel export +
generated migration; `packages/schemas/src/survivor.ts` (new DTO module) +
`ERROR_CODE` additions + barrel; new `apps/api/src/routes/survivor.ts` +
`apps/api/src/services/survivor/picks.ts` + app.ts mount;
`listLeagueWeeks` gate widened; settings-reset analog for Survivor
(ADR-0015 rule 3); new `apps/web/src/api/survivor.ts` + pick-entry
components + league route wiring; `openapi/` regen; integration tests; the
persistence/settlement-design ADR + arch §Domain Model amendment
(decision 9). **Excluded:** settlement, results table, board UI (ELM-3/4);
any Pick'em behavior change beyond the `league-weeks` gate.

**Schema (decision 4):**

- `survivor_picks`: `id, league_season_id (cascade), league_member_id,
  week_id (restrict — a pick must block week deletion, same reasoning as
  ADR-0015's convergence-sweep note), game_id, team_id, spread_at_pick
  (nullable), released (boolean not null default false), created_at,
  updated_at`.
  - Unique `survivor_picks_member_week_unique
    (league_season_id, league_member_id, week_id)` — one pick per week
    (spec §Core Rules), upsert target.
  - **Partial unique index** `survivor_picks_member_team_unique
    (league_season_id, league_member_id, team_id) WHERE NOT released` — the
    team ledger (epic: "as a DB constraint"; ADR-0009 scopes it to the
    instance). `released` is written **only by settlement**, set true when
    the pick's resolved game status is `cancelled` (spec: team not
    consumed), and re-derived by full recompute under the **sticky-release
    rule** (decision 4): recompute clears it only while no later
    `NOT released` pick by the same member on the same team exists, so a
    reverted cancellation can never make recompute collide with the index
    and abort settlement. A plain unique would wrongly block the legitimate
    re-pick of a team a cancellation returned; app-level checks alone would
    violate the ticket.
- `survivor_state`: `id, league_season_id, league_member_id` (unique
  pair), `lives_remaining int not null default 1` (arch deferred-feature
  note), `eliminated_week_id (nullable FK), revived_count int not null
  default 0, updated_at`. Settlement-maintained ledger (ADR-0016), fully
  recomputable; rows minted at settlement, absence = alive with 1 life.

**Endpoint semantics** (`PUT /leagues/{leagueId}/survivor/weeks/{weekId}/pick`
— arch §API sketch, path carrying the renamed mode per decision 10; plus
`GET …/weeks/{weekId}/picks`):

- Upsert inside one transaction (spec: changeable until kickoff): member of a
  Survivor league; member not eliminated per **settled**
  `survivor_state` → else 409 with new `ERROR_CODE.MEMBER_ELIMINATED`
  (decision 8 — lag-window picks are accepted by design); week inside the
  stored resolved range and regular
  season; game belongs to week and is not cancelled (`game_not_pickable`);
  picked team plays in that game; **new** game's effective kickoff
  `> clock.now()` else 409, and if an existing pick's game has kicked off the
  pick is locked → 409 (`pick_locked`) — both re-validated in-transaction
  (arch D11); team not already consumed: another-week pick by this member on
  this team with `NOT released` → 409 (new `ERROR_CODE.TEAM_CONSUMED`);
  ATS leagues: request carries the spread the member saw; mismatch with the
  game's current resolved spread → 409 (reuse Pick'em's spread-staleness
  code); SU leagues carry none. DB constraints are the second line via
  `isUniqueViolation`.
- Refusal handling per the engineering rule: the service names reasons in a
  const set; whether that set aliases `ERROR_CODE` directly or earns a
  `lib/survivor-refusals.ts` mapping module is settled by whether the
  reasons diverge from the wire codes once written — mirror
  `admin-overrides.ts` (direct) unless divergence appears, then mirror
  `lib/pickem-refusals.ts`.
- GET returns own pick always; other members' picks only where the game has
  kicked off (query layer — arch §Locking Model), plus a per-member
  has-picked indicator (content hidden, existence visible — ADR-0015 rule 4
  precedent), plus the requesting member's `consumedTeamIds` (derived:
  their picks with `NOT released`; own data, no leak).
- Widen `listLeagueWeeks` to accept Survivor (its comment's named widen
  point); update `apps/api/test/league-weeks.test.ts`.
- Settings-reset analog (ADR-0015 rule 3, the settings-section comment names
  ELM-2): a pre-start `pickType` change with existing Survivor picks
  clears them in the settings transaction, refused with 409 if any pick has
  locked; `pushTieResolution` (settlement-read) clears nothing; the editor
  warns via a `survivorSettingsInvalidatePicks` predicate in
  `packages/schemas` + a pick-count source, mirroring
  `pickemSettingsInvalidatePicks` + pick-summary.

**Pick-entry UI (decision 2):** `apps/web/src/api/survivor.ts` (query
keys + hooks + wire-slug→toast copy, per the SPA-bindings rule); a
Survivor "My Picks" week view reusing `league-week-picker`, the week slate
from `GET /weeks/{id}/games`, one-team-per-week selection with consumed teams
visibly disabled, current pick changeable until kickoff (no irreversible
confirmation — that is Pick'em's semantic, ADR-0018), ATS spread shown and
accepted at save, an eliminated member's week showing their status instead
of a pick sheet (decision 8), `QueryState` + skeletons, mutation failures
toast, mobile-first, `useAppNow()` for any now-relative label.

**Verification map:**

| Criterion (source) | Check / command | Expected | Evidence | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|
| Migration applies clean | `pnpm db:migrate` on fresh test DB (integration globalSetup) | tables + both uniques exist | `elm-2/migrate/` | after schema step | schema edits |
| One pick per week; upsert replaces (spec) | `pnpm test:integration` (survivor-picks.test.ts) | second PUT same week replaces, different team | `elm-2/picks-integration/` | endpoint done | service/schema edits |
| Lock re-validated in transaction (arch D11) | integration: sim clock past kickoff → PUT | 409 `pick_locked`; pick unchanged | same | endpoint done | same |
| Change blocked once picked game kicked off (spec §Core Rules) | integration | 409; original pick stands | same | endpoint done | same |
| Team consumption enforced (epic: DB constraint) | integration: same team, later week → 409; direct concurrent INSERT race | app 409 + `isUniqueViolation` path both covered | same | endpoint done | same |
| Cancelled-released team re-pickable (spec §Cancellations) | integration with `released=true` seeded (full path proven in ELM-4) | insert succeeds | same | endpoint done | constraint/flag edits |
| Eliminated member refused; lag-window pick accepted (decision 8) | integration: seeded eliminated state → 409; no state row → accepted | `member_eliminated` only once settled | same | endpoint done | service edits |
| Visibility filtered in query layer (spec §Pick Visibility) | integration: other member pre/post kickoff | pick hidden then revealed; has-picked visible | same | GET done | serializer edits |
| ATS spread staleness → 409; SU has no spread field | integration | 409 on stale; SU accepts | same | endpoint done | same |
| Settings reset analog (ADR-0015 r3) | integration: pre-start pickType flip with picks | picks cleared in-tx; refused if locked | same | reset step | settings-reset edits |
| `listLeagueWeeks` widened | integration (league-weeks.test.ts) | Survivor league gets weeks | same | gate step | gate edits |
| Contract in sync | `pnpm contract:check` | clean | `elm-2/contract/` | routes done | schema/route edits |
| Pick-entry works against real stack | driven simulator transcript (verification-runbook): create league, pick, advance clock, pick change refused | transcript shows 200s/409s | `elm-2/sim-transcript/` + PR phone-width screenshots | UI done | any elm-2 edit |

---

### ELM-3 — `settleSurvivorWeek` pure function

**Scope:** new `packages/scoring/src/survivor.ts` + `survivor.test.ts`
+ barrel export; a targeted extraction of shared SU/ATS grading from
`packages/scoring/src/pickem.ts` (`pickMargin` already exported) if reuse
beats restating — extraction, not a layer. **Excluded:** any I/O, any import
from `db`/`core` (package invariant), any orchestration.

**Signature (arch §Settlement & Scoring):**
`settleSurvivorWeek(state, picks, results, settings) → SurvivorWeekSettlement`
— plain data in/out: entering state (alive members, lives, consumed teams),
the week's picks, the week's game results (resolved `override_* ?? provider_*`
upstream by the loader — this function never sees provider fields), settings
(`pickType`, `pushTieResolution`). Output per member: pick outcome
(`PICK_OUTCOME` — shared set, ADR-0016), survival transition
(advanced / eliminated / revived), `teamConsumed`, plus an `unsettled` list
mirroring `settlePickemWeek`'s idiom for non-terminal games. The caller
gates on week completeness (see ELM-4) — missed-pick elimination and revival
are week-total facts, so the function grades only complete weeks and reports
anything non-terminal as unsettled.

**Rule matrix — table-driven, one case per spec rule (spec §Game Mode 2 +
epic ELM-3 line; the spec is the test plan):**

| Spec rule | Case |
|---|---|
| Correct → advance, team consumed | SU and ATS variants |
| Incorrect → eliminated (team consumed, decision 5) | both pick types |
| Missed pick → eliminated (only members alive entering the week) | with and without other picks |
| ATS push / SU tie, `ADVANCE` → advance **and consume** | default setting |
| ATS push / SU tie, `ELIMINATE` → eliminated | |
| Cancelled game → push, survive, team **not** consumed, regardless of setting | ELIMINATE-setting variant included |
| Entire slate cancelled → every picker pushes and survives with teams returned; a non-picker is still a missed-pick elimination | the collision of two rules, one case |
| "Week-move" is not a distinct case: ADR-0019 removed `moved` from the status set; a real move lands as an admin `cancelled` override and grades by the row above | covers the ticket's "cancellation/week-move as push" wording |
| All alive members eliminated same week → all revived (wrong picks, missed picks, mix) | incl. push-eliminate mix; consumed teams stay consumed |
| Not all eliminated → no revival | boundary |
| Already-eliminated members produce nothing (no zombie grading) | |
| Co-winners at End Week: ≥2 alive after final week's settlement remain alive, no ordering | threading test through a short season |
| Postponed (non-terminal) game → week unsettled | mirrors Pick'em idiom |
| Idempotence: same inputs → same outputs (pure) | derivation property |

**Verification map:** unit only — `pnpm test` (scoring project); every row
above is an `it.each` case; evidence `elm-3/scoring-unit/` (committed vitest
output). The no-I/O import boundary is held by `packages/scoring`'s
dependency manifest (only `@picksleagues/schemas`) and proven by
`pnpm typecheck` failing on any `db`/`core` import, plus review — no lint
rule covers it (red-team finding 7). Invalidated by any edit to
`survivor.ts` or shared grading helpers. Earliest checkpoint: first green
run; no DB, no stack.

---

### ELM-4 — settlement integration + survivor board

**Scope:** `survivor_pick_results` table (decision 3) + migration; new
`apps/api/src/services/survivor/settlement.ts` (+ input loader with
`override_* ?? provider_*` resolution); mode dispatch in
`apps/api/src/services/pickem/settlement.ts`'s entry points
(`settlePicksForGames`, `settleSweep`, `rebuildLeagueSeason` — per its ELM-4
comment and ADR-0016's rebuild note); board endpoint
`GET /leagues/{leagueId}/survivor/standings` + serializer; board UI
(`apps/web`: survivor board components, league detail route's standings
stub replaced for Survivor); `openapi/` regen; integration tests.
**Excluded:** dashboard glance (decision 6); any Pick'em settlement behavior
change (dispatch only).

**Settlement orchestration:**

- Survivor settles **per completed week, prefix-ordered** (red-team
  finding 1 — the load-bearing invariant): a league-season week settles
  only when (a) every game in it is terminal (resolved status final or
  cancelled) **and (b) every in-range prior week is already settled**.
  Missed-pick elimination ("resolved at settlement after the week
  completes", spec) and revival are week-total facts computed against the
  alive-set the *previous* week produced, so the first incomplete week
  blocks everything after it — a later week that finishes while an earlier
  one holds a postponed game writes **nothing** until the chain catches up.
- **A change to an already-settled week's inputs re-settles from that week
  forward.** The incremental path is "replay from the earliest affected
  week", never "settle the affected week alone": an override or provider
  correction that flips a week-3 outcome invalidates every downstream
  alive/eliminated/revived state, and leaving them to the nightly sweep
  would show wrong member-visible survivor state for up to a day.
  `settlePicksForGames(gameIds)` therefore maps games → affected
  league-season weeks and replays each affected season from its earliest
  affected week through the last complete week; `settleSweep` remains the
  nightly full reconciliation; both idempotent (run twice ⇒ identical
  state — jobs rule).
- One transaction per league-season replay: write
  `survivor_pick_results`, upsert `survivor_state`, set/clear
  `released` on cancelled-game picks under the sticky-release rule
  (decision 4). Weeks thread state through `settleSurvivorWeek` in
  order from the stored `startWeek`; full recompute
  (`rebuildLeagueSeason` dispatch) replays the whole range and must
  reproduce identical state (settlement-is-pure-derivation rule).
- `survivor_pick_results`: `id, survivor_pick_id (unique, cascade),
  league_season_id, league_member_id, week_id, outcome, settled_at` — no
  points column (ADR-0016: survive/eliminate has no points).

**Board (spec §Standings View + ELM-4 line):** every member — status
alive/eliminated, week eliminated, revived marker, weekly pick history
revealed **per kickoff** (query layer, same rule as ELM-2's GET), teams
consumed **derived from revealed picks only** (an unrevealed current-week
pick must not leak through the consumed-team list — this is the board's one
subtle visibility vector), co-winners labeled once the end week has settled,
"last updated" timestamp (spec §UI conventions). Eliminated members hit the
same endpoint with identical rights (spec §Pick Visibility). UI: survivor
board as the league home's primary view for Survivor, mobile-first,
role/testid bindings, `QueryState`, no unit tests on presentation policy.

**Verification map:**

| Criterion (source) | Check / command | Expected | Evidence | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|
| Week-completeness gating | `pnpm test:integration` (survivor-settlement.test.ts) | incomplete week: no state written | `elm-4/settlement-integration/` | orchestration done | settlement edits |
| Prefix ordering: later week complete while earlier week incomplete | integration: postponed game in week N, week N+1 final → trigger | week N+1 writes nothing; settles after week N completes | same | orchestration done | same |
| Late correction cascades: override flips a settled week's outcome | integration: settle N..N+2, override week N, re-trigger | weeks N..N+2 replayed; downstream state correct immediately, not next sweep | same | orchestration done | same |
| Reverted cancellation after re-pick never aborts settlement (decision 4) | integration: cancel → settle (released) → re-pick team → clear override → re-settle | replay completes; earlier pick stays released, regrades normally | same | orchestration done | same |
| Settlement idempotency (jobs rule) | integration: settle twice | byte-identical results/state | same | orchestration done | same |
| Full recompute reproduces incremental state (D10) | integration: incremental season then rebuild | identical tables | same | rebuild dispatch done | same |
| Cancelled pick: push + `released=true` + team re-pickable end-to-end (spec §Cancellations) | integration: cancel via override → settle → re-pick | insert succeeds; constraint intact | same | orchestration done | same |
| Revival end-to-end on `all-eliminated` scenario shape | integration | all revived, `revived_count=1`, teams stay consumed | same | orchestration done | same |
| Override precedence (`override_* ?? provider_*`) in loader | integration: overridden score flips outcome | override wins; re-sync can't clobber | same | loader done | loader edits |
| Board reveals per kickoff; consumed list leaks nothing pre-kickoff | integration on serializer | unkicked pick + its team absent for non-owners | same | serializer done | serializer edits |
| Eliminated member retains full visibility (spec) | integration: eliminated caller | identical payload | same | serializer done | same |
| Pick'em settlement untouched | existing `apps/api/test/settlement.test.ts` stays green | no diff in behavior | `elm-4/regression/` | dispatch done | dispatch edits |
| Contract in sync | `pnpm contract:check` | clean | `elm-4/contract/` | routes done | schema/route edits |
| Board renders real settled season | driven-simulator transcript + phone-width screenshots to PR | board matches transcript state | `elm-4/sim-transcript/` + PR images | UI done | any elm-4 edit |

---

### ELM-5 — E2E journey: full season with a revival week

**Scope:** new `e2e/survivor-journey.sim.spec.ts` (serial, sim-driven);
whatever minimal scenario/fixture composition the journey needs (the
`all-eliminated` scenario exists; if the journey needs a multi-week season
around it, extend the sim fixtures the way `mixed-week` composes — an
addition to the scenario library, not a change to existing scenarios).
**Excluded:** new branch coverage that ELM-2/3/4 already pin lower
(refusal/consumption/grading matrices stay out of the browser — E2E covers
journeys, not branches).

**Journey (one serial spec, three members — two cannot satisfy all three
board states at once, red-team finding 5):** admin resets sim
(`scope: "environment"` is e2e-safe — own DB) and loads fixtures → create
Survivor league through the real form (pickType/pushTie only — proves
ELM-1's form) → members M2, M3 join via invite → week 1: all pick; M3 picks
a loser → settle → board shows M3 eliminated with its week, pick history
revealed; M3's next week shows eliminated status, not a pick sheet → week
2: M1 changes a pick before kickoff and the change sticks; M1's week-1 team
is visibly disabled → revival week: M1 and M2 (the whole alive set) bust on
the all-eliminated shape → settle → board shows both revived, M3 still
eliminated → run to end week with safe picks → M1 and M2 shown as
co-winners, sharing first. Bindings: role/name + `data-testid`, zero
copy/DOM-structure bindings (UI-tests rule; toast asserts via our own
`testId` contract only).

**Verification map:** `pnpm test:e2e` green including the new spec (needs
`pnpm db:up`; suite self-hosts on `picksleagues_e2e`, ports 5273/3100);
committed Playwright text output → `elm-5/e2e/`; screenshots/video only if a
still can't prove the revival transition (motionless — screenshots suffice,
attached to the PR). Earliest checkpoint: full suite locally before PR.
Invalidated by: any SPA/API/scoring edit in the epic after the run.
Regression criterion: the existing **five** specs (`identity`,
`league-lifecycle`, `pickem-journey.sim`, `sim-panel`, `smoke`) stay green
in the same run (the journey moves the environment-wide sim clock —
`*.sim.spec.ts` runs with `fullyParallel: false`, never concurrent).

---

### ELM-6 — dashboard pick-status glance (appended 2026-08-07, decision 6)

**Contract (deliberately thin):** the ticket line + spec §Screens ("picks
in / picks needed / locked" at a glance) — per the tracker's readiness
policy the doc section is the contract, and this plan adds allocation, not
invented product detail. **Scope sketch:** mirror however the dashboard
renders Pick'em's glance for Survivor leagues (one pick per week; an
eliminated member's card states that instead), reusing the existing
dashboard data path plus whatever serializer addition the glance needs;
mode-prefixed naming; no new settlement surface. **Order:** after ELM-4
(needs pick + state data); diff-disjoint from ELM-5's e2e spec, so the two
may run in parallel worktrees. **Verification:** the standard per-PR gates
(delivery-strategy list); integration coverage only if a new serializer
lands; presentation policy stays untested (engineering rule); phone-width
screenshots to the PR; evidence `elm-6/`.

---

### Fixtures & real-dependency summary

Every integration seam runs against real Postgres (integration suite
auto-creates/migrates `picksleagues_test`; e2e creates `picksleagues_e2e`) —
no mocked repositories anywhere (testing seams rule). External provider: none
to hit; `SimulatedProvider` + scenario library are the real local dependency
(no real-target smoke exists by policy). Fixtures: integration tests seed
via existing helpers; e2e via `league-seed.ts` + sim scenarios; cleanup is
per-suite database teardown (existing global setups). No new external
provisioning.

### Ticket-state writes at implement time

Per `docs/agents/issue-tracker.md`: `/atlas-implement` claims each ticket
`[ ]`→`[~]` when its PR's work starts and appends `[PROGRESS]`/`[CLOSEOUT]`
records **to this file**; `[x]` is human-only after PR review. This plan
performs no checkbox transition.

---

## [RED TEAM REVIEW]

_Independent `atlas-red-team-reviewer`, 2026-08-07, fresh context, given only
the fixed contract, the draft plan, and repository paths. Verdict on the
draft: **REVISE** — 1 blocking, 5 major, 4 minor, 2 notes. All findings were
resolved in this file in the same session (one revision cycle):_

1. **BLOCKING — incremental settlement could run out of order** (a later week
   settling against a wrong alive-set; a late correction leaving stale
   downstream state until the nightly sweep). → Resolved: prefix-ordered
   settlement invariant + replay-from-earliest-affected-week, with two new
   ELM-4 verification rows.
2. **MAJOR — reverting a cancellation after a legal re-pick made recompute
   collide with the team-ledger index and abort settlement permanently.** →
   Resolved: sticky-release rule (decision 4) + ELM-4 verification row;
   owner may prefer refusing the override instead — flagged.
3. **MAJOR — the draft falsely claimed renewal re-resolves** (it copies
   verbatim per ADR-0009). → Corrected; renewal behavior now decision 7 with
   a verification row.
4. **MAJOR — eliminated-member pick eligibility was undefined.** → Resolved:
   decision 8 (`member_eliminated` on settled state; lag-window picks
   accepted by design) + ELM-2 verification row and UI behavior.
5. **MAJOR — the two-member e2e journey was jointly unsatisfiable** (a
   sticking elimination + an all-revived week + co-winners). → Resolved:
   three-member script.
6. **MAJOR — schema refinements deviated from arch §Domain Model with no
   reconciliation.** → Resolved: decision 9 (ELM-2 ADR + arch amendment in
   the same PR).
7–10. **MINOR** — lint does not prove the scoring import boundary (now
   mapped to typecheck + manifest); "four specs" → five;
   `resolveLeagueSettings` lives in `season-range.ts` (scope corrected);
   the range-exhausted `start_week_passed` edge added to ELM-1's steps and
   map.
11–12. **NOTES** — `/adr` sequenced before code at ELM-1; ELM-3 matrix
   gained the all-cancelled-slate collision row and an explicit statement
   that "week-move" collapses to `cancelled` per ADR-0019.

_The reviewer verified and passed: the team-change upsert leaves no stale
ledger rows; `isUniqueViolation` matches partial-index violations (Postgres
reports the index name on 23505); the visibility design (consumed teams from
revealed picks only, has-picked existence only, eliminated-member parity);
mode-prefixed naming; evidence policy conformance; the ELM-2 ∥ ELM-3
parallelization; and contract fidelity of decisions 2, 3, 5, 6._

---

## [PROGRESS] — ELM-1 (2026-08-07)

Work package `elm-1`, the first of the epic's six PR-sized slices. Branch
`feat/elm-1-survivor-rename-and-settings` off `staging` at `0ae12e4`; direct
checkout, sequential execution, no worktrees.

| Deliverable | Worker | Commit | Outcome |
|---|---|---|---|
| D1 — ADR-0023 + ADR-0024, spec/arch/backlog/policy sweep (docs only) | atlas-worker (session model) | `0002a20` | accepted |
| D2 — code rename + `leagues.mode` data migration + `openapi/` regen | atlas-worker (Sonnet) | `162a251` | accepted |
| D3 — Survivor settings wire shape, resolution, form rework | atlas-worker (session model) | `71b3795` | accepted |

**Isolation.** Direct checkout, not worktrees. D1 (docs) and D2 (code) are
genuinely diff-disjoint — confirmed at closeout against the real diffs, which
share no file — so the rejection was never about file conflicts. It was that D2
must run `pnpm test:integration` and `pnpm contract:check`, which need the `.env`
a fresh worktree lacks; two worktrees plus a merge to save one docs-sized slice
of wall-clock is not worth that fragility. D3 depends on D2's renamed symbols and
was ordered regardless.

**Orchestrator fix at the D1 acceptance screen.** `docs/mvp-spec.md` §End of
League still read "The league concludes after End Week resolves" — naming a
setting the same commit deleted. Reworded in place to "once the last week of its
resolved range has settled" rather than returned to the worker: a localized
wording correction that changes no design.

## [AI CODE REVIEW] — ELM-1

Single formal review, performed by the frontier orchestrator against the complete
integrated diff `0ae12e4..71b3795`. Static review only; verdicts on behaviour are
in the verification record below.

### Axis 1 — technical implementation and spec conformity

Conforms to the fixed contract: the epic's ELM-1 line, its three owner-decision
headers, and plan decisions 1, 7 and 10 as ruled at plan review.

- **The one design change worth the reviewer's attention is correct and was not
  in the ticket text.** `resolveLeagueSettings` decided whether to resolve by
  duck-typing (`"seasonRangePreset" in parsed.data`). A Survivor input carries
  neither week refs nor a preset, so that test would have passed it straight
  through and stored settings with **no range at all** — surfacing as a 500 from
  the stored schema, one layer too late to say anything useful. Replaced with an
  exhaustive `switch` on `mode`, which also makes a fourth mode a compile error
  here rather than a mode whose range nobody resolves.
- **The clock-resolution core was extracted mode-neutral** (`resolveNflSeasonRange`,
  taking a nominal range rather than a Pick'em preset) and both NFL modes now
  route through it, so neither can drift on which week counts as already under
  way. `PICKEM_SEASON_RANGE_PRESET` / `PICKEM_NOMINAL_RANGE` correctly stayed
  Pick'em-named — the three-option preset set genuinely is Pick'em's — and the
  regular-season week literals got a single home (`NFL_REGULAR_SEASON_RANGE`)
  that `PICKEM_NOMINAL_RANGE` now reads from instead of restating.
- **Every AC has a real test at the cheapest layer that can hold it.** Wire-shape
  refusal is a unit test; all six range-resolution behaviours are integration
  tests against real Postgres; the visual claim was driven in a browser. No
  criterion is carried by a worker's self-report.
- **Every caller of both dispatch maps was checked** — three branches in
  `season-range.ts`, one client-side pre-save gate in `settings-section.tsx`, and
  the schema tests. No caller was left assembling the old shape.
- **Non-blocking, flagged for the owner:** `SurvivorSettingsInputSchema` is a
  `z.strictObject` where `PickemSettingsInputSchema` merely strips unknown keys.
  This is deliberate and reasoned in the schema's own doc comment (a Pick'em
  request survives stripping with its preset intact; a Survivor request naming
  week refs would have nothing left of its intent), and the plan's verification
  map specified rejection. The accepted consequence is that a **stale SPA build**
  posting the pre-ADR-0024 shape gets a 400 rather than a silently-resolved
  league. Correct for a single-deploy app; worth knowing.
- No scope leak: no pick surface, no settlement, no Pick'em behaviour change. The
  Pick'em journey and its integration suites stay green through the shared
  extraction, which was the regression that mattered.

### Axis 2 — coding standards

Conforms to `.claude/rules/engineering.md` and the ADRs it references.

- **Mode-specific naming** — the rule's own test ("name the second mode that will
  use it unchanged") is what licensed the one generic name introduced here, and it
  was applied in exactly that direction rather than by convenience.
- **Comments state a why and cite durable identifiers.** Verified mechanically:
  no plan-internal numbering (`decision 3`, `step 2`) leaked into any code
  comment — the rule those parentheticals exist to prevent.
- **Contract discipline** — the new component is registered under its own name;
  no `.nullable()`/`.optional()` wrapper on a registered schema; `openapi/`
  regenerated and committed in the same change, and `contract:check` verified
  green *after* the commit (it necessarily reports stale before one).
- **Value sets, theme tokens, accessibility, mobile-first** — the new read-only
  range block uses semantic headings and theme tokens only, and stacks rather than
  using a two-column grid, so it holds at 390px.
- **Tests assert outcomes, not process**, bind to roles rather than copy, and the
  new Survivor fixture went into the shared helper instead of being copy-pasted
  into the renewal suite.
- **Deliberate non-renames, recorded rather than assumed:** ADRs 0006–0022 keep
  the former mode name because a merged ADR is immutable, and member-state
  vocabulary (alive / eliminated / revived, the `all-eliminated` scenario slug)
  keeps its names because those are the correct domain words for a survivor pool.
  ADR-0023 states both so the survivors don't read as an incomplete sweep.

**Unresolved blocking findings: none.**

## [CLOSEOUT] — ELM-1

**Run surface:** local only. **Evidence:** `docs/evidence/test-results/elm-1/`
(text committed); screenshots attached to the PR per `docs/agents/testing.md`.

| Criterion (source) | Verdict | Evidence |
|---|---|---|
| Rename complete; stored league rows rewritten | PASS | `migration-0022/`, `static-gates/` |
| Input schema rejects a range; stored schema still parses refs | PASS | `suites/` (unit) |
| Mid-week resolution → next future-kickoff week; end = reg 18 | PASS | `suites/` (integration) |
| No-games fallback → reg week 1 | PASS | `suites/` (integration) |
| League never born already-started (join still allowed pre-start) | PASS | `suites/` (integration) |
| Range exhausted → 409 `start_week_passed` | PASS | `suites/` (integration) |
| Renewal copies verbatim; post-renewal pre-start save re-resolves | PASS | `suites/` (integration) |
| Form ships one fewer setting, resolved range shown read-only | PASS | `form-shape/` + PR images |
| Contract in sync | PASS | `static-gates/` |
| Spec/ADR reconciled | PENDING — human gate | PR diff |

**Verified run commands:** `pnpm typecheck && pnpm lint && pnpm format:check &&
pnpm contract:check && pnpm test && pnpm --filter @picksleagues/web build`, then
`pnpm db:up && pnpm test:integration`, then `pnpm test:e2e` (13 passed). No
deployed target exists for this repository by policy.

**Human gate — open.** The owner confirms ADR-0023 and ADR-0024 record their
decisions faithfully, and reviews the locked-doc amendments. ELM-2 through ELM-6
should not start until this closes: all five adopt `survivor*` names on the
strength of ADR-0023.

### Deviations and judgement calls for the owner

1. **Scope.** `/atlas-implement ELM` named the epic; this run delivered **ELM-1
   only**. Three signals agreed: repo precedent slices large epics into PR-sized
   work packages (`simp-pr1/2/3`), the approved plan prescribes six PRs, and the
   ADR human gate above blocks the rest. ELM-2..6 remain `[ ]`.
2. **Ticket text was rewritten without a prior preview.** `docs/agents/issue-tracker.md`
   requires previewing any change to a ticket's text; D1 reworded the ELM ticket
   lines and renamed the epic file as part of the approved sweep. The substance
   was pre-approved (the owner's mode-name decision names the epic file, title and
   ticket wording explicitly), but the exact write was not shown first. Recorded
   as a deviation rather than glossed.
3. **`SurvivorSettingsInputSchema` is strict where Pick'em's strips** — see the
   review's Axis 1 flag. Reverting to strip is a two-character change plus one
   test rewrite if the owner prefers symmetry.
4. **Two owner-decision header blocks were edited** in the epic file, beyond a
   word swap: the playoffs block said "ELM-1's settings keep Start/End Week within
   regular-season weeks 1–18", which would have contradicted the block directly
   beneath it once the range left the form, and both blocks gained their ADR
   numbers. The decisions themselves are untouched.
5. **The spec's Decisions Log gained two rows** (mode name, Survivor season
   range) that nothing explicitly asked for, added so the locked spec's own
   decision table stays complete. Trivially droppable.
6. **`CLAUDE.md`'s mode list inside the Atlas-managed `guidance` section was
   edited.** A setup rerun preserves managed-section content rather than
   regenerating it, so the rename should survive — but it is a managed region and
   the owner should know it was touched.
