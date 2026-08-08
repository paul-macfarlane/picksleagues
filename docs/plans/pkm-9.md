# PKM-9 — Credit the sportsbook behind the spread

Ticket: `backlog/05-pickem.md` → **PKM-9**. Branch: `feat/pkm-9-spread-source`.
Base: `staging`. Run surface: **local only**.

The ticket line is the stable contract and is unusually complete — it names the
capture point, the storage shape, the precedence class, the suppression rules,
and the placement. Nothing below amends it.

## Provenance note (read before merging)

The PKM-9 ticket line did not exist on `staging` when this work package started.
It was an uncommitted addition in the author's main checkout, alongside in-flight
ELM-4/5/6 work. This branch therefore **adds** the line (already claimed, `[~]`)
rather than transitioning one that was already there. If the same line also lands
via the ELM branch, `backlog/05-pickem.md` will conflict on a single duplicated
line — trivial to resolve by keeping one copy.

The same overlap applies to the Drizzle migration counter: the main checkout holds
an uncommitted `0025_colossal_hiroim.sql`, and this branch generates its own `0025`
off `staging`. Whichever merges second must be renumbered and its journal entry
regenerated. Both are recorded here so neither is discovered at merge time.

## [EXECUTION PLAN]

### Structure

One deliverable, one worker, sequential. The change is a single vertical slice —
provider field → column → job write → DTO → UI — and the engineering rules treat
frontend, backend, and tests for one behavior as one deliverable. Splitting it
across workers would put `packages/schemas/src/slate.ts`, `openapi/`, and the
serializer under two owners with no concurrency to gain.

Isolation: a dedicated worktree at `.claude/worktrees/pkm-9/picksleagues`, because
the main checkout is dirty with unrelated in-flight work (ELM-4/5/6) on another
branch. This is genuine concurrency, not tidiness.

### Derived decisions

The ticket fixes everything except one detail, resolved here without amending it.

