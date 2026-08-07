# [EXECUTION PLAN] — ADM-3

_Work package: ticket **ADM-3** (`backlog/04-simulator-admin.md`). The ticket
line is the stable contract; this file is the technical plan and never amends
it._

_Recorded by `/atlas-plan`, 2026-08-07. Status: **draft — awaiting owner
approval** (`docs/plans/README.md`: drafts require owner approval).
Amended 2026-08-07 at the owner's request: the audit view is offset-paginated
(D5, D6, D8, AC1b, AC5b) rather than capped at one 200-row page — this is a
post-review change to the reviewed text, and it *widens* the delivered surface
by resolving red-team finding 6 rather than relaxing a constraint the review
relied on, so it does not re-open the review.
Red-team review: **required and completed 2026-08-07** per the risk-gated
policy in `docs/agents/planning.md` — the plan touches the settlement/recompute
path (an audit write inside the rebuild's transaction) and reasons about lock
semantics (the detection query re-expresses `unlocked ∧ outcome-knowable` in
SQL). Verdict: no blocking findings; the eight advisories and their
dispositions are recorded at the end of this file, and the plan text below
already incorporates them. Run surface: **local only**. Verification commands
and evidence policy: `docs/agents/testing.md`; evidence root
`docs/evidence/test-results/adm-3/` (per-work-package, never cleared).
The ticket stays `[ ]` — claiming (`[ ]` → `[~]`) happens when
`/atlas-implement ADM-3` is invoked, which is the approval to claim
(`docs/agents/issue-tracker.md` §Exception — Atlas execution)._

## Intent

ADM-2 shipped the `admin_audit` table and the override's audit write; three
things remain, and they are this ticket's whole scope:

1. **An audit view on the admin page** over `admin_audit` — who, what, when,
   prior value (arch §Manual Sports Data Overrides: "who, what, when, previous
   value"; the `ADMIN_AUDIT_ACTION` doc comment in
   `packages/schemas/src/admin-audit.ts` already names ADM-3 as the surface
   that serializes it on the wire).
2. **Auditing the one remaining admin action that mutates derived state** —
   `POST /admin/leagues/:id/rebuild`. Its `ADMIN_AUDIT_ACTION` member and
   prior-value shape are the design call ADM-2 deliberately left open
   (engineering rules §Data: "Rebuild auditing is still owed (ADM-3): a rebuild
   runs outside a transaction and its 'prior value' needs a definition before
   it can be recorded honestly"). This plan makes that call (Decisions below)
   and resolves the engineering-rules sentence in the same change.
3. **Surfacing `unlocked ∧ outcome-knowable` games** — detection + repair, not
   admission control. The override guard (ADM-2) proves by induction that no
   admin request creates the state, but two routes still reach it without any
   admin fault (a provider bug, or an allowed later-kickoff override followed
   by `sync-scores` writing the final score off the **provider** kickoff), and
   ingestion must never fail on account of a correction, so it cannot consult
   the guard. The repair already exists: the guard's carve-out keeps a
   violating row fully editable through the override form, so detection links
   there.

## Facts the plan rests on (surveyed 2026-08-07)

- **`admin_audit` exists and needs no migration.** `packages/db/src/schema/admin.ts`:
  `action` and `target_table` are `text` columns typed by
  `$type<AdminAuditAction>` / `$type<AdminAuditTargetTable>`, so new members of
  either const set are schema-invisible. `prior_value` is JSONB precisely so a
  new action's prior-value shape needs no migration. Append-only; `createdAt`
  comes from the injected Clock, never a DB default.
- **The rebuild path is shared and transactional.** `rebuildLeagueSeason`
  (`apps/api/src/services/pickem/settlement.ts`) delegates to
  `settleLeagueSeasonWeeks`, which owns one transaction opened with
  `lockLeagueSeasonRow`. Its callers: the admin route (`routes/admin.ts` —
  the only one that must audit), `settleSweep` (nightly + admin sweep button),
  `settlePicksForGames` (ingestion), and the sim step-through
  (`services/sim/settle.ts`) — none of which may write audit rows. A
  non-Pick'em or unknown season short-circuits to `EMPTY_SUMMARY` **before**
  the transaction opens.
- **Override precedence has one home** (`apps/api/src/services/games.ts`):
  `resolveGameOverrides` for rows in hand, `effectiveKickoffAtSql` for SQL
  clauses that must agree with it — the detection query's status/score
  coalesces belong beside it, not restated in a service.
- **Lock semantics:** `isLocked(effectiveKickoffAt, now)` in
  `services/slate.ts`; the override guard's predicate is
  `!isLocked(...) && (isStartedStatus(status) || homeScore !== null || awayScore !== null)`
  (`services/admin-overrides.ts`). `STARTED_GAME_STATUSES` is module-private in
  `packages/schemas/src/game-status.ts` today; the SQL form needs the values,
  so the array gets exported rather than restated.
- **Admin browsers pattern:** read-only queries live in
  `services/admin-data.ts`; wire shapes in `packages/schemas/src/admin-data.ts`
  (`AdminGame` carries provider, override, and resolved blocks side by side);
  routes in `routes/admin.ts` behind `requireSession` + `requireAdmin`, with
  `requireDbAndClock` scoped per-path; SPA bindings in `apps/web/src/api/admin.ts`
  under `ADMIN_QUERY_KEY_PREFIX` (so the sync-job invalidation fan-out covers
  new queries for free); sections are deep-linkable routes off the admin shell's
  `TabNav` (`routes/_authed/admin/route.tsx`), which owns the `isAdmin` guard.
- **The games browser deep-links by week**: `/admin/games?weekId=…`
  (`routes/_authed/admin/games.tsx`), and `AdminGame.weekId` is on the wire —
  an anomaly row can link straight to the slate holding its override editor.
- **Identity on the wire:** `users.display_name` is non-null,
  `users.username` (citext) is nullable; league members serialize
  `{ displayName, username }` and render through `UserIdentity`
  (engineering rules: never a bare email on a league-facing surface — an admin
  is a user like any other here).
- **Display rule for audit instants** (spec §UI, line on relative time):
  "settled kickoffs, 'last updated' stamps, and audit rows keep the precise
  instant" — the audit view shows absolute local-timezone stamps, not
  `useAppNow()`-relative labels.
- **Existing coverage to extend:** `apps/api/test/admin-overrides.test.ts`
  already asserts the override's audit row and has the seed/auth helpers
  (`grantAdmin`, `seedPickemLeague`, `setGame`, …) this ticket's tests need.

## Decisions (within-ticket authority; the ticket delegates them to ADM-3)

**D1 — Rebuild audit action and target.**
`ADMIN_AUDIT_ACTION.LEAGUE_REBUILD = "league_rebuild"`;
`ADMIN_AUDIT_TARGET_TABLE.LEAGUE_SEASONS = "league_seasons"`;
`targetId` = the league-season id the rebuild recomputed (the route already
resolves the league's **current** instance, ADR-0009). The league season is the
row whose derived state is wiped and recomputed, and per-mode sibling tables
(ELM, MM) will hang off the same target without a new vocabulary.

**D2 — Prior value of a rebuild = a summary of the derived state about to be
wiped, captured inside the rebuild's own transaction.** Shape:

```json
{
  "resultCount": 123,
  "standingsRowCount": 45,
  "lastSettledAt": "2026-09-20T00:00:00.000Z" | null,
  "lastStandingsUpdatedAt": "…" | null
}
```

Rationale — this is the "definition before it can be recorded honestly" the
engineering rules asked for: the full prior rows are hundreds of rows of
derived state, and arch D10 already defines them as recomputable from
(picks, results, settings) — *at the prior inputs*. What a rebuild's audit must
answer is "what stood there before, and when had it last settled", and counts +
last-write instants answer exactly that at constant size. Captured under the
league-season lock, **before the first delete, in the same transaction** — the
same discipline as the override audit (an audit row for a rebuild that rolled
back, or a rebuild that committed unaudited, are both worse than the request
failing). The engineering-rules sentence "a rebuild runs outside a transaction"
predates reading the code: `settleLeagueSeasonWeeks` runs one transaction, so
same-transaction auditing is available and taken; the rules text gets resolved
accordingly (step 7).

**D3 — Audit write placement: an optional `audit` parameter threaded through
the shared path, not a wrapper.** `rebuildLeagueSeason(db, clock, leagueSeasonId,
audit?: { adminUserId: string })` forwards to `settleLeagueSeasonWeeks(…,
audit?)`, which — only when `audit` is present — captures the D2 summary and
inserts the `admin_audit` row inside its transaction. Sweep, ingestion, and sim
callers pass nothing and stay unaudited (they are jobs and non-prod tooling,
not admin actions; the nightly sweep auditing every season every night would
bury the trail the view exists to read). A wrapper that audits in its own
transaction was rejected: it either breaks the same-transaction guarantee or
duplicates the transaction/locking structure.

**D4 — A rebuild that has no settleable target writes no audit row.**
Unknown league → 404 before the job runs. A non-Pick'em league's rebuild
short-circuits to a zero summary without opening a transaction: nothing was
mutated, so there is nothing to audit, and the job envelope already reports
`leagueSeasons: 0` to the operator.

**D5 — Audit list endpoint: `GET /admin/audit?limit=&offset=`**, paginated,
newest-first (`createdAt` desc, `id` desc as a stable tiebreak). `limit` coerced
int 1–100 default **25**; `offset` coerced int ≥ 0 default 0. The response
carries `total` alongside the page so the view can say "Showing 26–50 of 173"
and disable Next on the last page. (Amended 2026-08-07 at the owner's request,
which also closes red-team finding 6: the whole trail is now reachable from the
view, and a page is small enough to actually read.)

**Offset, not cursor.** The operator's question is "page through what happened",
and offset is the only form that answers "how much is there" and "which page am
I on" — a cursor gives neither without a separate count query anyway, and buys
its correctness advantage against a writer this table doesn't have. Offset's
known weakness is skew when rows are inserted between page reads; `admin_audit`
is written only by an admin performing an override or a rebuild, i.e. the same
person reading the view, who is not mutating the league mid-page-turn. Count and
page run as two queries in one request handler (not one windowed query — the
count is over the whole table, the page is over a slice, and `count(*) OVER ()`
would tie the total's correctness to the page's `where`). Still no index
migration: seq scan of a solo admin's correction log, and adding one later is
additive with no code change.

**D6 — Audit entries carry the actor's identity and a best-effort target
label.** Entry shape (`AdminAuditEntry`): `{ id, admin: { displayName,
username }, action, targetTable, targetId, targetLabel, priorValue, createdAt }`.
`targetLabel` is a nullable human string resolved server-side in batch —
`games` → `"AWY @ HOM"`, `league_seasons` → league name + season year — because
a view of bare UUIDs answers "what happened" for nobody; null when the target
row no longer exists (a deleted league keeps its audit rows via the restrict
FK on the actor, not the target). `priorValue` goes on the wire as an untyped
JSON object (`z.record(z.string(), z.unknown())`) — its shape is per-action by
design, and the view renders it as formatted JSON rather than pretending to
type it. The response envelope is `{ entries, total, limit, offset }` (D5) — the
page echoes the params it was served under so the view derives its range label
and Next/Prev enablement from the response, never from what it *asked* for
(a clamped or defaulted `limit` would otherwise silently mislabel the range).

**D7 — Anomaly detection: `GET /admin/games/anomalies`, computed in SQL, reusing
the `AdminGame` wire shape.** Service `listAnomalousGames(db, now)` selects
games where `effective kickoff > now` AND (`effective status ∈
STARTED_GAME_STATUSES` OR an effective score is non-null) — the same predicate
as the override guard's `leavesOutcomeKnowableButUnlocked`, in SQL because the
candidate set is "every game in the database" and loading them all to filter in
TS is the unbounded read the SQL clause avoids. The status/score coalesces are
added beside `effectiveKickoffAtSql` in `services/games.ts` (the one home for
precedence), and `STARTED_GAME_STATUSES` is exported from
`packages/schemas/src/game-status.ts` so the SQL set and `isStartedStatus`
cannot drift. `now` reaches SQL as a bound parameter (arch D13). Response
reuses `AdminGamesResponseSchema` — the anomaly row *is* an admin game whose
provider/override/resolved blocks are exactly what the operator repairs from.

**D8 — Surface: a new "Audit" tab on the admin shell** (`/admin/audit`), two
stacked sections:
- **Integrity card** (first — it is the actionable one): the anomalous games,
  or an explicit all-clear line when empty so the operator knows detection ran.
  Each row shows matchup, effective kickoff, effective status/scores, and a
  link to `/admin/games?weekId=…` — the repair path; the override guard's
  carve-out (ADM-2) already permits every edit on a violating row.
- **Audit log**: absolute local timestamp, actor via `UserIdentity` (compact),
  action label (const map `Record<AdminAuditAction, string>` — no raw literal
  comparisons), target label, and the prior value behind a collapsible
  `<details>`. Table scrolls in its own `overflow-x-auto` container
  (mobile-first). Below it, the pager: a range line ("Showing 26–50 of 173",
  derived from the response envelope) and Previous/Next `Button`s, disabled at
  the ends. Plain buttons, not shadcn's `pagination` component — it is not
  installed, and a numbered page-link row is a poor fit at phone width for a log
  whose only real motions are "older" and "newer".
Page state lives in the route's **search params** (`?offset=`, validated by the
route's `validateSearch`), not `useState`: an admin who deep-links or reloads
mid-trail keeps their place, and the browser Back button steps pages, which is
what a member expects from a pager. `offset` is the only search param — `limit`
stays server-default until someone asks to change it.
Both queries go through `QueryState` and key under `ADMIN_QUERY_KEY_PREFIX`
(the audit key includes `offset`, so each page caches separately and TanStack
Query serves an already-seen page instantly on Back). The audit query sets
`placeholderData: keepPreviousData` so paging swaps rows in place rather than
flashing the table back to skeletons — the skeleton rule is about *data
arriving* for a view that has none, and a pager that blanks the table on every
click loses the operator's scroll position.
No new e2e spec: admin tooling has no member-facing journey, every rule here is
pinnable at the integration layer, and e2e breadth taxes every merge
(engineering rules §Quality "E2E covers journeys, not branches").

## Ordered steps

1. **`packages/schemas`** — in `admin-audit.ts`: add `LEAGUE_REBUILD` to
   `ADMIN_AUDIT_ACTION`, `LEAGUE_SEASONS` to `ADMIN_AUDIT_TARGET_TABLE`,
   register `AdminAuditActionSchema` / `AdminAuditTargetTableSchema`
   (`z.enum(...)`), and define `AdminAuditEntrySchema` /
   `AdminAuditResponseSchema` (D6). In `game-status.ts`: export
   `STARTED_GAME_STATUSES` (doc comment: exported for the SQL form of the
   override guard's predicate — keep in lockstep with `isStartedStatus`).
2. **`apps/api/src/services/games.ts`** — add `effectiveStatusSql`,
   `effectiveHomeScoreSql`, `effectiveAwayScoreSql` beside
   `effectiveKickoffAtSql`, with the same can't-drift comment.
3. **`apps/api/src/services/pickem/settlement.ts`** — thread
   `audit?: { adminUserId: string }` through `rebuildLeagueSeason` →
   `settleLeagueSeasonWeeks`; when present, capture the D2 summary (two
   aggregate selects over `pickem_pick_results` / `pickem_standings`) after
   `lockLeagueSeasonRow` and before the first week's delete, and insert the
   `admin_audit` row in the same transaction. No caller besides the admin
   route changes.
4. **`apps/api/src/services/admin-data.ts`** — `listAuditEntries(db, { limit,
   offset })` returning `{ entries, total }`
   (newest-first, `limit`/`offset` applied; `total` from a separate `count(*)`
   over the whole table, per D5; batch-resolve target labels: one `inArray` over `games` +
   teams aliases for game targets, one join over `league_seasons` × `leagues`
   × `sport_seasons` for rebuild targets — label resolution must be a lookup
   applied to the already-fetched audit rows, **never an inner join that could
   drop a row whose target vanished**: a deleted league's audit rows survive by
   design and render with `targetLabel: null`) and `listAnomalousGames(db, now)`
   (D7, projecting through the existing `selectAdminGameRows`/
   `serializeAdminGame` seam with the anomaly `where`).
5. **`apps/api/src/routes/admin.ts`** — `GET /admin/audit` (query
   `limit: z.coerce.number().int().min(1).max(100).default(25)`,
   `offset: z.coerce.number().int().min(0).default(0)`) and
   `GET /admin/games/anomalies`, both with the shared `browserResponses` and
   `requireDbAndClock` (add `"/admin/audit"` to the middleware path list;
   `"/admin/games/*"` already covers the anomalies path). Pass
   `{ adminUserId: c.get("sessionUser").id }` into `rebuildLeagueSeason` in the
   rebuild handler.
6. **Contract** — `pnpm contract:check` regen; commit `openapi/` with the
   schema change (engineering rules §Contract & codegen).
7. **`.claude/rules/engineering.md`** — resolve the override-precedence rule's
   trailing sentence: rebuild auditing is no longer "owed (ADM-3)"; state the
   delivered rule (rebuild audits in the same transaction as the recompute,
   prior value = the pre-wipe derived-state summary) in one sentence.
8. **`apps/web`** — in `api/admin.ts`: `adminAuditQueryKey(offset)` /
   `useAdminAudit(offset)` (key includes `offset`; `placeholderData:
   keepPreviousData`) and `adminGameAnomaliesQueryKey` /
   `useAdminGameAnomalies()` (plain queries, no toast — failed views don't
   toast). The keys build on `ADMIN_QUERY_KEY_PREFIX`, which is module-private
   — the new hooks live in this same file, so do not export it or split the
   module (splitting would force the export and touch the invalidation
   fan-out). New route `routes/_authed/admin/audit.tsx` (with `validateSearch`
   for `offset`) + `Audit` tab link in `route.tsx`; components
   `components/admin/audit-log.tsx` and `components/admin/game-anomalies-card.tsx`
   per D8.
9. **Tests** — new `apps/api/test/admin-audit.test.ts` (reusing the ADM-2
   helpers); see the verification map. Existing `admin-overrides.test.ts`
   stays untouched.
10. **Evidence + PR** — gates, committed text evidence under
    `docs/evidence/test-results/adm-3/`, phone-width screenshots of the Audit
    tab (populated + all-clear) attached to the PR, feature branch off
    `staging`, `gh pr create --base staging`. The `## Technical plan` pointer
    for ADM-3 in `backlog/04-simulator-admin.md` is added with this plan
    (tracker storage rule, `docs/agents/issue-tracker.md` §Planning artifact
    storage) and updated at closeout.

## Scope

**In:** the files steps 1–9 name, `openapi/` regen, the engineering-rules
sentence, `docs/evidence/test-results/adm-3/`.
**Out (explicitly):** any migration; auditing `settleSweep`, ingestion, sim, or
the settle-sweep admin button (jobs, not admin mutations of a *named* target —
and the sweep is already the repair for a failed post-override resettle);
audit rows for no-op rebuilds (D4); cursor pagination, filtering, or sorting
controls on the audit view (offset paging only, D5); any change to the
override guard, `packages/scoring`, lock or visibility semantics themselves;
new e2e specs; ADR (no locked-doc deviation: arch already names
"override/rebuild actions" in `admin_audit` and the audit view is the ticket's
named scope — the open design calls were delegated to this ticket by ADM-2's
line, and D1–D8 are recorded here plus as code comments citing ADM-3/arch).

## Acceptance criteria → verification map

Evidence root: `docs/evidence/test-results/adm-3/<check>/…` (committed text;
images go on the PR). Earliest meaningful checkpoint for AC1–AC4 is step 9
(integration suite); AC5–AC6 at step 8; invalidators listed per row. All checks
require `pnpm db:up` first where noted.

| # | Criterion (from the ticket contract) | Check | Expected | Evidence | Invalidated by |
|---|---|---|---|---|---|
| AC1 | Audit view lists `admin_audit` rows — who/what/when/prior value, newest first | integration: seed two audit rows (an override via `PUT /admin/games/{id}/override`, a rebuild via `POST /admin/leagues/{id}/rebuild`), `GET /admin/audit` as admin; plus a row whose target row was deleted (delete the league after its rebuild audit row exists) | Both rows, newest first; actor `{displayName, username}`; game row labeled `"AWY @ HOM"`, rebuild labeled with league name; `priorValue` round-trips; the orphaned-target row is **still returned** with `targetLabel: null` (a label join must never drop an audit row) | `admin-audit/vitest.txt` | any change to `listAuditEntries`, the schemas, or the two writers |
| AC1b | The whole trail is reachable by paging (D5) | integration: seed N > default page (e.g. 30 override audit rows), then `GET /admin/audit` (defaults), `?limit=10&offset=10`, and `?offset=` past the end | page 1 holds 25 newest with `total: 30`, `limit: 25`, `offset: 0`; the `limit=10&offset=10` page holds rows 11–20 of the same desc ordering with **no overlap and no gap** against `offset=0`'s first 10 (the `id` desc tiebreak, proven by seeding rows sharing one `createdAt` instant via the injected Clock); past-the-end returns `entries: []` with `total` unchanged, not an error; `limit=0`, `limit=101`, and `offset=-1` → 400 | same file | pagination params, ordering, `total` query |
| AC2 | Audit endpoints are admin-only | integration: `GET /admin/audit` and `GET /admin/games/anomalies` unauthenticated → 401, authenticated non-admin → 403 | 401 / 403 with wire error codes | same file | route/middleware changes |
| AC3 | Rebuild writes its audit row; the design call is closed | integration: rebuild a seeded, settled league → one `admin_audit` row, `action = "league_rebuild"`, `target_table = "league_seasons"`, `targetId` = current season id, priorValue = D2 summary matching pre-rebuild counts; rebuild again → second row whose summary reflects the first rebuild's output; rebuild a non-Pick'em league → no row (D4); run `settleSweep`, `settlePicksForGames`, **and the sim step-through settle** (`settleForSim` — the third unaudited caller, and the one a future signature change could silently flip) → row count unchanged | as stated | same file | settlement threading, D2 shape |
| AC4 | `unlocked ∧ outcome-knowable` games are detected — including the no-admin-fault route | integration: (a) reproduce the ticket's exact sequence — later-kickoff override on a scheduled unscored game (allowed), then score ingestion writes provider final off the provider kickoff → game appears in `GET /admin/games/anomalies`; (b) provider-bug variant (future provider kickoff + provider final score, no override) → appears; (c) ordinary locked final game and ordinary future scheduled game → absent; (d) **boundary instant** — a knowable-outcome game whose effective kickoff equals `clock.now()` exactly → absent (`isLocked` is `<= now`, so the SQL must be strictly `>` — a `>=` passes every other case here); (e) repair — kickoff override moved into the past → disappears (and the edit is *accepted* on the violating row, re-proving the carve-out is the repair path) | as stated | `anomalies/vitest.txt` | `listAnomalousGames`, the SQL helpers, `STARTED_GAME_STATUSES`, the guard |
| AC5 | Audit tab renders on the admin page; invisible to non-admins | web build + manual drive: `pnpm dev`, admin session (verification runbook), perform one override + one rebuild, open `/admin/audit` at phone width; non-admin sees "Page not found" (existing shell guard — no new logic, verified by the shell's behavior on the new child route) | tab shows integrity card + log; absolute timestamps; prior value expandable | screenshots on the PR (populated + all-clear); drive transcript in `ui-drive/transcript.md` | any web change |
| AC5b | The pager works as a member expects | manual drive, continuing AC5 against a trail longer than one page (repeat overrides to exceed 25 rows): click Next, then browser Back; reload on page 2 | range line reads "Showing 26–50 of N" from the response; Previous disabled on page 1 and Next on the last; `?offset=` appears in the URL and Back returns to page 1; a reload on page 2 lands on page 2; rows swap without the table blanking to skeletons | screenshot of page 2 on the PR; noted in `ui-drive/transcript.md` | route search params, the query key, `keepPreviousData` |
| AC6 | SPA consumes only the generated client; contract committed | `pnpm contract:check` | clean | `gates/contract-check.txt` | any schema/route change |
| DoD | Gates | `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration && pnpm format:check && pnpm --filter @picksleagues/web build && pnpm test:e2e` (db up; e2e is the merge gate and self-hosts its stack) | all green | `gates/*.txt` | any change |

Fixtures: all seeded per-test through the existing helpers against the
auto-created `picksleagues_test` DB (integration) — no external provisioning;
`resetDb` between tests is the cleanup. The manual drive uses the dev stack and
dev DB (additive writes only: one override, one rebuild — no reset needed).

Human gates: **plan approval** (this draft; prerequisite: owner reads it;
action: approve or amend; post-check: `/atlas-implement ADM-3` proceeds against
the approved text). No deployment gate — run surface is local; staging arrives
via the normal PR → `staging` promotion.

## Repository-specific considerations (`docs/agents/planning.md` table)

- **Locked docs:** no deviation — see Scope. The spec's audit-instant display
  rule and arch's `admin_audit` definition are implemented, not amended.
- **Clock:** the anomaly query and audit `createdAt` read the injected Clock;
  `now` is a bound parameter; the SPA's audit timestamps are absolute (spec),
  so no `useAppNow()` dependency is introduced.
- **Zod/route changes:** contract regen in the same change (step 6); no
  inline `.nullable()` on registered components — `targetLabel` and the
  nullable identity field reuse the established pattern (own registration only
  where a shared component would be wrapped; plain object fields here).
- **Auth/audit surface:** admin-only via the existing `requireSession` +
  `requireAdmin`; no privilege change; the audit view *is* the audit-impact
  surface. No job-endpoint changes; jobs stay unaudited by design (D3).
- **DB:** no migration (see Facts).
- **UI:** mobile-first, roles/names bindings only (no new e2e, but the manual
  drive verifies at phone width), `QueryState`, theme tokens, `UserIdentity`.
- **Craft-debt flag (for the owner, not silently absorbed):**
  `services/admin-data.ts` grows toward ~300 lines with two more queries; fine
  for now, but a future admin read likely warrants splitting the audit reads
  into their own module.

## [RED TEAM] — completed 2026-08-07

Independent `atlas-red-team-reviewer`, given only the fixed ticket line, this
draft, and repository paths. **Verdict: no blocking findings.** It verified the
plan's factual claims against the code (single transaction under
`lockLeagueSeasonRow`; the four rebuild callers; half-open `isLocked`; the
nullable-field pattern; the shell's not-found guard; helper/test/coercion
precedents) and confirmed the absence of: double-audit, audit-on-rollback,
lock-order deadlock (override tx locks `games`, rebuild tx locks
`league_seasons`, audit insert takes only an FK key-share on `users`), sim/
sweep/ingestion audit leakage, `.nullable()` registration traps, route-matching
conflicts, predicate drift on postponed/cancelled/score-null states, and
locked-doc deviations.

Advisories and dispositions (all folded into the plan text above):

1. Tracker pointer writeback was unplanned → added to step 10; pointer added
   with this draft.
2. Header claimed the review was already performed while the section was
   empty → header now states completed with dispositions recorded.
3. AC3's negative set omitted the sim caller → `settleForSim` added.
4. Null-`targetLabel` (deleted target) branch untested → AC1 now seeds it and
   step 4 forbids the inner-join-drops-row failure it would mask.
5. No boundary-instant case for the strictly-`>` unlock predicate → AC4(d)
   added.
6. D5's 200-row cap quietly narrows "audit view over the table" → **resolved
   2026-08-07, after the review**: the owner chose paging over a cap, so D5 is
   now offset-paginated (25/page, `total` on the wire) and the whole trail is
   reachable from the view. The sign-off this advisory asked for is no longer
   needed; AC1b and AC5b pin the behavior.
7. Facts misattributed the ADM-3 comment's file → corrected
   (`packages/schemas/src/admin-audit.ts`, not the DB schema file).
8. `ADMIN_QUERY_KEY_PREFIX` is module-private → step 8 now says keep the new
   hooks in `api/admin.ts` and don't export or split.

## [EXECUTION PLAN] — orchestration (`/atlas-implement`, 2026-08-07)

Repository delivery `picksleagues`: base `staging` @ `ec85ec7`, branch
`feat/adm-3-audit-view`, worktree
`.claude/worktrees/adm-3/picksleagues`.

**Isolation — worktree, not direct checkout.** The main checkout sits on
protected `staging` and carries a *peer session's* uncommitted ELM planning
artifacts (`docs/plans/elm.md` and a pointer edit to
`backlog/06-elimination.md`). Committing from it would either sweep that work
into this PR or require disturbing another session's index.

**Structure — sequential, three deliverables, one worker each, one branch.**
Parallelism is rejected on file-ownership grounds. The predicted collisions,
named rather than asserted (re-checked against the real diffs at closeout):

- `packages/schemas/src/admin-audit.ts` — W1 adds const members, W2 adds the
  entry/response schemas.
- `apps/api/src/routes/admin.ts` — W1 edits the rebuild handler; W2 and W3 each
  register a new route.
- `apps/api/src/services/admin-data.ts` — W2 and W3 each add a query.
- `apps/web/src/api/admin.ts` and `routes/_authed/admin/audit.tsx` — W2 creates
  both, W3 adds to both.
- `openapi/` — W2 and W3 both regenerate. This one conflicts *by construction*
  rather than by hunk: it is a generated artifact, so two independent regens off
  the same base produce competing whole-file outputs.

W2 additionally has a real dependency on W1: its AC1 fixture seeds a rebuild
audit row, which needs W1's `LEAGUE_REBUILD` member to exist.

| # | Deliverable | Plan steps | Criteria | Wire change |
|---|---|---|---|---|
| W1 | Rebuild auditing | 1 (const members only), 3, 5 (rebuild handler), 7 | AC3 | none — `ADMIN_AUDIT_ACTION` is not yet serialized, so no `openapi/` regen |
| W2 | Audit endpoint + paginated view | 1 (entry/response schemas), 4 (`listAuditEntries`), 5 (`GET /admin/audit`), 6, 8 (route, hooks, log, pager) | AC1, AC1b, AC2 (audit), AC5, AC5b | yes |
| W3 | Anomaly detection + integrity card | 1 (`STARTED_GAME_STATUSES`), 2, 4 (`listAnomalousGames`), 5 (`GET /admin/games/anomalies`), 6, 8 (card) | AC4, AC2 (anomalies) | yes |

Step 9 is not a deliverable — each worker owns the tests and evidence for its
own slice. Step 10 is orchestrator closeout.

**Model placement:** `atlas-worker` on the session model for all three. Each
packet spans schema → service → route → UI against an extensive
`.claude/rules/engineering.md`, and convention drift on that surface costs more
in review than a cheaper worker saves; W1 additionally places a write inside an
existing transaction under a row lock.

**Evidence:** workers return raw verification output as text; the orchestrator
writes it beneath `docs/evidence/test-results/adm-3/` on acceptance (committed
text; images to the PR, per `docs/agents/testing.md`).

## [AI CODE REVIEW] — 2026-08-07, integrated branch `d2b0d40`

Single formal review, performed by the frontier orchestrator over the complete
repository diff (`ec85ec7..d2b0d40`). Worker reports and the per-deliverable
acceptance screens are context, not this review.

### Axis 1 — technical implementation and spec conformity

Conforms to the ticket line, to D1–D8 as approved (including the owner's
pagination amendment), and to arch §Manual Sports Data Overrides. Every AC has
an evidence-backed verdict in the map below. Specifically checked and found
correct:

- **The audit write is inside the recompute's transaction**, after
  `lockLeagueSeasonRow` and before the first delete, so a rolled-back rebuild
  leaves no row and a committed one is never unaudited. The three non-admin
  callers (`settleSweep`, `settlePicksForGames`, `settleForSim`) pass no `audit`
  and are pinned silent by a test that first proves each of them *did* settle
  the season — a row-count assertion that would otherwise pass vacuously.
- **The engineering rule that said "a rebuild runs outside a transaction" was
  stale against the code** and is corrected in the same change rather than left
  to contradict it.
- **Label resolution cannot drop an audit row.** The only join in the list query
  is on `users` (restrict FK, accounts anonymized in place); target labels are a
  `Map` lookup applied after the page is fetched, and the orphaned-target case
  is seeded and asserted rather than argued.
- **The anomaly predicate is strictly `>`**, matching `isLocked`'s `<= now`, and
  the boundary is tested in both directions (`now` absent, `now + 1ms` present)
  — the one case a `>=` would get wrong while agreeing everywhere else.
- **No predicate is restated.** The coalesces come from `services/games.ts`, the
  status set is exported from `packages/schemas` rather than copied, and `now`
  reaches SQL as a bound parameter.

### Axis 2 — coding standards (`CLAUDE.md`, `.claude/rules/engineering.md`)

No unresolved blocking findings. Adjudicated:

| # | Finding | Disposition |
|---|---|---|
| 1 | `recordRebuildAudit` is non-exported but carries a `/** */` comment, where the comment-form rule prescribes `//` | **Accepted, no change.** `settlement.ts` uses `/** */` on *every* non-exported function (`loadSettleableSeason`, `loadWeekInputs`, `settleWeekResults`, `rebuildStandings`, `weeksWithPicks`), verified by reading the file. The rule's stated failure — editors surfacing only `/** */` at a call site — is about exports; "match surrounding code" governs here, and a lone `//` would be the inconsistency. |
| 2 | `QueryState` gained an optional `pendingFallback`, a shared component outside the deliverable's file set | **Accepted.** The skeleton rule requires loading views to wait behind skeletons *through* `QueryState`, which had no way to render them; hand-rolling them beside it is the drift that rule exists to prevent. Additive and defaulted, so no existing call site changes behaviour. |
| 3 | `offset` generates as `number \| null` in the client, `limit` does not | **Advisory, left as specified.** `z.coerce.number().int().min(0)` genuinely admits `null` (`Number(null) === 0` passes `min(0)`); `limit`'s `min(1)` rejects it. Honest rather than wrong — a query string cannot carry a literal null — but a caller passing `null` would type-check and then 400. Not the `.nullable()`-registration trap: the `openapi/` diff is purely additive and `components.schemas.Username` is unchanged. Worth revisiting if a second offset-paginated endpoint appears. |
| 4 | `total` and the page are two queries, so they could disagree under a concurrent writer | **Accepted.** The only writer is the admin reading the view. A window function would tie the total's correctness to the page's `where`, which is worse. |
| 5 | `services/admin-data.ts` is now ~360 lines | **Deferred, already flagged.** The plan records this as craft debt for the owner; a further admin read likely warrants splitting the audit reads into their own module. |
| 6 | The anomalies query is not refetched when the simulated clock moves | **Advisory.** It sits under `ADMIN_QUERY_KEY_PREFIX`, so sync-job invalidation covers the ingestion route into this state; a clock jump under the simulator leaves it stale until refetch. Diagnostic surface, not a product claim. |
| 7 | `validateSearch` throws on a malformed `?offset=abc` rather than falling back to page one | **Advisory.** Reachable only by hand-editing the URL, and consistent with the other admin routes' search validation. |

Findings 3, 6, and 7 are recorded rather than fixed: each would change a shape
the plan pinned or a precedent the repo already sets, and none affects a
delivered criterion.

## [CLOSEOUT] — 2026-08-07

Delivered on `feat/adm-3-audit-view`, base `staging` @ `ec85ec7`. Evidence root
`docs/evidence/test-results/adm-3/` (committed text; images on the PR).

### Deliverables

| # | Deliverable | Commit | Worker |
|---|---|---|---|
| W1 | Rebuild auditing | `263405f` | `atlas-worker`, session model |
| W2 | Audit endpoint + paginated view | `8696b2b` | `atlas-worker`, session model |
| W3 | Anomaly detection + integrity card | `d2b0d40` | `atlas-worker`, session model |

### Verdicts

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| AC1 | Audit view lists rows — who/what/when/prior value, newest first, orphaned target kept with `targetLabel: null` | **PASS** | `admin-audit/vitest.txt` (13 tests) |
| AC1b | The whole trail is reachable by paging; no overlap, no gap; past-the-end is an empty page; bad params 400 | **PASS** | `admin-audit/vitest.txt` |
| AC2 | Both new endpoints are admin-only (401 / 403) | **PASS** | `admin-audit/vitest.txt`, `anomalies/vitest.txt` |
| AC3 | Rebuild writes its audit row; sweep, ingestion and sim stay silent; no row for a no-op rebuild | **PASS** | `admin-audit/vitest.txt` |
| AC4 | `unlocked ∧ outcome-knowable` games detected, including the no-admin-fault route and the boundary instant | **PASS** | `anomalies/vitest.txt` (6 tests) |
| AC5 | Audit tab renders; invisible to non-admins | **PASS** | `ui-drive/transcript.md` (390px drive; signed-out visit redirects to sign-in with zero audit headers present) |
| AC5b | Pager: range line, disabled ends, URL, Back, reload, no re-skeleton | **PASS** | `ui-drive/transcript.md` |
| AC6 | SPA consumes only the generated client; contract committed | **PASS** | `gates/contract-check.txt` |
| DoD | `typecheck`, `lint`, `format:check`, `test`, `test:integration`, web build, `test:e2e` | **PASS** | `gates/static-checks.txt`, `gates/suites.txt`, `gates/e2e.txt` (13 passed, **0 skipped** — checked, because a failed dependency project reports the merge-gate journey as skipped rather than run) |

Integration suite moved 529 → 544 tests; unit suite unchanged at 462.

### Deviations and notes

- **D5 was amended before implementation** at the owner's request: offset
  pagination (25/page, `total` on the wire) instead of a single capped page.
  This resolved red-team finding 6 rather than relaxing a reviewed constraint.
- **The engineering rule asserting a rebuild runs outside a transaction was
  stale** and is corrected in this change.
- **`QueryState` gained an optional `pendingFallback`** — a shared component
  outside the planned file set, accepted so the skeleton rule could be met
  through the shared component rather than beside it.
- **No migration, no ADR, no new e2e spec**, exactly as scoped.
- Three advisories are recorded unfixed in the review above (nullable `offset`
  in the generated client; the anomalies query not refetching on a simulated
  clock jump; `validateSearch` throwing on a hand-mangled `?offset=`).
- **Verification environment:** the UI drive ran against a throwaway database
  created and dropped inside the run, never the dev database, and never read the
  live `.env`. `pnpm test:e2e` required a `.env` in the worktree, which a human
  supplied — the one human gate in this run.
