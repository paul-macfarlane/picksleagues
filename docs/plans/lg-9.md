# [EXECUTION PLAN] — LG-9

_Work package: ticket **LG-9** (`backlog/03-leagues.md`). The ticket line is the
stable contract; this file is the technical plan and never amends it._

_Recorded by `/atlas-plan`, 2026-08-06; **revised same day** on the owner's
decision to fold the pre-start settings editor's identical dead-preset 409 into
this ticket rather than a follow-up. Status: **approved 2026-08-06** — the
owner applied the proposed ticket-text edit and invoked `/atlas-implement`,
which is the approval; execution records below. Red-team review **skipped**
per the risk-gated policy in `docs/agents/planning.md`, re-checked after the
scope expansion: still no `packages/scoring` change, no lock or
pick-visibility **semantics** change (both surfaces *read* the existing start
derivation; the server's `start_week_passed` refusal stays the enforcement),
no settlement, no override precedence, no migration. The one new authz surface
reuses the existing `EDIT_SETTINGS` gate unchanged (see Repository-specific
considerations). Run surface: **local only**. Verification commands and
evidence policy: `docs/agents/testing.md`; evidence root
`docs/evidence/test-results`, cleared before capture._

## Intent

Two surfaces offer all three ADR-0020 season-range presets unconditionally and
let the server's `start_week_passed` 409 be the only feedback — a refusal a
Pick'em commissioner cannot act on since SIMP-20 removed the explicit week
controls its message implies:

1. **The create form** (`/leagues/new`): a preset whose whole range has
   already run — Regular Season during the playoffs, anything after the Super
   Bowl — is accepted by the form and refused at submit.
2. **The pre-start settings editor** (league home, `settings-section.tsx`):
   *changing* to a dead preset (e.g. a Full Season league switching to Regular
   Season during the playoffs) meets the identical refusal on Save. (Owner
   decision 2026-08-06: in scope here.)

Both must learn, from the server, which presets the relevant season can still
start, and offer exactly those. The two surfaces answer against **different
seasons**: the create form against the latest ingested NFL season (what a new
league would bind to), the editor against **the league's own bound season**,
which may not be the latest (ADR-0009 — a league can sit on last year's
instance while a newer season is already ingested). The server's refusal
remains the enforcement for both (same division as LG-10: the UI change is a
hint plus an explanation, computed from server-derived data, never a
client-side re-derivation of the clock rule). No creation or update semantics
change.

## Facts the plan rests on (surveyed 2026-08-06)

- **Acceptance is exactly resolve → derive → compare, on both paths.**
  `createLeague` (`apps/api/src/services/leagues/crud.ts`) binds to
  `latestSeasonForSport(db, sportForMode(mode))`; `updateLeague` reads the
  league's **current season instance** via `getLeagueWithCurrentSeason`. Both
  then resolve via `resolvePickemSeasonRange`
  (`services/leagues/season-range.ts`), derive `leagueStartAt`
  (`services/leagues/start.ts`), and refuse `start_week_passed` when
  `!isPreStart(startsAt, clock)`. Any availability computation must reuse
  these exact functions against the *same seasonId the refusal path would
  use*, or hint and enforcement can disagree.
- **Provisional/no-games seasons are startable.** `leagueStartAt` returns
  `null` when the start week holds no games, and `isPreStart(null, clock)` is
  `true` — the offseason path (ADR-0009) must report all three presets.
- **No season at all** short-circuits creation earlier (`no_active_season`);
  no preset matters then. A league-scoped read always has a bound season.
- **The editor's save payload always carries the preset.** Settings are
  all-or-nothing (`settings-section.tsx` re-assembles the whole blob), so
  every settings save re-resolves. This is safe for the *stored* preset:
  **a pre-start league's own stored preset is always still startable.** The
  league being pre-start means its stored start week's first kickoff is in
  the future (or the season has no games); re-resolution picks the later of
  the nominal start and the earliest still-upcoming week in range, which by
  construction has a future (or absent) first kickoff, so `isPreStart` holds.
  Only *switching* to a preset whose entire range has run can refuse. Two
  consequences: the editor's filtered options always include its current
  selection, and the editor needs **no empty-state surface** — post-start,
  LG-10's window-disable already governs the whole fieldset.
- **Gate precedent for a settings-editor-only read:** `getPickemPickSummary`
  (`services/pickem/picks.ts`) gates with
  `authorizeLeagueAction(db, leagueId, userId, LEAGUE_ACTION.EDIT_SETTINGS)`,
  then the mode check, returning `PICKEM_REFUSAL` reasons the route maps via
  `pickemRefusal` (403/404/400). The editor fetches it with an enabled flag:
  `usePickemPickSummary(league.id, isPickem && canEdit && !started)`.
- **The SPA has no pre-league season surface.** The only season reads are
  admin-gated (`/admin/seasons`) or league-scoped. Computing availability
  client-side would require new kickoff endpoints *plus* a client copy of the
  resolution rule — forking exactly the logic ADR-0020 centralizes
  server-side.
- **Form state:** `leagues/new.tsx` holds `pickemSeasonRange` as plain
  `useState` (the documented TanStack-Form carve-out) defaulting to
  `DEFAULT_PICKEM_SEASON_RANGE` (Regular Season); `settings-section.tsx`
  initializes from stored settings. Options come from
  `PICKEM_SEASON_RANGE_OPTIONS` in
  `apps/web/src/components/league-settings-fields.tsx`, shared by both.
- **Route middleware in `routes/pickem.ts` is scoped to
  `/leagues/:leagueId/pickem/*`**; the non-league-scoped create-form path
  needs its own `app.use("/pickem/*", …)` registrations, while the
  league-scoped path falls under the existing lines.
- **E2E invalidation check:** `e2e/league-lifecycle.spec.ts` creates a Pick'em
  league with defaults against a seeded 2099 season whose week-1 kickoff is in
  the future → Regular Season stays offered. `e2e/pickem-journey.sim.spec.ts`
  creates one under the `mixed-week` scenario (upcoming kickoffs exist) →
  Regular Season stays offered. Neither spec touches the select. No e2e edits
  expected.
- **Integration harness:** `apps/api/test/league-season-range.test.ts` has the
  exact fixtures this needs (`makeLeagueTestHarness`, `seedSeason`,
  `PRE_START_NOW`, per-clock app instances, a miniature full season).

## Decisions resolved into the plan

1. **One availability computation, two endpoints.** The core is season-scoped;
   each surface wraps it with the season *its* refusal path would use:
   - **`GET /pickem/season-range-presets`** — create form. Session-required,
     no further gate (any authed user may create a league). Answers for the
     latest ingested NFL season. Responses: 200 / 401 / 500.
   - **`GET /leagues/{leagueId}/pickem/season-range-presets`** — settings
     editor. Gated exactly like `getPickemPickSummary`: `authorizeLeagueAction`
     with `LEAGUE_ACTION.EDIT_SETTINGS`, then the mode check; refusals
     travel as `PICKEM_REFUSAL` reasons mapped by `pickemRefusal`. Answers
     for the league's current season instance — the same
     `getLeagueWithCurrentSeason` read `updateLeague` performs, so a league
     bound to a non-latest season gets its own season's answer, never the
     latest season's. Responses: 200 / 400 (`wrong_league_mode`) / 401 / 403 /
     404 / 500.
2. **Shared response DTO** in `packages/schemas/src/league-settings.ts` (where
   the preset const set and nominal ranges live), registered once as
   `PickemSeasonRangePresetsResponse`:
   `{ seasonYear: number | null, startablePresets: PickemSeasonRangePreset[] }`.
   `seasonYear: null` ⇔ no ingested NFL season — reachable only on the
   create-form endpoint (`startablePresets` then empty); the league-scoped
   endpoint always has a bound season and serializes its year. The nullable
   field is inline `z.number().nullable()` on a fresh component — not a
   `.nullable()` wrap of a registered schema, so the shared-component widening
   hazard doesn't apply.
3. **Services** in `services/leagues/season-range.ts`, beside the resolution
   they reuse:
   - Core `startablePickemSeasonRangePresets(db, clock, seasonId)`: per preset
     (3 total), `resolvePickemSeasonRange` → start-week first-kickoff →
     `isPreStart`. To avoid casting a bare `{ startWeek }` to
     `LeagueSettings`, extract the NFL branch of `leagueStartAt` into an
     exported `nflWeekFirstKickoffAt(db, seasonId, week)` in `start.ts` and
     have `leagueStartAt` delegate to it — a targeted extraction, not a
     layer; it is what keeps both endpoints and both refusal paths incapable
     of disagreeing. The core names no HTTP status and needs no refusal
     union (an empty list is an answer).
   - Create-form wrapper: `latestSeasonForSport` → core; `{ seasonYear: null,
     startablePresets: [] }` when no season exists.
   - League-scoped service (in `services/pickem/` beside `getPickemPickSummary`
     or in `season-range.ts` — implementer's call, matching whichever file the
     gate helpers make cleaner): gate → mode check →
     `getLeagueWithCurrentSeason` → core, returning the existing
     `PICKEM_REFUSAL` reasons on refusal.
4. **SPA hooks** in `apps/web/src/api/pickem.ts`, each with an exported query
   key: `usePickemSeasonRangePresets()` (create form) and
   `useLeaguePickemSeasonRangePresets(leagueId, enabled)` (editor — enabled
   flag mirroring `usePickemPickSummary`: `isPickem && canEdit && !started`).
   No invalidation fan-out — nothing the SPA does changes the answer; default
   refetch behavior is enough.
5. **Create-form behavior** (`leagues/new.tsx`):
   - While the query is pending **or failed**: offer all three presets
     (today's behavior; the server refusal is the backstop). A failed
     availability read does **not** toast and does not block creation — its
     absence removes no safety warning; the worst case is exactly the
     pre-LG-9 experience.
   - On success: options = `PICKEM_SEASON_RANGE_OPTIONS` filtered to
     `startablePresets`. If the currently selected preset is not offered, the
     effective selection moves to the first offered option (derived value,
     not an effect, so the submit payload and the select can never disagree).
   - `startablePresets` empty (mode = Pick'em): render an inline explanation
     where the select's guidance belongs and disable the Create button
     (extending the existing submit gate). Copy is the owner's call; tests
     must not bind to it. Elimination/March Madness submit paths are
     untouched by the gate.
6. **Settings-editor behavior** (`settings-section.tsx`): same
   filter-and-degrade rule — pending/failed offers all three, success filters.
   No selection fallback and no empty state are needed: the stored preset is
   provably in the startable set while the editor is enabled (pre-start
   invariant above), and post-start the LG-10 disable owns the fieldset. The
   dirty-tracking, nominal-range invalidation warning, and save assembly are
   untouched — only the option list narrows.
7. **`PickemSettingsFields`** takes the option list as a prop (default: all
   three) so both callers pass their filtered list and no other consumer
   changes.
8. **Explicit exclusions** — each a real adjacent gap, deliberately left:
   - **Elimination's explicit week pair** can equally be entirely in the past
     at create time. ADR-0020 §Scope defers Elimination to epic 06.
   - The **renewal path** (`POST /leagues/{id}/seasons`) and its
     `start_week_passed` behavior, if any — unchanged.
   - `docs/mvp-spec.md`, `docs/architecture.md`, ADRs: no changes; nothing
     here deviates from them (ADR-0020 already defines resolution; this adds
     reads of it).

## In-scope files

- `packages/schemas/src/league-settings.ts` — response DTO (+ index re-export
  if not covered by the existing barrel).
- `apps/api/src/services/leagues/start.ts` — extract `nflWeekFirstKickoffAt`;
  `leagueStartAt` delegates (behavior identical).
- `apps/api/src/services/leagues/season-range.ts` — core + create-form
  service.
- `apps/api/src/services/pickem/picks.ts` *or* `season-range.ts` — the
  league-scoped, `EDIT_SETTINGS`-gated service (see decision 3).
- `apps/api/src/routes/pickem.ts` — both routes + `/pickem/*` middleware
  lines for the non-league-scoped path.
- `openapi/` — regenerated spec + client, committed in the same change.
- `apps/web/src/api/pickem.ts` — two query hooks + keys.
- `apps/web/src/components/league-settings-fields.tsx` — options prop on
  `PickemSettingsFields`.
- `apps/web/src/routes/_authed/leagues/new.tsx` — hook wiring, filtering,
  effective-selection derivation, empty-state + submit gate.
- `apps/web/src/components/league/settings-section.tsx` — hook wiring,
  filtered options.
- `apps/api/test/pickem-season-range-presets.test.ts` — new integration
  suite covering both endpoints (reusing `league-season-range.test.ts`
  fixtures/harness).

## Ordered steps

1. Schemas: add `PickemSeasonRangePresetsResponse` DTO.
2. API: `start.ts` extraction, then the season-scoped core and both service
   wrappers.
3. Routes: register both endpoints; add `/pickem/*` middleware for the
   create-form path.
4. `pnpm contract:generate`; commit `openapi/` with the schema/route change.
5. Web: hooks in `api/pickem.ts`; options prop on `PickemSettingsFields`;
   wire `leagues/new.tsx` (filter, derived selection, empty state, gate) and
   `settings-section.tsx` (filter only).
6. Integration tests (see map). Run the full local gate.
7. Simulator-driven UI evidence at phone width; commit under the evidence
   root.

## Acceptance criteria → verification map

Real dependency throughout: Dockerized Postgres (`pnpm db:up` first). No
human-gated criteria. No candidate evidence was captured during planning (no
commands were run); every check below runs at implementation.

| # | Criterion | Surface / command | Expected | Evidence | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|---|
| AC1 | Create endpoint agrees with `createLeague`: every preset it reports startable is accepted by `POST /api/leagues`, and a non-reported preset is refused `start_week_passed` | `pnpm test:integration` — new suite asserts the pair (endpoint answer, create outcome) at the same simulated clock | Suite green; the agreement case asserted explicitly | Committed vitest output under `docs/evidence/test-results` | After step 6 | Any change to `season-range.ts`, `start.ts`, `crud.ts`, or fixtures |
| AC2 | Create-endpoint clock scenarios: pre-season → all 3; mid-regular-season (week 1 kicked off, later week upcoming) → all 3; after last regular kickoff, before Wild Card → postseason + full only; after Super Bowl kickoff → empty; provisional season (weeks, no games) → all 3 with `seasonYear` set; no season → empty with `seasonYear: null` | Same suite, `it.each` over clock instants (mirrors `league-season-range.test.ts` style) | Exact `startablePresets` sets per row | Same vitest output | After step 6 | Same as AC1 |
| AC3 | League-scoped endpoint answers for the league's **bound** season, not the latest: league created on season S1, then S2 (later year) ingested; at a clock where S1's regular season has run but its postseason is upcoming and S2 is untouched, the league-scoped endpoint returns postseason + full with S1's year while the create endpoint returns all 3 with S2's year | Same suite: seed S1, create league, seed S2, hit both endpoints | The two answers differ exactly as stated | Same vitest output | After step 6 | Same as AC1, plus `getLeagueWithCurrentSeason` changes |
| AC4 | League-scoped endpoint agrees with `updateLeague`: a preset it reports startable PATCHes successfully; a non-reported one is refused `start_week_passed`; and the stored preset of a pre-start league is always in the reported set (the invariant the editor's UX rests on) | Same suite | Agreement + invariant asserted | Same vitest output | After step 6 | Same as AC3 |
| AC5 | League-scoped endpoint gating matches the pick-summary precedent: non-commissioner → 403, non-member/absent league → 404, non-Pick'em league → 400 `wrong_league_mode` | Same suite, one row each | Exact statuses and wire slugs | Same vitest output | After step 6 | `authorizeLeagueAction`, `pickemRefusal`, or route changes |
| AC6 | The create form offers only startable presets, and the default selection is always an offered one | Simulator drive (`docs/agents/verification-runbook.md`): `pnpm dev`, load scenario, set clock to a post-regular-season instant, open `/leagues/new` | Select lists Postseason + Full Season only; selection lands on an offered preset | Screenshot, phone width, one directory per check under the evidence root | After step 7 | Any edit to `leagues/new.tsx`, `league-settings-fields.tsx`, `api/pickem.ts` |
| AC7 | No-startable-preset state on the create form: inline explanation, Create disabled for Pick'em | Simulator drive with clock after the Super Bowl kickoff | Explanation rendered in the fieldset's space; Create button disabled; switching mode to Elimination re-enables the form's normal gating | Screenshot, phone width | After step 7 | Same as AC6 |
| AC8 | The pre-start settings editor of a Full Season league, at a clock where the regular season has run, offers Postseason + Full Season only — and its current selection is among them | Simulator drive: create Full Season league pre-season, advance clock past the regular season, open the editor | Filtered select; stored preset present and selected | Screenshot, phone width | After step 7 | Any edit to `settings-section.tsx`, `league-settings-fields.tsx`, `api/pickem.ts` |
| AC9 | Existing journeys unbroken (lifecycle create with defaults; pickem journey under `mixed-week`) | `pnpm test:e2e` | Green, unmodified specs | Run output cited in PR | After step 7 | Any SPA or API change in this package |
| AC10 | Contract in sync | `pnpm contract:check` | Clean tree under `openapi/` | Command output | After step 4 | Any schema/route change |
| DoD | Repo gates | `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check && pnpm --filter @picksleagues/web build` | All green | Command output | After step 6 | Any change |

Fixtures: the integration suite provisions per-case seasons via `seedSeason`
(two seasons for AC3 — the helper takes a `year`, so a second call with a
later year is the whole setup) and resets with `resetDb` (`beforeEach`), same
as the sibling suite — no external fixtures, no cleanup debt. The simulator
evidence run uses the dev stack's scenario load/reset endpoints per the
runbook and leaves the dev DB as the runbook prescribes.

## Repository-specific considerations

- **Clock discipline:** the services read only the injected `Clock`;
  comparisons reach SQL as bound parameters (already true of the reused
  helpers). The SPA never computes availability from `Date.now()` or
  `useAppNow()` — it renders the server's answer verbatim.
- **Authz (planning.md requires the impact stated):** the league-scoped
  endpoint introduces no new privilege — it reuses `authorizeLeagueAction`
  with the existing `EDIT_SETTINGS` action, the same gate and refusal shapes
  as `getPickemPickSummary`, and reveals only which presets are startable —
  a derivation over schedule data, not member or pick data. Read-only: no
  audit-trail obligation. The create-form endpoint is session-only by design,
  matching who may create a league. No pick-visibility semantics involved.
- **Contract:** schema + routes + regenerated `openapi/` land in one change or
  `contract:check` fails (AC10).
- **Naming:** everything new is `pickem*` — schema component, route paths,
  services, hooks, query keys. The second mode that could use a generic name
  cannot be named (Elimination addresses weeks directly until epic 06), so
  generic names are not available here.
- **Craft-debt flag (not silently absorbed):** `leagues/new.tsx` and
  `settings-section.tsx` are the plain-`useState` carve-out and both grow
  another concern here; they remain within the carve-out's terms, but
  `settings-section.tsx` in particular is already the larger file — if it
  accretes further, a split along mode-fieldset lines is the owner's call.

## Ticket-text edit (applied)

Tracker policy binds ticket-text changes to a preview/human action. The owner
previewed and instructed the edit on 2026-08-06; it is applied to the LG-9 line
in `backlog/03-leagues.md`, before "Ref: ADR-0020":

> Owner 2026-08-06: also in scope — the pre-start settings editor's identical
> dead-preset refusal; its Season range select filters the same way, computed
> against the league's own bound season (which may not be the latest).

## Execution structure

Repository delivery: `picksleagues` (`.`), base `staging` at
`25a63f85dfa9f0192e5df41620f0d8c9580861d6`, branch
`feat/lg-9-startable-season-range-presets`.

**Direct checkout, no worktrees.** The two deliverables are strictly
sequential — the SPA cannot typecheck against endpoints whose generated client
does not exist yet — so there is no concurrency for isolation to protect, and a
worktree would only add setup and merge cost.

| # | Deliverable | Covers | Depends on | Worker |
|---|---|---|---|---|
| D1 | Server-side availability: DTO, `nflWeekFirstKickoffAt` extraction, season-scoped core, both service wrappers, both routes, regenerated `openapi/`, integration suite | AC1–AC5, AC10 | — | `atlas-worker` (sonnet) |
| D2 | SPA: both query hooks, options prop on `PickemSettingsFields`, create-form filter + derived selection + empty state + submit gate, settings-editor filter | AC6–AC8 (implementation; evidence at aggregate verification) | D1 | `atlas-worker` (sonnet) |

**Why D2 is one deliverable, not two.** Splitting create-form from settings-editor
would put two workers on the same declarations, not merely the same files:
`PickemSettingsFields`' single signature in
`apps/web/src/components/league-settings-fields.tsx`, and two adjacent hook
additions to `apps/web/src/api/pickem.ts`. Re-checked against the real diffs at
closeout (see `[CLOSEOUT]`).

Evidence: AC6–AC8 (simulator-driven, phone width) and AC9 (`test:e2e`) are
gathered by the orchestrator at aggregate verification, since only the
integrated candidate can prove them. The proof-artifact root
`docs/evidence/test-results` is cleared before capture, per
`docs/agents/testing.md`.

## [PROGRESS]

- 2026-08-06 — Claimed LG-9 (`[ ]` → `[~]`), branch created off `staging` at
  `25a63f8`. Tracker guide reread before the claim; the work package has not
  modified any `docs/agents/*.md`, so the whole-file reread case did not apply.
- 2026-08-06 — D1 delivered (`8864d47`, amended from `dc60401` with the
  orchestrator fixes in the review below). Acceptance screen passed. AC1–AC5
  and AC10 candidate evidence captured at that commit.
- 2026-08-06 — D2 delivered (`8e4d815`). Acceptance screen passed, no fixes
  required.

## [AI CODE REVIEW]

Single formal review of the complete branch diff (`staging...8e4d815`),
performed by the frontier orchestrator. Static review only — verdicts against
the criterion map are recorded separately under `[CLOSEOUT]`.

**Scope containment.** The branch touches exactly the plan's in-scope file
list, plus the tracker/plan files and the deletion of the previous work
package's evidence artifacts. No file outside it was modified; no Elimination
surface, renewal path, locked doc, or ADR was touched, matching the plan's
stated exclusions.

### Axis 1 — technical implementation and spec conformity

All eight resolved decisions are implemented as approved. The load-bearing
one — that availability be computed by the *same* functions the refusal path
uses — holds concretely: `startablePickemSeasonRangePresets` calls
`resolvePickemSeasonRange` → `nflWeekFirstKickoffAt` → `isPreStart`, and
`leagueStartAt` now delegates its NFL branch to that same
`nflWeekFirstKickoffAt`, so hint and enforcement share one derivation rather
than two that agree today. Each wrapper passes the season its own refusal path
uses (`latestSeasonForSport` for create, `getLeagueWithCurrentSeason` for the
league-scoped read), which is what makes AC3's divergence correct rather than
incidental.

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | `PickemPickSummaryRefusal` became shared by two services while its name and doc comment still described only the pick summary; two neighbouring comments (`PICKEM_REFUSAL.NOT_COMMISSIONER`, `PickemWriteRefusal`) asserted the `not_commissioner` axis "belongs to the pick-summary read alone", which the new service falsified | Minor | **Fixed inline by the orchestrator** before the commit was accepted — renamed to `PickemSettingsEditorRefusal` and all three comments corrected. Recorded here so the commit's provenance stays honest |
| 2 | The create form's no-startable-preset state replaces the **whole** Pick'em fieldset, where the plan said "an inline explanation where the select's guidance belongs" | Minor | **Accepted as a deviation with rationale.** Rendering pick-type and picks-per-week controls for a league that provably cannot be created is worse than omitting them, and Create is disabled in this state regardless. This is presentation policy, explicitly the owner's to change; no test binds to it |
| 3 | `updateLeague` gates a settings PATCH on the **old** stored start (`league_started`) before it resolves the new preset — a behavioral fact the plan did not state, surfaced by AC4's fixture needing a league started on Postseason | Informational | **No change.** It cannot produce a surface inconsistency: the editor's hook is gated `isPickem && canEdit && !started`, so a started league never fetches availability at all. Recorded because the next change here will meet it again |
| 4 | The create form fetches availability regardless of the selected mode, so an Elimination or March Madness creator makes one unused request | Informational | **Considered and kept.** Rules-of-hooks makes the unconditional call correct, and gating on mode would leave the member looking at an unfiltered list for one round trip after switching *to* Pick'em — the opposite of the ticket's intent, for one cheap authenticated GET |

No blocking findings. The integration suite's two agreement loops (AC1, AC4)
assert `0 < startablePresets.length < 3` before iterating, so neither can pass
vacuously if the endpoint ever answered all-or-nothing — the failure mode that
would make an agreement test worthless.

### Axis 2 — coding standards

Conformity confirmed against the rules this change is most exposed to:

- **Time discipline (arch D13):** every "now" read goes through the injected
  `Clock`; no `Date.now()`, bare `new Date()`, or SQL `now()` appears in any
  added line (scanned). The SPA renders the server's answer verbatim and never
  reaches for `useAppNow()` to re-derive it.
- **Thin route handlers; services name reasons, not statuses.** Both handlers
  validate → guard → delegate; the league-scoped service returns
  `PICKEM_REFUSAL` values mapped by the existing `pickemRefusal`. The shared
  401/403/404/500 descriptors are reused, not restated.
- **Contract & codegen:** the new component is a fresh registration with an
  inline `z.number().nullable()`, not a `.nullable()` wrap of an already
  registered schema — the silent-widening hazard the rule names does not apply.
  `openapi/` is regenerated and committed in the same change.
- **Comments cite durable identifiers** (`ADR-0020`, `ADR-0009`, `LG-9`,
  `LG-10`) and never a plan's internal numbering — scanned the added lines for
  `(decision N)` / `(step N)` forms and found none, which is the specific
  regression QLTY-5 existed to close.
- **SPA boundaries:** both hooks live in `apps/web/src/api/pickem.ts` with
  exported query keys; neither UI file contains an `api.*` call or a query-key
  literal. Both forms stay inside the documented plain-`useState` carve-out.
- **Presentation policy is not unit-tested** — no test was added for which
  options a screen offers, per the rule reserving that judgment to the owner.
  AC6–AC8 are proved by driven-simulator screenshots instead.
- **Theme tokens only** (`text-foreground`, `text-muted-foreground`); the
  inline explanation is a heading plus a paragraph, matching `QueryState`'s
  existing idiom for inline query-derived messaging rather than introducing a
  `role="status"` pattern the SPA uses nowhere else. Route layout unchanged.
- `pnpm lint` exits 0 with no output, so the growth in `settings-section.tsx`
  raised no max-lines warning. The plan's standing craft-debt flag on that file
  remains open and is the owner's call, not this package's.

## [CLOSEOUT]

Repository delivery `picksleagues`, branch
`feat/lg-9-startable-season-range-presets`, base `staging` at `25a63f8`.
Verified at integrated commit `8e4d815`.

| Deliverable | Worker / model | Commit | Outcome |
|---|---|---|---|
| D1 — server-side availability (DTO, extraction, core, two services, two routes, `openapi/`, integration suite) | `atlas-worker` / sonnet | `8864d47` (amended from `dc60401` with the orchestrator's inline review fixes) | Accepted |
| D2 — SPA (two hooks, options prop, create-form filter/derived selection/empty state/gate, editor filter) | `atlas-worker` / sonnet | `8e4d815` | Accepted, no fixes needed |

### Verdicts

| # | Verdict | Evidence | Command |
|---|---|---|---|
| AC1 | **PASS** | Endpoint-vs-`createLeague` agreement asserted at one clock, both branches exercised | `pnpm test:integration` |
| AC2 | **PASS** | All six clock scenarios green as an `it.each` table | `pnpm test:integration` |
| AC3 | **PASS** | S1 league + later S2 ingested: league-scoped returns postseason+full/2026, create returns all three/2027 | `pnpm test:integration` |
| AC4 | **PASS** | PATCH agreement plus the stored-preset invariant | `pnpm test:integration` |
| AC5 | **PASS** | 403 / 404 / 400 `wrong_league_mode` (and 401) with exact wire slugs | `pnpm test:integration` |
| AC6 | **PASS** | `docs/evidence/test-results/lg9-ac6-create-form-filtered/phone.png` — at simulated 9/19/99 the select offers Postseason and Full Season only, and the selection has moved off the unavailable Regular Season default | driven simulator, phone width |
| AC7 | **PASS** | `docs/evidence/test-results/lg9-ac7-no-startable-preset/phone.png` — after the Super Bowl kickoff the fieldset is replaced by the explanation and Create is disabled; switching to Elimination re-enables it | driven simulator, phone width |
| AC8 | **PASS** (criterion corrected — see below) | `docs/evidence/test-results/lg9-ac8-settings-editor-filtered/phone.png` — a pre-start league bound to 2099 offers Postseason and Full Season only, with its stored Postseason present and selected | driven simulator, phone width |
| AC9 | **PASS** | 13 passed, specs unmodified (`git diff staging...HEAD -- e2e/ playwright.config.ts` is empty) | `pnpm test:e2e` |
| AC10 | **PASS** | Clean `openapi/` tree after regeneration | `pnpm contract:check` |
| DoD | **PASS** | typecheck, lint (exit 0, no warnings), 439 unit tests, format:check, web build — all green | `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check && pnpm --filter @picksleagues/web build` |

Raw output for the static, unit, integration, contract and e2e runs:
`docs/evidence/test-results/gates/local-gate.txt`.

### AC8 criterion correction

The plan wrote AC8 against "the pre-start settings editor of a **Full Season**
league, at a clock where the regular season has run". That state cannot exist:
a Full Season league's stored start week is regular week 1, so once the regular
season has run the league **has started**, and LG-10's window-disable owns the
fieldset — there is no pre-start editor left to screenshot. The criterion's
intent (the editor filters against the league's own bound season and still
offers its stored selection) is exercised by a **Postseason** league at that
same clock, whose stored start is Wild Card and therefore still ahead. That is
the fixture the evidence uses, and the same shape D1's invariant test uses.
Recorded rather than silently substituted: the plan's wording was wrong, not
the implementation.

### Deviations

1. **AC8 fixture corrected** as above — a plan defect found at verification.
2. **Create form's empty state replaces the whole Pick'em fieldset**, not just
   the season-range control's guidance (review finding 2). Presentation policy,
   owner-changeable, nothing binds to it.
3. **`PickemPickSummaryRefusal` renamed to `PickemSettingsEditorRefusal`** with
   three stale comments corrected — orchestrator fixes applied inline before
   D1 was accepted (review finding 1).

### Notes on execution

- **Parallelism re-check.** D2 was kept as one deliverable on the prediction
  that splitting create-form from settings-editor would collide. Checked
  against the real diff: both halves land in one contiguous hook block in
  `apps/web/src/api/pickem.ts` and on the single `PickemSettingsFields`
  signature in `league-settings-fields.tsx` — the same lines, not merely the
  same files. The prediction holds. D1 → D2 sequencing was likewise real: D2's
  hooks do not typecheck until D1's regenerated client exists.
- **Evidence harness.** AC6–AC8 were captured by a temporary Playwright spec
  driving the isolated e2e stack (`picksleagues_e2e`, ports 5273/3100), seeding
  a 2099 season with two regular and two postseason weeks and moving the
  **simulated clock** across them — never by editing kickoff timestamps. The
  harness was deleted after capture so it does not join the merge gate; the
  server behavior it screenshots is permanently pinned by the committed
  integration suite. The dev database was deliberately left untouched.
- **Guardrail encounter.** The runbook's session-minting recipe
  (`tsx --env-file=../../.env`) was blocked by the live-secret guard. Rather
  than route around it, the evidence moved to the e2e harness, which loads the
  environment inside its own process and never exposes a secret to the agent.
  No guardrail was weakened and no `.env` was read.
