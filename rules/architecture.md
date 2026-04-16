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

## Key Prohibitions

- **No business logic in components** — components render, functions compute
- **No Drizzle outside `data/`** — the data layer is the only ORM boundary
- **No `useEffect` + `fetch` for data** — Server Components fetch directly
- **No client-side data fetching** except search-as-you-type and polling
- **No manual type declarations** that mirror Drizzle/Zod schemas — infer types
