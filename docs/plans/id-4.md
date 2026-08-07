# ID-4 — Member-set profile image

Work package: **ID-4** (`backlog/01-identity.md`). Base: `staging` @ `497c6d6`.
Branch: `feat/id-4-member-set-avatar`. Run surface: **local only**.

## Context

A user should be able to point their avatar at an image URL of their own from the profile
screen, falling back to the OAuth-provided one when unset. Today `users.image` holds the
provider avatar and nothing in the app writes it except account deletion.

The ticket named three questions to settle while planning. All four decisions below are the
owner's, taken during planning on 2026-08-07.

## Decisions

1. **ADR + spec edit ship with the code.** `docs/mvp-spec.md` §Users & Identity reads "Avatar:
   pulled from the OAuth provider; no custom uploads." That is a locked-doc deviation, so
   **ADR-0022** plus the reconciling spec edit land in this work package.
2. **Validation is any `https:` URL, ≤2048 chars.** No host allowlist, no server-side HEAD
   check. An allowlist needs maintaining and stops nothing — every allowlisted CDN serves
   user-uploaded bytes by definition. A fetch check is TOCTOU by construction and turns a
   member-supplied URL into an SSRF vector out of our own egress.
3. **Ship it; file TS-5.** Avatar moderation/reporting goes to `backlog/10-trust-safety.md`
   for when that epic starts. The IP-leak and content-swap tradeoffs are recorded in ADR-0022.
