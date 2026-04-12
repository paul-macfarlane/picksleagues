# Code Style Rules

> For full patterns, see [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) Sections 14-18.

## TypeScript

- **Strict mode** enabled — no exceptions
- **No `any`** — use `unknown` and narrow with type guards
- **Infer types** from Drizzle schemas and Zod — don't manually declare interfaces that mirror schemas
- **Explicit return types** on all exported non-UI functions
- **`ActionResult<T>`** return type for all Server Actions

## File Naming

- **kebab-case** for all files: `league-card.tsx`, `submit-picks.ts`
- **No index files** for re-exporting — import directly from source
- Named exports preferred over default exports (except Next.js page/layout which require default)

## Function Naming

| Context        | Convention                                 | Example                                   |
| -------------- | ------------------------------------------ | ----------------------------------------- |
| Data reads     | `get*`                                     | `getLeague`, `getUserPicks`               |
| Data writes    | `insert*`, `update*`, `upsert*`, `remove*` | `insertPick`, `updateLeague`              |
| Server Actions | verb + noun                                | `createLeague`, `submitPicks`             |
| Permissions    | `assert*`                                  | `assertCommissioner`, `assertNotInSeason` |
| Business logic | descriptive                                | `calculatePickResult`, `isGameStarted`    |

## Directory Structure

- Flat over nested — don't create directories with a single file
- Group by feature domain in `components/`
- Colocate tests next to source files

## Code Quality

- No TODO comments in committed code — create tracked tasks instead
- No commented-out code
- Comments explain **WHY**, not **WHAT** — if code needs a WHAT comment, rename instead
- Extract named components instead of JSX section comments
- No JSDoc that just restates the function signature

## Formatting

- **Prettier** handles all formatting decisions
- **ESLint** with `next/core-web-vitals`, `next/typescript`, and `prettier` configs
- No custom ESLint rules beyond what Next.js provides

```bash
pnpm lint          # ESLint
pnpm format        # Prettier fix
pnpm format:check  # Prettier check
pnpm typecheck     # tsc --noEmit
```

## Environment Variables

- Maintain `.env.example` with all required variables (placeholder values)
- Never commit actual secrets — `.env` and `.env.local` in `.gitignore`
