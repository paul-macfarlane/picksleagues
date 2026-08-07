# ELM-1 — static gates

Run on the integrated branch `feat/elm-1-survivor-rename-and-settings` after all
three deliverables landed (`0002a20` docs/ADRs, `162a251` code rename, `71b3795`
resolved range). Machine: local (run surface is **local only**, per
`docs/agents/testing.md`).

## `pnpm typecheck`

```
packages/core typecheck$ tsc
packages/scoring typecheck: Done
packages/core typecheck: Done
packages/db typecheck: Done
apps/api typecheck$ tsc
apps/web typecheck$ tsc -b
apps/web typecheck: Done
apps/api typecheck: Done
```

Exit 0. This is the rename's primary safety net: a missed reference to a renamed
symbol is a type error, not a silent survivor.

## `pnpm lint`

```
$ eslint .
```

Exit 0, no output. Includes the Clock-discipline rule.

## `pnpm format:check`

```
$ prettier --check .
Checking formatting...
All matched files use Prettier code style!
```

## `pnpm contract:check`

```
$ pnpm --filter @picksleagues/api generate:openapi
$ tsx scripts/generate-openapi.ts && openapi-typescript ../../openapi/openapi.json -o ../../openapi/client/schema.d.ts
Wrote /Users/paulmacfarlane/code/picksleagues/openapi/openapi.json
✨ openapi-typescript 7.13.0
🚀 ../../openapi/openapi.json → ../../openapi/client/schema.d.ts [69.7ms]
```

Exit 0 with no `openapi/ is stale` line — the committed spec and client match
regeneration. Renamed components (`SurvivorSettings`,
`SurvivorPushTieResolution`) and the new `SurvivorSettingsInput` are committed.

## `pnpm --filter @picksleagues/web build`

```
dist/assets/date-time-picker-Dfatg62s.js                    85.44 kB │ gzip: 25.88 kB
dist/assets/schemas-B7sqQlGY.js                            112.12 kB │ gzip: 30.28 kB
dist/assets/src-BWc9n2rH.js                                193.61 kB │ gzip: 44.85 kB
dist/assets/index-C17WqPck.js                              260.87 kB │ gzip: 80.74 kB

✓ built in 466ms
```
