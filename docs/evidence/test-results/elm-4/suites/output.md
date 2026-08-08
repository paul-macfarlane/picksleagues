# Survivor settlement and board suites

The three Survivor API suites run together — settlement, the board endpoint, and the
pre-existing pick-entry suite that both had to leave green.

```
$ pnpm vitest run --project integration apps/api/test/survivor-settlement.test.ts apps/api/test/survivor-standings.test.ts apps/api/test/survivor-picks.test.ts
 Test Files  3 passed (3)
      Tests  46 passed (46)
   Start at  21:29:41
   Duration  3.99s (transform 382ms, setup 0ms, import 1.85s, tests 1.59s, environment 0ms)

```

46 = 12 settlement (new) + 10 board (new) + 24 pick entry (pre-existing, unchanged).