**Suppression is per-game; the credit line is per-surface.** The ticket says to
render the credit "only where the displayed number is actually that book's" and
places it once per pick card / week detail rather than per game row. Those two
compose as: the serializer resolves `spreadSource` to `null` for any game whose
`override_spread` is set (that game's displayed number is the commissioner's, not
the book's), and the surface renders its single credit line when **at least one**
displayed game still carries a source. A whole slate's credit must not vanish
because one game was corrected, and a corrected game must not be credited.

**No new column on `pickem_picks`.** The pick DTO's source is read from the game
row's frozen `spread_source`. The ticket's rationale for freezing the source
beside the last-priced number is precisely that it keeps the credit correct on a
submitted week whose game is long final, which a per-pick copy would only
duplicate.

**`spread_source` is a provider field, never an `override_*` (arch D15).** It is
written in the same `set()` as `spread` in `sync-odds`, so a re-sync cannot leave
a number from one book credited to another, and a correction outlives every
re-sync by suppressing the credit rather than by rewriting it.

### Acceptance criteria

- **AC1** — `ProviderGame` carries the book's name; the ESPN adapter reads it from
  `competition.odds[0].provider.name` and yields `null` when absent. ESPN response
  shapes stay inside the adapter.
- **AC2** — `SimulatedProvider` yields `null` — fixture spreads are synthesized
  (SIM-6) and carry no source.
- **AC3** — `games.spread_source` exists, nullable, written in the same `set()` as
  `spread` in `sync-odds` and never as an `override_*`. A re-run with an unmoved
  line stays a true no-op.
- **AC4** — `SlateGame.spreadSource` and the Pick'em pick DTO serialize the source;
  it is `null` when `override_spread` is set. `openapi/` regenerated and committed.
- **AC5** — The credit renders as plain text (no logo) once per pick card and once
  on the week detail near the existing "as of" copy, only in ATS leagues, only when
  a displayed game carries a source.

### Definition of done

- **DoD1** `pnpm typecheck` · **DoD2** `pnpm lint` · **DoD3** `pnpm test`
- **DoD4** `pnpm test:integration` · **DoD5** `pnpm contract:check`
- **DoD6** `pnpm format:check` · **DoD7** `pnpm --filter @picksleagues/web build`
- **DoD8** `pnpm test:e2e` — the merge gate.

### Criterion → evidence map

| Criterion | Command / action | Surface | Real dependency | Expected | Evidence | Earliest checkpoint | Invalidated by |
|---|---|---|---|---|---|---|---|
| AC1 | `pnpm test --project unit` over the ESPN adapter spec | node | none (fixture payload) | source parsed; `null` when `odds[0].provider` absent | `docs/evidence/test-results/pkm-9/unit/` | after deliverable | adapter or fixture change |
| AC2 | same unit run | node | none | sim provider yields `null` | same | after deliverable | sim fixture/provider change |
| AC3 | `pnpm test:integration` over `nfl-sync-odds` | Hono in-process | real Postgres | source written with spread; re-run no-op; no `override_*` write | `docs/evidence/test-results/pkm-9/integration/` | after migration applied | `sync-odds` or schema change |
| AC4 | `pnpm test:integration` (slate + picks serialization) then `pnpm contract:check` | Hono in-process | real Postgres | source serialized; `null` under `override_spread`; `openapi/` clean | same + `contract/` | after DTO change | Zod/route/serializer change |
| AC5 | `pnpm test:e2e`; plus phone-width screenshots of an ATS pick card and week detail | browser, full local stack | SimulatedProvider + simulated clock | credit line present in ATS, absent in SU and under override | e2e output committed; screenshots → PR | after UI change | UI or copy change |
| DoD1–7 | the commands named above | local | Postgres for DoD4 | exit 0 | `docs/evidence/test-results/pkm-9/` | after deliverable | any code change |
| DoD8 | `pnpm test:e2e` | browser | full local stack | exit 0, journey not `skipped` | committed output | after integration | any code change |

Text evidence is committed under `docs/evidence/test-results/pkm-9/`; images go to
the PR, per `docs/agents/testing.md`.

### Known verification gap

`pnpm test:e2e` (DoD8) reads the repository root `.env` through
`e2e/setup/e2e-env.ts`, and gitignored files do not come with a git worktree.
Copying `.env` into the worktree is refused by `.claude/hooks/atlas/guard.py`,
which denies every Bash command and every Write naming a live secret-bearing path
— a guardrail, not an obstacle, so it is not worked around. The check is therefore
`BLOCKED` locally in this checkout and is covered instead by CI, which runs
`pnpm test:e2e` from `.github/workflows/ci.yml` on the pull request with its own
environment. A human can unblock it locally in one command from the repo root:

```
cp .env .claude/worktrees/pkm-9/picksleagues/.env
```

Integration tests are unaffected: `apps/api/test/setup/test-database-url.ts`
defaults to the local Docker Postgres URL and reads no `.env`.

## [PROGRESS]

- Worktree created off `origin/staging`; dependencies installed.
- PKM-9 carried onto the branch and claimed `[~]`.
- Execution plan recorded.
- PKM-9-D1 delivered by one `atlas-worker` (sonnet); accepted after two
  orchestrator fixes and one added test (below).

## [AI CODE REVIEW]

Single formal review, both axes, by the frontier orchestrator over the complete
branch diff.

### Axis 1 — technical implementation and spec conformity

Conforms. Every clause of the ticket is honoured: the book is captured as data
from `competition.odds[0].provider.name` rather than baked in; `spread_source`
is nullable, provider-class, and written in the same `.set()` as `spread`;
`SimulatedProvider` yields `null`; the credit is plain text with no logo, placed
once per surface rather than per game row; `override_spread` suppresses it.

Two defects found and fixed inline (localized corrections that did not change the
deliverable's design — recorded here so the commit's provenance stays honest):

1. **`SlateGame.spreadSource`'s doc comment claimed the field is null in SU
   leagues.** It is not: the slate is mode-agnostic (`GET /weeks/{id}/games` is
   shared across modes), so the server never sees a pick type and SU suppression
   is client-side. Reworded to match how the neighbouring `spread` field already
   words the same fact. A comment asserting a null the code never produces is the
   exact failure the "comments explain why, and start lying the first time the
   code moves" rule targets.
2. **The pick DTO credited a book beside a null spread.** `spreadSource` was read
   from the game row unconditionally, but `spread` on a Pick'em pick is
   `spreadAtPick`, which is null for every pick in a straight-up league — so an SU
   pick serialized `spreadSource: "DraftKings"` against no number at all. Not
   user-visible today (the SPA gates the credit on `pickType`), but it is a wire
   contract stating something false, and the only thing standing between it and a
   visible defect was a client-side check. Now gated on the pick's own spread.

**Coverage gap closed.** Fix 2 shipped without a test. Added an integration case
asserting an SU pick serializes no source while its game still carries one, and
verified it is not vacuous: reverting the gate turns it red with
`expected null, received "DraftKings"`.

Non-blocking observation: `data-testid="spread-source-credit"` is emitted on
three surfaces with nothing yet binding to it. Kept — engineering rules treat a
testid as a deliberate, greppable contract, and it is the affordance a future
e2e assertion would need.

### Axis 2 — coding standards

Conforms. Checked specifically against the rules this change could plausibly
break:

- **Value sets are const objects.** Correctly *not* applied — the book is free
  text from the provider, and a const set of book names would go stale the next
  time ESPN rotates, which is the ticket's whole premise.
- **Never wrap an `.openapi()`-registered schema in `.nullable()` inline.** Not
  tripped: `z.string().nullable()` wraps an unregistered primitive. Verified in
  the generated artifact rather than assumed — both `SlateGame.spreadSource` and
  `PickemPick.spreadSource` emit an inline `{"type":["string","null"]}` and no
  shared component was widened. This rule fails silently with `contract:check`
  still green, so it needed checking against the output, not the source.
- **Provider shapes never leak** — the ESPN `provider.name` shape is confined to
  `CompetitionSchema` inside the adapter.
- **Override precedence has one home** — resolved in `resolveGameOverrides`, not
  restated at any call site.
- **Comments cite durable identifiers** (`arch D15`, `SIM-6`, `DATA-8`, `PKM-9`)
  and explain why; doc-comment form matches symbol visibility.
- Theme tokens only, extensionless imports, no repository layer, no `any`, no
  hand-rolled `fetch`.

No unresolved blocking findings on either axis.

## [CLOSEOUT]

Deliverable: **PKM-9-D1**, one `atlas-worker` (sonnet), plus two orchestrator
inline fixes and one orchestrator-added test.

### Verdicts

| Criterion | Verdict | Evidence |
|---|---|---|
| AC1 ESPN adapter captures the book | **PASS** | `unit.txt` — 29 files / 521 tests, incl. new cases for a missing `provider` and for absent `odds` |
| AC2 `SimulatedProvider` yields null | **PASS** | `unit.txt` |
| AC3 column + same-`set()` write, re-run no-op | **PASS** | `integration.txt` — incl. a book rotation with the line unmoved, which the no-op guard now persists |
| AC4 serialization + suppression + `openapi/` | **PASS** | `integration.txt`, `contract-check.txt`; generated nullable shape inspected directly |
| AC5 credit rendered on both surfaces | **PARTIAL — data contract PASS, rendered output BLOCKED** | see below |
| DoD1 typecheck | **PASS** | `typecheck.txt` |
| DoD2 lint | **PASS** | `lint.txt` |
| DoD3 test | **PASS** | `unit.txt` |
| DoD4 test:integration | **PASS** | `integration.txt` — 32 files / 589 tests |
| DoD5 contract:check | **PASS** | `contract-check.txt` (exit 0 once `openapi/` was committed) |
| DoD6 format:check | **PASS** | `format-check.txt` |
| DoD7 web build | **PASS** | `build.txt` |
| DoD8 test:e2e | **BLOCKED locally — delegated to CI** | see below |

### AC5 and DoD8 — what is not proven here

Both need a running stack, and this worktree cannot start one. `packages/core/src/env.ts`
validates `BETTER_AUTH_SECRET`, both OAuth client pairs, and `JOB_SECRET` at
startup; those live in the repository-root `.env`, gitignored files do not come
with a git worktree, and `.claude/hooks/atlas/guard.py` denies every Bash command
and every Write naming a live secret-bearing path. That is a guardrail, so it was
not worked around and no placeholder secrets were invented.

Consequently:

- **AC5's server side is proven** — the integration suite asserts what each
  surface receives, including the `override_spread` suppression and the SU case.
- **AC5's rendered output is not.** No screenshot was taken and no browser ran.
  The render path has typecheck and a successful SPA build behind it and nothing
  more. `spreadSourceCredit` is presentation policy, which the engineering rules
  deliberately exclude from unit testing, so no cheaper layer covers it either.
- **DoD8 runs in CI** on the pull request (`.github/workflows/ci.yml`), which
  supplies its own environment. The e2e suite contains no assertion on the credit
  line — E2E covers journeys, not branches — so a green CI proves this change
  broke no existing journey; it does not prove the credit renders.

To close both locally, from the repository root:

```
cp .env .claude/worktrees/pkm-9/picksleagues/.env
cd .claude/worktrees/pkm-9/picksleagues && pnpm dev   # then an ATS league's pick card at phone width
```

### Deviations

- The ticket line was added by this branch rather than transitioned on it — it
  was never on `staging` (see the provenance note above).
- No `pnpm db:migrate` was run: it would have migrated the shared dev database
  that another branch is currently using. The integration suite creates and
  migrates its own `picksleagues_test`, which is what the evidence above rests on.
  **The dev database still needs `pnpm db:migrate` before this branch is run
  locally.**
