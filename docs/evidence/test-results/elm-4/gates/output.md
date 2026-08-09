# Repository gates — Survivor settlement, board, dashboard glance, journey, runbook

Run surface: local only. Every command from `docs/agents/testing.md`, run against the
integrated branch tip after the last code commit. The verified SHA is recorded in the
closeout in `docs/plans/elm.md`, not here, so this file does not go stale the moment it
is committed.

```
### Aggregate verification

$ pnpm format:check
$ prettier --check .
Checking formatting...
All matched files use Prettier code style!
EXIT=0

$ pnpm lint
$ eslint .
EXIT=0

$ pnpm typecheck
packages/core typecheck: Done
packages/db typecheck: Done
apps/web typecheck$ tsc -b
apps/api typecheck$ tsc
apps/web typecheck: Done
apps/api typecheck: Done
EXIT=0

$ pnpm contract:check
$ pnpm contract:generate && test -z "$(git status --porcelain -- openapi)" || (git status --porcelain -- openapi && echo 'openapi/ is stale: run pnpm contract:generate and commit the result' && exit 1)
$ pnpm --filter @picksleagues/api generate:openapi
$ tsx scripts/generate-openapi.ts && openapi-typescript ../../openapi/openapi.json -o ../../openapi/client/schema.d.ts
Wrote /Users/paulmacfarlane/code/picksleagues/openapi/openapi.json
✨ openapi-typescript 7.13.0
🚀 ../../openapi/openapi.json → ../../openapi/client/schema.d.ts [73.8ms]
EXIT=0

$ pnpm test

 Test Files  29 passed (29)
      Tests  518 passed (518)
   Start at  21:28:35
   Duration  976ms (transform 1.55s, setup 0ms, import 3.87s, tests 270ms, environment 2ms)


$ pnpm test:integration


 Test Files  34 passed (34)
      Tests  610 passed (610)
   Start at  21:28:37
   Duration  34.22s (transform 686ms, setup 0ms, import 16.50s, tests 14.66s, environment 2ms)


$ pnpm --filter @picksleagues/web build
dist/assets/index-DWva4pR2.js                              260.99 kB │ gzip: 80.81 kB

✓ built in 442ms
```

## Suite movement across the work package

| Suite | Before | After | What the delta is |
|---|---|---|---|
| unit (`pnpm test`) | 518 | 518 | no unit surface added — settlement orchestration is integration-tested against real Postgres, and presentation policy is deliberately untested |
| integration (`pnpm test:integration`) | 592 | 610 | +12 survivor settlement, +10 survivor board, +6 dashboard glance, minus two premise rewrites in the admin-audit suite |
| e2e (`pnpm test:e2e`) | 13 | 18 | +5, the Survivor season journey |
