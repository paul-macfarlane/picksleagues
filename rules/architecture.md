# Architecture Rules

> Concise, enforceable directives. For full context and examples, see [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Layer Boundaries

| Layer          | Directory         | Allowed Imports                            | Forbidden                                   |
| -------------- | ----------------- | ------------------------------------------ | ------------------------------------------- |
| Data access    | `data/`           | Drizzle ORM, `lib/db/`                     | Everything else                             |
| Business logic | `lib/`            | Other `lib/` modules only                  | Drizzle, `data/`, `actions/`, `components/` |
| Server Actions | `actions/`        | `data/`, `lib/`                            | Drizzle, `components/`                      |
| Pages          | `app/**/page.tsx` | `data/`, `lib/`, `components/`             | Drizzle, `actions/` (except form wiring)    |
| Components     | `components/`     | `lib/` (for logic calls), other components | Drizzle, `data/`                            |

**Exceptions**:

- `lib/permissions.ts` may call `data/` functions — permissions are inherently data-dependent.
- `lib/sync/` may call `data/` functions — sync pipelines orchestrate external data fetching and database persistence.
- `lib/simulator.ts` may call `data/` functions — the off-season test simulator orchestrates sync + DB state and reads its own singleton state.
- `lib/invites.ts` may call `data/` functions — the capacity-invariant cleanup crosses invite + league tables and is shared between mutations.

## Server Action Pattern

Every Server Action follows this exact sequence:

1. **Validate** input with Zod (`.parse()`)
2. **Authenticate** — call `getSession()` (throws `UnauthorizedError`)
3. **Authorize** — call `assert*` helpers (throws `ForbiddenError`)
4. **Check business rules** — call `lib/` functions
5. **Execute** — call `data/` functions
6. **Revalidate** — call `revalidatePath()`
7. **Return** `ActionResult`

**Error strategy**: Auth/permission errors **throw** (caught by error boundaries). Business errors **return** `{ success: false, error: "..." }`.

## Sport-Specific Module Convention

Sport-specific logic lives in namespaced directories:

```
lib/nfl/           — NFL business logic (scoring, scheduling, leagues)
lib/espn/nfl/      — ESPN API client for NFL data
lib/sync/nfl/      — NFL data sync pipeline
app/api/cron/nfl/  — NFL cron route handlers
```

Future sports add new directories (`lib/march-madness/`, `lib/espn/ncb/`, etc.) — they don't modify existing ones. Shared ESPN utilities live in `lib/espn/shared/`.

## Time-Dependent Logic

Every "is this happening right now?" check in Server Components and Server
Actions must pull the current time from `lib/simulator.ts#getAppNow()`, not
from `new Date()`. `getAppNow()` returns the simulator's `simNow` when the
off-season simulator is initialized and real wall-clock time otherwise — so
every in-season / current-phase / pick-lock check flips correctly as the
simulator advances. Raw `new Date()` for "now" silently breaks every test
plan that runs against simulated data.

Pure helpers in `lib/` that depend on time keep accepting an optional `now`
parameter (testing rule); callers fetch it from `getAppNow()` and pass it
through. Time used for things outside simulation scope (invite expiration,
audit log timestamps) stays on real wall-clock time.

## Key Prohibitions

- **No business logic in components** — components render, functions compute
- **No Drizzle outside `data/`** — the data layer is the only ORM boundary
- **No `useEffect` + `fetch` for data** — Server Components fetch directly
- **No client-side data fetching** except search-as-you-type and polling
- **No manual type declarations** that mirror Drizzle/Zod schemas — infer types
- **No raw `new Date()` for "now"** in server code — use `getAppNow()`