4. **`users.image` stays provider-owned.** The member value lives in a new nullable
   `users.image_override`; reads resolve `image_override ?? image`, matching the repo's
   `override_* ?? provider_*` convention (`packages/db/src/schema/sports.ts:154`). Better
   Auth's `/api/auth/update-user` accepts `z.record(z.string(), z.any())` and writes `image`
   verbatim, so a value stored there is reachable by a route our validation never sees.
   **Not** shipping `disabledPaths: ["/update-user"]` — the residual (that route can still
   rewrite the caller's own provider-*fallback*) is recorded in the ADR instead, which keeps
   the existing live-route `app_role` guard test intact.

## Technical plan

### Schemas — `packages/schemas`

New `src/image-url.ts`, sibling of `username.ts` / `display-name.ts` (one schema, one
`.openapi()`, one exported type):

```ts
export const ImageUrlSchema = z.url({ protocol: /^https$/ }).max(2048).openapi("ImageUrl");
```

Barrel-export from `src/index.ts` in alphabetical position.

`src/me.ts`:

- Non-exported `NullableImageUrlSchema = ImageUrlSchema.nullable().openapi("NullableImageUrl")`
  beside `NullableUsernameSchema` — engineering.md §Contract & codegen forbids an inline
  `.nullable()` on a registered schema.
- `MeResponseSchema` carries **both**: `image` (`z.string().nullable()`) becomes the *resolved*
  value — the provider's string is not ours to validate — and new `imageOverride:
  NullableImageUrlSchema` is the member's raw value. Both are required: `image` alone cannot
  distinguish "unset, inheriting" from "set to the same URL", so an untouched save would
  promote the provider URL into the override and clearing would be inexpressible. No
  `providerImage` field — `image` already shows what clearing reverts to.
- `UpdateMeRequestSchema` gains `imageOverride: NullableImageUrlSchema.optional()`. Absent
  leaves it alone, an https URL sets it, `null` clears it.
- The `.refine()` must lose its hardcoded field disjunction:
  `Object.values(data).some((value) => value !== undefined)`. A truthiness check silently
  rejects the clear. Update the message off its "of username or displayName" wording.

`LeagueMemberSchema`, `PickemStandingsRowSchema`, `PickemMemberPicksSchema` are **unchanged** —
their `image` silently becomes the resolved value.

### Database — `packages/db`

`src/schema/auth.ts`, after `image: text("image")`: `imageOverride: text("image_override")`.
`text`, not `varchar(2048)` — a length bound does not race, so it is not the kind of rule the
"constraints encode the rules" line targets. Migration is **generated** via `pnpm db:generate`
(→ `migrations/0021_*.sql` + `meta/0021_snapshot.json` + `_journal.json`), all committed.
Nullable, no default → metadata-only ALTER.

### Resolution — one home, four call sites

New export in `apps/api/src/services/users.ts` (that module already owns
`getUser`/`updateProfile`/`deleteAccount`; no new module for a lone function):

```ts
export function resolveUserImage(user: { image: string | null; imageOverride: string | null }) {
  return user.imageOverride ?? user.image;
}
```

Structural parameter type, not `typeof users.$inferSelect` — `standings.ts` passes a narrow
projection. The doc comment must state the load-bearing part: both columns are `string | null`,
so a site reading the wrong one **compiles and ships the wrong picture silently**.

| File | Change |
| --- | --- |
| `apps/api/src/routes/me.ts` `serializeMe` | `image: resolveUserImage(user)` + new `imageOverride: user.imageOverride` |
| `apps/api/src/services/leagues/serialize.ts` `serializeMember` | `image: resolveUserImage(row.user)` — `loadMembers` selects the whole row, no select change |
| `apps/api/src/services/pickem/standings.ts` | select gains `imageOverride: users.imageOverride`; serializer → `row ? resolveUserImage(row) : null` |
| `apps/api/src/services/pickem/picks.ts` | `image: resolveUserImage(user)` — whole row via `loadMembers`, no select change |

Only `standings.ts` needs a query edit. `picks.ts` and `serialize.ts` share `loadMembers` but
have independent serializer literals — both must be touched.

### Service + route

`updateProfile` takes `imageOverride?: ImageUrl | null` and gains one line in the existing
spread-only-if-defined block. `!== undefined` is already correct for the tri-state: `null`
passes and writes SQL NULL, an absent key never touches the column. Extend its doc comment.

`routes/me.ts`: destructure `imageOverride` from `c.req.valid("json")`, pass it through, update
the `updateMe` summary. **No new refusal reason and no new status** — the only refusal is still
`username_taken`, so no `lib/*-refusals.ts`.

`deleteAccount`: add `imageOverride: null` beside `image: null`. Not for symmetry — the
tombstone row keeps rendering on every league surface, so a live third-party URL and its
IP-logging beacon would outlive the account under "Deleted User".

### SPA — `apps/web`

`src/routes/_authed/profile.tsx`:

- Remount key gains `:${me.data.imageOverride ?? ""}`.
- `defaultValues` gains `imageOverride: profile.imageOverride ?? ""` — the field is always a
  string; `null` is a wire concept materialized only at submit.
- New `<form.Field name="imageOverride">` after `username`, same unchanged-is-valid
  `validators.onSubmit` idiom with empty also valid (it is the clear). Renders
  `<FormTextField label="Avatar image URL" type="url" inputMode="url" autoComplete="off"
  spellCheck={false} placeholder="https://…" />`. `FormTextField` defaults the DOM id to
  `field.name`, giving `#imageOverride` alongside `#displayName` / `#username`.
- `form.Subscribe` change-detector gains
  `values.imageOverride.trim() !== (profile.imageOverride ?? "")`, which correctly enables Save
  when the member *empties* a set field.
- Submit types the body as `UpdateMeRequest` and sends
  `trimmed === "" ? null : ImageUrlSchema.parse(trimmed)`.
- **Clear affordance is the empty field**, no separate Remove button — a second control is a
  second write path into the same mutation with its own pending/disabled logic.
- Replace the CardDescription "Your avatar comes from your sign-in provider." with copy saying
  it comes from the provider unless you set a URL, and that clearing reverts.
- **No live preview** — binding the header `UserIdentity` to the field value makes the avatar
  404 and flicker on every keystroke. It stays on the saved `profile.image`.
- Nothing new for a broken/non-image URL: Base UI's `AvatarImage` + `UserIdentity`'s
  `AvatarFallback` already degrade to initials.

`src/routes/_authed.tsx` — the session-menu avatar reads Better Auth's `session.user.image`,
the provider column, and would ignore the override. Switch to `me.data?.image` from `useMe()`,
which is **already called twice in this file** so React Query dedupes and it costs no request.
Rejected alternative: exposing `imageOverride` through Better Auth `additionalFields` — that
mints a second client-side `??` and puts the raw provider column back on `session.user` where
the next surface reads it directly, which is this exact bug re-armed. Display name and
`@username` stay on `session.user` (unrelated scope; an existing e2e assertion depends on the
`refetchSession()` path).

`src/api/me.ts` — no change (`useUpdateMe` already takes `UpdateMeRequest`).
`src/lib/user.ts` — no change; the wire carries the resolved value, and a helper here would be
a second implementation of the server's coalesce.

### Docs

**`docs/adr/0022-member-set-avatar-url.md`** (0021 is latest) from `template.md`, plus the
index row in `docs/adr/README.md`. Decision covers: URL not upload; the validation surface with
allowlist and fetch-check explicitly rejected and why; the column split and precedence; the
wire shape. Consequences record the accepted residual (`/api/auth/update-user` can still write
the provider fallback), IP/referrer exposure, content swap, and that this borrows the
`override_* ?? provider_*` **shape** but not its `admin_audit` obligation — that rule governs an
admin correcting someone else's data, whereas here the actor is the member editing their own
row and `users.updated_at` is the record.

**`docs/mvp-spec.md` §Users & Identity** — replace the avatar bullet in place citing
`(ADR-0022)`: prefilled from the provider, overridable with an `https:` image URL, clearing
reverts, **still no uploads — the app stores a link, never bytes**. Clarify the deletion bullet
to "avatar (provider and member-set) … removed".

## [EXECUTION PLAN]

Execution structure: **two deliverables, parallel**, one repository delivery
(`picksleagues`), direct checkout on `feat/id-4-member-set-avatar` — no worktrees.

Isolation rationale: file ownership is fully disjoint (D1 owns `packages/`, `apps/`, `openapi/`,
`e2e/`; D2 owns `docs/adr/`, `docs/mvp-spec.md`), and **workers do not commit** — the
orchestrator owns every commit — so there is no git-index race to isolate against. A worktree
would cost a full `pnpm install` for a workspace monorepo, which exceeds the wall-clock gain
from parallelizing a three-file docs deliverable. The `staging` checkout carries unrelated
in-flight dirt (`backlog/04-simulator-admin.md`, untracked `docs/plans/adm-3.md`,
`docs/plans/elm.md`); it rides along uncommitted and is excluded by staging every commit by
explicit path — never `git add -A`.

| ID | Deliverable | Owner | Files |
|---|---|---|---|
| D1 | Member-set avatar, end to end: schema, column + migration, resolution, service/route, SPA, all tests | worker (inherited frontier model — contract/codegen and TanStack Form subtleties) | `packages/schemas/`, `packages/db/`, `apps/api/`, `openapi/`, `apps/web/`, `e2e/identity.spec.ts` |
| D2 | ADR-0022, ADR index row, `docs/mvp-spec.md` reconciliation | worker (cheaper — decisions are fixed, prose from a specified packet) | `docs/adr/0022-*.md`, `docs/adr/README.md`, `docs/mvp-spec.md` |

D1 stays one deliverable per Atlas doctrine — frontend, backend, and e2e for one behavior share
a worker, and the contract regeneration couples them anyway.

**Human gate (tracker text):** adding **TS-5** to `backlog/10-trust-safety.md` and rewriting
ID-4's "Decide while planning" clause both change ticket text / add a ticket, which
`docs/agents/issue-tracker.md` still requires a preview for — the `/atlas-implement` exception
covers claims and execution records only. Preview both to the owner before writing.

**Not done by this run:** ID-4 goes to `[~]`, never `[x]`. A human marks it done after
reviewing the PR.

### Verification map

Run surface local only; real dependency is Postgres on :5433 (`pnpm db:up`). Evidence root
`docs/evidence/test-results/id-4/` — text committed, images to the PR
(`docs/agents/testing.md` §Evidence policy).

| # | Criterion | Command / action | Real dep | Earliest checkpoint | Evidence | Invalidated by |
|---|---|---|---|---|---|---|
| AC1 | Setting an https URL persists and becomes the rendered avatar | `pnpm test:integration` (me) | Postgres | after D1 | `integration.txt` | any change to schemas/service/route |
| AC2 | Unset override falls back to the provider image | `pnpm test:integration` (me) | Postgres | after D1 | `integration.txt` | `resolveUserImage`, serializers |
| AC3 | Clearing reverts to the provider image, provider column untouched | `pnpm test:integration` + `pnpm test:e2e` | Postgres, browser | after D1 | `integration.txt`, `e2e.txt` | service tri-state, profile submit |
| AC4 | Non-https / oversize / `javascript:` refused at the edge | `pnpm test` (schemas) + `pnpm test:integration` (400s) | Postgres | after D1 | `unit.txt`, `integration.txt` | `ImageUrlSchema` |
| AC5 | The override renders on league member, standings, and week-detail surfaces | `pnpm test:integration` (leagues, pickem-standings, pickem-picks) | Postgres | after D1 | `integration.txt` | any of the four serializers |
| AC6 | Broken / non-image URL degrades to initials, no new UI | static: `UserIdentity` unchanged, `AvatarFallback` retained | — | after D1 | diff review in `[AI CODE REVIEW]` | `user-identity.tsx`, `ui/avatar.tsx` |
| AC7 | Account deletion clears the member-set avatar | `pnpm test:integration` (me, deleteMe) | Postgres | after D1 | `integration.txt` | `deleteAccount` |
| AC8 | Better Auth `/api/auth/update-user` cannot write the override column | `pnpm test:integration` (me, BA guard) | Postgres | after D1 | `integration.txt` | `apps/api/src/auth.ts` `additionalFields` |
| AC9 | Spec documents the rule; ADR-0022 records the decision | read `docs/mvp-spec.md` + `docs/adr/0022-*.md`; index row present | — | after D2 | diff review in `[AI CODE REVIEW]` | — |
| DoD1 | Static gates green | `pnpm typecheck && pnpm lint && pnpm format:check` | — | after D1+D2 | `static.txt` | any edit |
| DoD2 | Contract regenerated and committed | `pnpm contract:check` | — | after D1 | `static.txt` | any Zod/route change |
| DoD3 | SPA builds | `pnpm --filter @picksleagues/web build` | — | after D1 | `static.txt` | any `apps/web` change |
| DoD4 | Merge gate green | `pnpm test:e2e` | browser + Postgres | after D1 | `e2e.txt` | any code change |
| DoD5 | `imageOverride` appears only in `MeResponse` / `UpdateMeRequest` in the spec | `grep -n imageOverride openapi/openapi.json` | — | after D1 | `static.txt` | schema changes |
| DoD6 | PR open against `staging`; ID-4 `[~]` with plan pointer | `gh pr create --base staging` | GitHub | closeout | PR URL in `[CLOSEOUT]` | — |

DoD5 is the leak check: if `imageOverride` shows up under `LeagueMember`,
`PickemStandingsRow`, or `PickemMemberPicks`, the "resolved value only, everywhere but `/me`"
decision has leaked to other members.

---

## [PROGRESS]

| When | Event |
|---|---|
| 2026-08-07 | Owner ruled the four decisions in §Decisions during planning. Branch `feat/id-4-member-set-avatar` cut from `staging` @ `497c6d6`; ID-4 claimed `[~]`. |
| 2026-08-07 | D1 and D2 dispatched in parallel (disjoint file ownership, workers do not commit). Both initially returned research-only because the session was still in plan mode — no edits lost, both resumed from transcript. |
| 2026-08-07 | D2 accepted → `0e38280`. One orchestrator fix: the ADR index row read "Member-set avatar URL", thinner than its neighbours' decision-statement style; widened in place. |
| 2026-08-07 | HG1 satisfied — TS-5 and the ID-4 line rewrite previewed to the owner and approved as written. |
| 2026-08-07 | A second `/atlas-implement ID-4` invocation interrupted the orchestrator mid-turn while D1 was editing `apps/api/test/pickem-standings.test.ts`. Resumed from state; **no** duplicated claim, branch, worker, or commit. D1 was confirmed **alive** (message queued to its next tool round) rather than assumed dead, so no takeover. |
| 2026-08-07 | D1 accepted → `50b62f0`. Aggregate verification run against the integrated candidate. PR #40 opened. |

### Isolation decision, re-checked at closeout

The plan chose a direct checkout on the grounds that D1 (code) and D2 (docs) own disjoint files and workers do not commit. Verified against the real diffs: `git show --name-only 0e38280` and `50b62f0` share **zero** paths. The prediction held.

It was, however, right for an incomplete reason. `backlog/06-elimination.md` was modified by a **concurrent session** *during* this run (the ELM plan pointer, matching the untracked `docs/plans/elm.md`) — the checkout was busier than the plan assumed. Nothing leaked, because every commit staged explicit paths and never `git add -A`. A future run that detects unrelated dirt at start should treat it as evidence of a live session and prefer a worktree; explicit-path staging carried this one, but it was the only thing standing between the two runs.

## [AI CODE REVIEW]

Single formal review, performed by the frontier orchestrator over the complete integrated diff (`497c6d6..50b62f0`). Both axes: **no unresolved blocking findings.**

### Axis 1 — technical implementation and spec conformity

Conformity assessed against `backlog/01-identity.md` ID-4, this plan, and ADR-0022.

All nine ACs and six DoD items are implemented and evidenced. The two deviations are the orchestrator rulings recorded in §Deviations below, both accepted.

Findings:

1. **`ImageUrl` is not emitted as an OpenAPI component — correct, not a defect.** The plan predicted an `ImageUrl` component alongside `NullableImageUrl`. In fact `ImageUrl` is referenced nowhere on the wire (the request and response both use the nullable variant), so zod-openapi emits no component and `contract-shape.txt` records 0 `$ref`s. The export still earns its place: the SPA imports `ImageUrlSchema` to parse before submit. No action; the plan's prediction was wrong, the code is right.
2. **`profile.tsx` still renders `<p>Loading profile…</p>` rather than skeletons via `QueryState`**, contrary to engineering.md §Quality. **Pre-existing and out of scope** — the block is untouched by this change, and LNCH-8 is the backlog item that retrofits sites predating that rule. Recorded so it is not mistaken for something ID-4 introduced.
3. **The session-menu avatar falls back to initials for the window before `/me` resolves.** Accepted and anticipated in the plan: `Avatar` is fixed-size so there is no layout shift, and `useMe()` is already called twice in `_authed.tsx`, so React Query dedupes and this adds no request.

Test strategy holds up where it matters most: both avatar columns are `string | null`, so a serializer reading the wrong one type-checks cleanly. The three league-facing serializers each got an independent outcome assertion for exactly that reason, and `pickem-standings` — the only site with a narrow projection — is the one that would have failed had the select not been extended.

### Axis 2 — coding standards

Assessed against `CLAUDE.md`, `.claude/rules/engineering.md`, and the ADRs they reference.

- **Nullable-registration rule (the silent one): satisfied, and proven.** `NullableImageUrl` is its own component and `Username` remains `type: "string"`. This is the failure mode `contract:check` cannot catch, so it was verified against the generated spec rather than by reading the source.
- **API-first, one definition per DTO, thin route handler, services-own-queries, no repository layer:** all satisfied. The SPA body is typed `UpdateMeRequest` rather than an inline restatement.
- **A service names refusals, never an HTTP status:** unchanged — no new refusal reason was introduced, and correctly no `lib/*-refusals.ts` was minted for a route whose only refusal is still `username_taken`.
- **Comments state a why and cite durable identifiers:** every new comment cites `ADR-0022` or a spec section; none cites this plan's internal numbering. Doc-comment form follows visibility (`/** */` on the exported `resolveUserImage` and `ImageUrlSchema`; `//` on the non-exported `NullableImageUrlSchema`).
- **Assert outcomes, not process:** the integration tests assert what a league-mate sees, never `resolveUserImage` directly. The e2e binds to the field id and `toHaveValue`, and deliberately never asserts the rendered `<img alt="">`, which has no accessible name.
- **Notable:** the e2e sync uses `page.waitForResponse` rather than this file's `[data-sonner-toast]` idiom. That moves *away* from the library-internal coupling `docs/agents/testing.md` names as the one site still to migrate, so it is an improvement rather than a new violation.

### Orchestrator fixes applied during acceptance

- `docs/adr/README.md` — index row description widened to match neighbours (D2).

## [CLOSEOUT]

**Repository delivery:** `picksleagues` · base `staging` @ `497c6d6` · branch `feat/id-4-member-set-avatar` · **PR: https://github.com/paul-macfarlane/picksleagues/pull/40**

| Deliverable | Worker / model | Commit |
|---|---|---|
| D1 — avatar end to end (schema, column + migration, resolution, service/route, SPA, tests) | `atlas-worker`, inherited frontier | `50b62f0` |
| D2 — ADR-0022, index row, spec reconciliation | `atlas-worker`, sonnet | `0e38280` |

### Verdicts

Verified run commands and evidence under `docs/evidence/test-results/id-4/`. Integrated candidate `50b62f0`; real dependency Postgres on :5433; run surface local only.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| AC1 | Setting an https URL persists and becomes the rendered avatar | **PASS** | `integration.txt` |
| AC2 | Unset override falls back to the provider image | **PASS** | `integration.txt` |
| AC3 | Clearing reverts to the provider image, provider column untouched | **PASS** | `integration.txt`, `e2e.txt` |
| AC4 | Non-https / oversize / `javascript:` / `data:` refused at the edge | **PASS** | `unit.txt`, `integration.txt` |
| AC5 | Override renders on member-list, standings, and week-detail surfaces | **PASS** | `integration.txt` |
| AC6 | Broken / non-image URL degrades to initials, no new UI | **PASS** (static) | `UserIdentity` + `AvatarFallback` unmodified in `497c6d6..50b62f0`; recorded in Axis 1 |
| AC7 | Account deletion clears the member-set avatar | **PASS** | `integration.txt` |
| AC8 | Better Auth `/api/auth/update-user` cannot write the override column | **PASS** | `integration.txt` |
| AC9 | Spec documents the rule; ADR-0022 records the decision | **PASS** | `0e38280` diff |
| DoD1 | Static gates green | **PASS** | `static.txt` |
| DoD2 | Contract regenerated and committed | **PASS** | `static.txt` |
| DoD3 | SPA builds | **PASS** | `static.txt` |
| DoD4 | Merge gate green (full suite) | **PASS** — 13 passed | `e2e.txt` |
| DoD5 | `imageOverride` confined to `MeResponse` / `UpdateMeRequest` | **PASS** | `contract-shape.txt` |
| DoD6 | PR open against `staging`; ID-4 `[~]` with plan pointer | **PASS** | PR #40 |

### Deviations

1. **`describe` renamed** — `"…cannot write app_role"` → `"…cannot reach the app's validated columns"`, keeping the original `app_role` case beside the new override case. D1 flagged the title/content mismatch rather than leaving it; orchestrator ruled the rename.
2. **e2e ordering and synchronization** — the avatar round trip sits *before* the conflicting-username step, because that step deliberately leaves `#username` in a failed 409 state and the form does not remount, so any later Save would re-trigger the refusal and never reach the avatar assertions. Both saves sync on `page.waitForResponse` for the PATCH: the previous save's toast is still on screen and the button is already disabled while pending, so neither distinguishes this save's completion. D1 found both; orchestrator ruled both in.

### Notes on `pnpm contract:check`

D1 reported it failing and was right about the cause: the gate is `test -z "$(git status --porcelain -- openapi)"`, which asserts `openapi/` is **clean in git** and therefore cannot pass while a worker is instructed not to commit. It is a committed-state gate, not a staleness test. D1 proved the property that actually matters — regeneration is idempotent — by hashing before and after. It passes at `50b62f0`, recorded in `static.txt`.

### Evidence not captured

No visual artifact. `gh` cannot upload images and `docs/agents/testing.md` forbids committing them, so attaching a screenshot is not something this run could do without citing an uncommitted local file as evidence — which the same policy prohibits. AC6 is carried statically and the field is driven in a real browser by the e2e round trip. Flagged in the PR description for the owner.

### Not done by this run

ID-4 remains `[~]`. A human marks `[x]` after reviewing the PR.
