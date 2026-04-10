# Testing Rules

> For full patterns and examples, see [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) Section 10.

## Stack

- **Vitest** as the test runner
- Colocate test files next to source: `lib/scoring.test.ts` alongside `lib/scoring.ts`

## What to Test (Priority Order)

1. **Business logic (`lib/`)** — highest value, easiest to test. Pure functions with clear inputs/outputs. No mocking needed.
2. **Server Actions (`actions/`)** — mock the data layer and auth, verify orchestration logic.
3. **Permission helpers (`lib/permissions.ts`)** — mock the data layer, test correct errors are thrown.

## What NOT to Test

- React components (verified manually + type system)
- Data layer functions (thin Drizzle wrappers)
- Zod schemas (testing the library)
- Next.js routing, layouts, middleware
- CSS or styling

## Key Patterns

### Mock at import boundaries

```tsx
vi.mock("@/data/picks", () => ({ insertPicks: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }) }));
```

### Inject time for time-dependent logic

Functions that depend on "now" accept an optional `now` parameter:

```tsx
export function isGameStarted(game: { startTime: Date }, now?: Date): boolean {
  return (now ?? new Date()) >= game.startTime;
}
```

### Test edge cases from the business spec

If BUSINESS_SPEC.md defines a rule, there should be a test for it.

### Clean up between tests

```tsx
beforeEach(() => vi.clearAllMocks());
```

## Running Tests

```bash
pnpm test          # Run all tests
pnpm test --watch  # Watch mode
```
