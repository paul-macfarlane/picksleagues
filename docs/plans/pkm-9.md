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
