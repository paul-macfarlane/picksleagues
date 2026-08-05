# PR 2 aggregate verification — integrated candidate

Commit: `aca32a4` on `feat/simp-pr2-rule-surface-collapse`, base `staging` at 589fac0.
Run by the frontier orchestrator on the fully integrated branch, 2026-08-04. Local only.

## `pnpm format:check`
```
$ prettier --check .
Checking formatting...
All matched files use Prettier code style!
[exit 0]
```

## `pnpm lint`
```
$ eslint .
[exit 0]
```

## `pnpm typecheck`
```
$ pnpm -r typecheck
Scope: 7 of 8 workspace projects
packages/schemas typecheck$ tsc
packages/schemas typecheck: Done
packages/core typecheck$ tsc
packages/scoring typecheck$ tsc
packages/db typecheck$ tsc
packages/scoring typecheck: Done
packages/core typecheck: Done
packages/db typecheck: Done
apps/web typecheck$ tsc -b
apps/api typecheck$ tsc
apps/web typecheck: Done
apps/api typecheck: Done
[exit 0]
```

## `pnpm test`
```
$ vitest run --project unit

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  27 passed (27)
      Tests  501 passed (501)
   Start at  22:21:39
   Duration  1.02s (transform 1.60s, setup 0ms, import 3.94s, tests 296ms, environment 2ms)
[exit 0]
```

## `pnpm test:integration`
```
$ vitest run --project integration

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  26 passed (26)
      Tests  474 passed (474)
   Start at  22:21:40
   Duration  25.45s (transform 561ms, setup 0ms, import 12.53s, tests 10.50s, environment 1ms)
[exit 0]
```

## `pnpm contract:check`
```
$ pnpm contract:generate && test -z "$(git status --porcelain -- openapi)" || (git status --porcelain -- openapi && echo 'openapi/ is stale: run pnpm contract:generate and commit the result' && exit 1)
$ pnpm --filter @picksleagues/api generate:openapi
$ tsx scripts/generate-openapi.ts && openapi-typescript ../../openapi/openapi.json -o ../../openapi/client/schema.d.ts
Wrote /Users/paulmacfarlane/code/picksleagues/openapi/openapi.json
✨ openapi-typescript 7.13.0
🚀 ../../openapi/openapi.json → ../../openapi/client/schema.d.ts [67.4ms]
[exit 0]
```

## `pnpm --filter @picksleagues/web build`
```
dist/assets/auth-CgaLEmEp.js                                28.39 kB │ gzip: 10.73 kB
dist/assets/useAnchoredPopupScrollLock-C8S2UNTz.js          28.69 kB │ gzip: 10.95 kB
dist/assets/labeled-select-C19V7RQD.js                      30.91 kB │ gzip: 11.15 kB
dist/assets/_authed-CLYDbRBs.js                             38.84 kB │ gzip: 12.32 kB
dist/assets/button-DVQXxmXL.js                              39.90 kB │ gzip: 13.43 kB
dist/assets/useOpenInteractionType-uBJ0URaW.js              45.98 kB │ gzip: 15.69 kB
dist/assets/Match-Dwiok2Jt.js                               48.57 kB │ gzip: 15.74 kB
dist/assets/form-field-DFZsVdTH.js                          64.41 kB │ gzip: 16.02 kB
dist/assets/date-time-picker-Cg4dTQDb.js                    85.39 kB │ gzip: 25.85 kB
dist/assets/schemas-B7sqQlGY.js                            112.12 kB │ gzip: 30.28 kB
dist/assets/src-8XQVkclK.js                                192.13 kB │ gzip: 44.41 kB
dist/assets/index-D2JiMbhA.js                              260.36 kB │ gzip: 80.58 kB

✓ built in 458ms
[exit 0]
```

## `git status --porcelain -- openapi` (contract staleness)
```
[empty = spec and client are in sync with the schemas]
```
