# Feedback: Leagues epic (LG)

Rounds of human feedback during and after the Leagues epic, and how each item was
resolved. Conventions in `docs/feedback/README.md`.

## Round 1 — code review of the Leagues epic (2026-07-22)

13 items, all resolved; several became standing engineering rules.

| Item | Resolution |
| --- | --- |
| Shared route response descriptors | Extracted `apps/api/src/lib/route-responses.ts` (`ea9e142`) + rule |
| Error-slug magic strings | `ERROR_CODE` const set in `packages/schemas` (`ea9e142`) + rule |
| Single-error `!result.ok` mapping / 500 story | Answered: typed refusals map explicitly; anything thrown is a bug → logged JSON 500 via `app.onError`. Evaluator found Hono's own `HTTPException` 400s were being masked as 500s — fixed with a pass-through (`0db3c91`) + rule |
| Deps-guard boilerplate | `requireSession`/`requireDbAndClock` middleware (`ea9e142`) + rule |
| JSONB settings stability | Answered + rule: settings evolve additively with Zod `.default()` or ship a data migration |
| Capacity check after join insert | Answered: intentional — count-after-write inside the tx is the race-safe form |
| Repeated unique-violation unwrapping | Shared `isUniqueViolation` in `packages/db` (`c665de2`) + rule |
| Test ops outside transactions | Answered: fine for fixtures; correctness-bearing paths test the real tx |
| Test setup extraction | `makeTestEnv`/`makeLeagueTestHarness`/`withCookie` (`7ed133e`) |
| Domain organization | `services/leagues/` folder split with barrel (`c665de2`) |
| Large UI files | League home split into `components/league/*` (`1f80c78`) |
| TanStack Form exception in create wizard | Answered: accepted deviation (enum/stepper state, single submit-time parse) — user approved keeping it |
| Per-mode UI sections UX | Answered: shared shell + per-mode fieldsets; modes stay one product |

Harness follow-up (user asked how to prevent recurrence): rule-of-three dispatch
counterweight, `/simplify` epic close-out, evaluator standing checks, `max-lines`
lint (`a20d14b`).

## Round 2 — first app usage (2026-07-22)

6 items after actually using the app.

| Item | Resolution |
| --- | --- |
| Inconsistent page widths | Shared `max-w-5xl` column in the authed shell; padding normalized (`f706e3c`, `0ef3e90`) |
| No way home; wordmark dead | Wordmark is a link (`f706e3c`) |
| Selects show raw enum when closed | Base UI `items` prop on all Select call sites (`f706e3c`) |
| Numeric inputs fight typing | `NumberField` string-draft rework (`f706e3c`) |
| "Start week has already begun" in July | Data, not code: local DB only had NFL 2024. Ingested 2026 via the sync job; offseason gotcha documented in `docs/runbooks/jobs.md` (`d86e74d`) |
| `db:studio` command | Added (`d86e74d`) |

## Round 3 — layout, caps, dark mode, tabs (2026-07-22)

12 items. Human decisions: league page → routed tabs; no roles on invites.

| Item | Resolution |
| --- | --- |
| Layout consistency guide | "One page skeleton" rule in `engineering.md` (`779ec3c`) |
| −1 picks per week accepted | Server bounds existed all along (1–16; MM brackets 1–10). Real bug was the number field silently clamping — now inline range errors, submit gated, blur restores unparsable drafts (`f7e4476`, `1644dd5`) |
| Season-pull runbook | Already shipped in round 2 (`docs/runbooks/jobs.md`) |
| Tabs vs single page | Routed Overview/Members/Settings tabs (`b032a0d`) |
| Revoked invites visible | Filtered out server-side (`e74c80d`) |
| League cards not obviously clickable | Stretched-link cards (`6d9cc94`) |
| Roles on invites? | Decided no (bearer-link escalation risk); TS-4 records the safe future shape |
| No path to discovery | Home/Discover header nav (`6d9cc94`) |
| All buttons show "Saving…" | Async-button standard: disable in place, scope per action instance, no label swaps (`779ec3c`, `d19f413`, `1644dd5`) |
| Commissioner-set max members | `max_members` column (2–100), create/edit/join/preview enforcement under the league row lock (`e74c80d`, `f7e4476`) |
| Dark mode | Light/Dark/System toggle, persisted, FOUC-safe (`6d9cc94`); LNCH-6 sweep still open |
| Reporting / notifications / kick reason | `backlog/10-trust-safety.md` TS-1…TS-4 |

## Round 4 — settings UX, navigation, discovery filters (2026-07-23)

11 items. Human decision: settings → single-save form.

| Item | Resolution |
| --- | --- |
| Keep a feedback log | This file; `/feedback` appends each round at close-out |
| Exhausted invites visible | Hidden from the list alongside revoked (`91205b6`) |
| Single save vs per-section saves | Single-save form: dirty-tracked, one PATCH of changed fields; failed saves keep the draft (`ff283de`) |
| Settings visible to members | Read-only settings view for every member (inputs disabled, no Save) (`ff283de`) |
| Leave league placement | Agreed — moved to the Members tab; danger zone is delete-only (`ff283de`) |
| Google button illegible in dark mode | Outline variant's `dark:` classes beat the brand classes; equal-specificity `dark:` overrides added (`732a1d7`) |
| "API: up" on login | Removed; smoke e2e asserts `/api/health` directly (`732a1d7`) |
| Discovery shows joined/full leagues | Excludes the caller's leagues and leagues at their cap, server-side (`91205b6`) |
| League switcher in navbar | Dropdown listing my leagues; current league shown + highlighted on league pages (`732a1d7`) |
| Mobile navigation | Hamburger → left drawer (Base UI sheet); desktop nav unchanged (`732a1d7`) |
| Max members default | 10 (settable 2–100, helper text on create + edit); DB default migration (`91205b6`, `ff283de`) |

## Round 5 — dev ergonomics + polish (2026-07-23)

4 items (one added mid-round). Declared the last UX-focused round for this epic.

| Item | Resolution |
| --- | --- |
| API lingers on :3000 after local runs | Two layers: dev.ts closes the server on SIGINT/SIGTERM (2s hard-exit fallback), and a `predev` sweep TERM-kills stale listeners on 3000/5173 before `pnpm dev` (a stale 5173 would silently shift vite and break the pinned OAuth origin) (`69dd5e5`) |
| Split the feedback log per epic | `docs/feedback/` — one file per epic mirroring `backlog/` naming; `/feedback` appends to the epic's file |
| Lock-explainer copy shown to non-editors | Renders only for members who can edit (`6e516c5`) |
| "Leagues" nav highlight on create page | Switcher trigger highlights across the whole `/leagues` subtree; mobile "Create league" became a real Link with active state (evaluator caught the first attempt's highlight being defeated by unmerged Tailwind classes — fixed with the sibling drawer-row idiom) (`6e516c5` + fix) |
