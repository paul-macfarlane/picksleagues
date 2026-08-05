# SIMP-4 (PR 2, deliverable D1) — verification output

Branch `feat/simp-pr2-rule-surface-collapse`, comparison point `c45e68d`.
Commands run from the repository root, in order. All four exited 0.

## `pnpm format`

```
$ prettier --write .
packages/scoring/src/pickem.test.ts 13ms
packages/scoring/src/standings.test.ts 7ms
```

Full prettier run rewrote only the files this change touches; every other file reported `(unchanged)`.

## `pnpm lint`

```
$ eslint .
exit 0
```

## `pnpm typecheck`

```
$ pnpm -r typecheck
Scope: 7 of 8 workspace projects
packages/schemas typecheck$ tsc
packages/schemas typecheck: Done
packages/db typecheck$ tsc
packages/core typecheck$ tsc
packages/scoring typecheck$ tsc
packages/scoring typecheck: Done
packages/core typecheck: Done
packages/db typecheck: Done
apps/web typecheck$ tsc -b
apps/api typecheck$ tsc
apps/web typecheck: Done
apps/api typecheck: Done
exit 0
```

## `pnpm test`

```
$ vitest run --project unit

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  27 passed (27)
      Tests  521 passed (521)
   Start at  20:23:31
   Duration  1.04s (transform 1.60s, setup 0ms, import 4.17s, tests 284ms, environment 2ms)

exit 0
```
