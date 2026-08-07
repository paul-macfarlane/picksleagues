# ELM-2 — static gates

Run by the orchestrator against the fully integrated branch tip
`9dc144f` (`feat/elm-2-survivor-picks-state-and-entry`), after every deliverable
and every orchestrator commit had landed — including the fixes runtime
verification turned up and the ADR-0026 removal of ATS from Survivor. Commands
from `docs/agents/testing.md`.

## `pnpm typecheck`

```
$ pnpm -r typecheck && tsc -p e2e/tsconfig.json
Scope: 7 of 8 workspace projects
packages/schemas typecheck: Done
packages/scoring typecheck: Done
packages/core typecheck: Done
packages/db typecheck: Done
apps/web typecheck: Done
apps/api typecheck: Done
```

exit 0.

## `pnpm lint`

```
$ eslint .
```

exit 0, no findings. This run includes the Clock-discipline rule, which is what
holds the "no `Date.now()` / `new Date()`-as-now / SQL `now()` in domain logic"
convention (arch D13) over the new service, schema, and settlement-adjacent code.

## `pnpm format:check`

```
$ prettier --check .
Checking formatting...
All matched files use Prettier code style!
```

exit 0.

## `pnpm contract:check`

```
$ pnpm --filter @picksleagues/api generate:openapi
Wrote /Users/paulmacfarlane/code/picksleagues/openapi/openapi.json
✨ openapi-typescript 7.13.0
🚀 ../../openapi/openapi.json → ../../openapi/client/schema.d.ts [72.8ms]
```

exit 0 — regeneration left `openapi/` byte-identical to what is committed, so
the spec and the generated client match the Zod schemas and routes on this
branch. Note that this check necessarily reports stale *before* a commit that
changes the contract; it is meaningful only when run after, which is how it was
run here.

## `pnpm --filter @picksleagues/web build`

```
✓ built in 476ms
```

exit 0. This is the only build script in the repository.
