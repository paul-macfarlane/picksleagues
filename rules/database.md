# Database Rules

> For full patterns and examples, see [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) Section 6.

## Schema Conventions

- One schema file per domain area in `lib/db/schema/` (e.g., `leagues.ts`, `picks.ts`, `sports.ts`)
- All tables include `createdAt` (defaultNow) and `updatedAt` (defaultNow + $onUpdate) timestamps
- Use `uuid` for primary keys (generated via `defaultRandom()`)
- Use `text` for BetterAuth-managed IDs (users)
- Use `pgEnum` for all fixed-value string columns — export the TypeScript type alongside
- Define relations in a separate `schema/relations.ts` file to avoid circular imports
- Foreign keys use explicit `onDelete` behavior

## Sport-Agnostic Naming

- Use **"phases"** not "weeks" — supports NFL weeks, tournament rounds, playoff rounds
- Use **"events"** not "games" — supports any competition type
- `leagueTypes` table is extensible — "pick-em" first, future: "bracket", "survivor", etc.
- `sportsLeagues` table supports multiple sports (NFL, NCAA, PGA, ATP, NBA)

## External ID Mapping

For every ESPN-sourced entity, maintain an `external_*` bridge table:

```
external_{entity}: (dataSourceId, externalId) -> internalId + metadata
```

This decouples internal IDs from ESPN IDs. Bridge tables: `external_seasons`, `external_phases`, `external_teams`, `external_events`, `external_odds`, `external_sportsbooks`.

## Data Layer (`data/`)

- **All Drizzle ORM code lives in `data/` only** — no exceptions
- Every function accepts optional `tx?: Transaction` parameter
- Use `const client = tx ?? db;` pattern
- Naming: `get*` reads, `insert*`/`update*`/`upsert*`/`remove*` writes
- Data functions are generic (e.g., `updateUser` not `anonymizeUser`) — business logic stays in `actions/` or `lib/`
- Use relational API (`db.query.*`) for reads with relations
- Use SQL-like API (`db.select/insert/update/delete`) for complex queries and writes
- Use `onConflictDoUpdate` for idempotent sync operations
- Never query inside a loop — use `with` clause or `inArray()` to batch

## Migrations

```bash
pnpm exec drizzle-kit generate   # Create migration from schema changes
pnpm exec drizzle-kit migrate    # Apply pending migrations
```

- Never manually edit generated SQL files
- Commit migration files to the repo
- One migration per schema change
