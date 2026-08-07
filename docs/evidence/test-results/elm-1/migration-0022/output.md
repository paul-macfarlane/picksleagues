# ELM-1 — migration 0022 rewrites stored mode rows

`packages/db/migrations/0022_survivor_mode_rename.sql` rewrites
`leagues.mode` from the old value to the new one. Without it the stored value
stops parsing against `LEAGUE_MODE` and an existing league becomes unreadable
rather than merely mislabelled (ADR-0023 §Decision).

## Applies cleanly to a real database

```
$ pnpm db:migrate
$ drizzle-kit migrate
Reading config file '/Users/paulmacfarlane/code/picksleagues/packages/db/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] migrations applied successfully!
```

The integration suite's global setup applies the same migration chain to
`picksleagues_test` before its 553 tests, so the migration is exercised a second
time there.

## The statement actually rewrites a row

The dev database held no row with the old mode value, so applying the migration
there was a no-op and proves only that the table and column names resolve — a
`WHERE` that matches nothing still "succeeds". Proven separately against a real
row inside a transaction that was then rolled back, so nothing was left behind:

```
BEGIN
INSERT 0 1
 before_migration
------------------
 elimination
(1 row)

UPDATE 1
 after_migration
-----------------
 survivor
(1 row)

ROLLBACK
 rows_left_behind
------------------
                0
(1 row)
```
