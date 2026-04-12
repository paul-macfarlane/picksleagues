# Architecture

This document is the team's go-to reference for how to write code in this codebase. Read it before writing anything non-trivial.

---

## Table of Contents

1. [Core Principles](#1-core-principles)
2. [Next.js 16 Patterns](#2-nextjs-16-patterns)
3. [Data Fetching](#3-data-fetching)
4. [Mutations (Server Actions)](#4-mutations-server-actions)
5. [Forms](#5-forms)
6. [Database (Drizzle)](#6-database-drizzle)
7. [Authentication](#7-authentication)
8. [Validation](#8-validation)
9. [Business Logic](#9-business-logic)
10. [Testing](#10-testing)
11. [Components](#11-components)
12. [Styling (Tailwind v4)](#12-styling-tailwind-v4)
13. [Error Handling](#13-error-handling)
14. [TypeScript](#14-typescript)
15. [Performance](#15-performance)
16. [Linting & Formatting](#16-linting--formatting)
17. [File & Naming Conventions](#17-file--naming-conventions)
18. [Comments & Readability](#18-comments--readability)

---

## 1. Core Principles

**Simple** — Prefer the obvious solution. Fancy abstractions are a liability until the problem demands them.

**Consistent** — Same patterns everywhere. A developer should be able to look at any file and immediately understand what it does and where it belongs.

**DRY** — One source of truth. Shared logic lives in `lib/`. Shared types are inferred, not duplicated.

**Performant** — Server Components by default. Parallel fetching. Minimal client JavaScript. Don't send work to the browser that belongs on the server.

---

## 2. Next.js 16 Patterns

### App Router

All routes live in `app/`. This is Next.js App Router — Server Components are the default. Only reach for `"use client"` when you need interactivity.

### Async Dynamic APIs

In Next.js 16, `params`, `searchParams`, `headers()`, and `cookies()` are all **Promises**. Always `await` them.

```ts
// app/(app)/leagues/[leagueId]/page.tsx
export default async function LeaguePage({ params }: PageProps) {
  const { leagueId } = await params;
  // ...
}
```

### PageProps via next typegen

Use the generated `PageProps` type from `next typegen` rather than handwriting prop types for pages. Run `pnpm typegen` after adding new routes to keep types in sync.

```ts
import type { PageProps } from ".next/types/app/(app)/leagues/[leagueId]/page";
```

### Route Groups

- `(public)` — unauthenticated routes (login, join via invite token)
- `(app)` — authenticated routes, guarded at the layout level

### Turbopack

Turbopack is the default dev server (`pnpm dev`). Do not use `--turbo` flag — it is already on. If you add a webpack plugin or loader, check Turbopack compatibility first.

---

## 3. Data Fetching

### Server Components fetch directly

Pages and layouts call data functions directly. No API routes for internal data fetching.

```ts
// app/(app)/leagues/[leagueId]/page.tsx
export default async function LeaguePage({ params }: PageProps) {
  const { leagueId } = await params;
  const session = await getSession();
  const league = await getLeagueById(leagueId);
  // ...
}
```

### Avoid waterfalls with Promise.all

When a component needs multiple independent pieces of data, fetch them in parallel.

```ts
// Good
const [league, members, currentPhase] = await Promise.all([
  getLeagueById(leagueId),
  getLeagueMembers(leagueId),
  getCurrentPhase(),
]);

// Bad — sequential when they don't depend on each other
const league = await getLeagueById(leagueId);
const members = await getLeagueMembers(leagueId);
```

### Client-side fetching

Avoid it. The only two acceptable use cases:

1. **Search-as-you-type** — debounced fetch as the user types
2. **Polling** — live score updates via `setInterval`

Everything else should be a Server Component fetch or a Server Action.

---

## 4. Mutations (Server Actions)

### The pipeline

Every action follows this exact order:

1. **Validate** — parse input with Zod; return `ActionResult` error on failure
2. **Authenticate** — call `getSession()`; throws `UnauthorizedError` if not logged in
3. **Authorize** — call `assert*` functions from `lib/permissions.ts`; throws `ForbiddenError` if not allowed
4. **Check business rules** — domain logic checks; return `ActionResult` error on failure
5. **Execute** — call data layer functions
6. **Revalidate** — call `revalidatePath` or `revalidateTag`
7. **Return** — return `ActionResult` success

```ts
// actions/leagues/submit-picks.ts
"use server";

export async function submitPicksAction(
  input: unknown,
): Promise<ActionResult<void>> {
  // 1. Validate
  const result = submitPicksSchema.safeParse(input);
  if (!result.success) {
    return { success: false, error: "Invalid input" };
  }
  const { leagueId, picks } = result.data;

  // 2. Authenticate
  const session = await getSession(); // throws UnauthorizedError

  // 3. Authorize
  assertLeagueMember(session.user.id, leagueId); // throws ForbiddenError

  // 4. Business rules
  const phase = await getCurrentPhase();
  if (!phase || isPicksLocked(phase)) {
    return { success: false, error: "Picks are locked for this phase" };
  }

  // 5. Execute
  await upsertPicks({ userId: session.user.id, leagueId, picks });

  // 6. Revalidate
  revalidatePath(`/leagues/${leagueId}/my-picks`);

  // 7. Return
  return { success: true };
}
```

### Two error mechanisms

| Situation             | Mechanism                   | Reason                                      |
| --------------------- | --------------------------- | ------------------------------------------- |
| Not authenticated     | `throw UnauthorizedError`   | Caught by error boundary, redirect to login |
| Not authorized        | `throw ForbiddenError`      | Caught by error boundary, show 403 page     |
| Business rule failure | `return ActionResult` error | Show feedback to user in the form/UI        |

Never `throw` for business rule violations — the user needs to see the message, not a crash page.

### useTransition for action buttons

Wrap action calls in `useTransition` to get a pending state without blocking the UI.

```tsx
const [isPending, startTransition] = useTransition();

function handleSubmit() {
  startTransition(async () => {
    const result = await submitPicksAction(formData);
    if (!result.success) setError(result.error);
  });
}
```

---

## 5. Forms

### Stack

**react-hook-form** + **Zod resolver** + **shadcn Field** primitives (`<Field>`, `<FieldLabel>`, `<FieldDescription>`, `<FieldError>`). The older `<Form>`/`<FormField>`/`<FormMessage>` wrappers were removed from the radix-nova shadcn preset — compose Field directly with RHF's `register` / `useController` and surface errors via `<FieldError errors={[fieldState.error]} />`.

### One schema, two consumers

Define a single Zod schema in `lib/validators/`. Use it in the form for client-side validation and in the action for server-side validation.

```ts
// lib/validators/picks.ts
export const submitPicksSchema = z.object({
  leagueId: z.string().uuid(),
  picks: z.array(pickSchema).min(1),
});

export type SubmitPicksInput = z.infer<typeof submitPicksSchema>;
```

```tsx
// Client: components/picks/submit-picks-form.tsx
const form = useForm<SubmitPicksInput>({
  resolver: zodResolver(submitPicksSchema),
});
```

```ts
// Server: actions/leagues/submit-picks.ts
const result = submitPicksSchema.safeParse(input);
```

### Forms are always Client Components

Forms need interactivity. Mark them `"use client"`. Keep the form component focused — pass callbacks or actions as props rather than importing actions directly when it improves testability.

---

## 6. Database (Drizzle)

### Data access layer

**All database queries live in `data/`**. Nothing outside `data/` imports from `lib/db/` directly (except `lib/db/index.ts` itself for the client/schema exports used by `data/`).

```
data/
├── leagues.ts       # getLeagueById, insertLeague, updateLeague, ...
├── picks.ts
├── phases.ts        # "phases" not "weeks"
├── events.ts        # "events" not "games" for the DB concept
├── members.ts
└── utils.ts         # withTransaction
```

### Schema conventions

```ts
// lib/db/schema/leagues.ts
import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const leagueStatusEnum = pgEnum("league_status", ["active", "archived"]);

export const leagues = pgTable("leagues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: leagueStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- Use `pgTable`
- Every table has `createdAt` and `updatedAt`
- Primary keys are UUIDs (`uuid().primaryKey().defaultRandom()`)
- Use `pgEnum` for fixed sets of values — never raw strings in application code
- Keep relations in a separate `lib/db/schema/relations.ts`
- Use "phases" in schema/table names (not "weeks")
- Use "events" in schema/table names when the concept is a game/matchup in the database

### Query patterns

- **Relational API** (`db.query.*`) for reads that traverse relations
- **SQL-like API** (`db.select`, `db.insert`, `db.update`) for complex queries and all writes

```ts
// Relational API — reads with joins
const league = await db.query.leagues.findFirst({
  where: eq(leagues.id, leagueId),
  with: { members: true, phases: true },
});

// SQL-like API — writes
await db
  .update(leagues)
  .set({ name: newName, updatedAt: new Date() })
  .where(eq(leagues.id, leagueId));
```

### Transactions

Use the `withTransaction` helper from `data/utils.ts` for operations that must be atomic.

```ts
import { withTransaction } from "@/data/utils";

await withTransaction(async (tx) => {
  await insertLeague(tx, leagueData);
  await insertLeagueMember(tx, { leagueId, userId, role: "commissioner" });
});
```

### Upserts

```ts
await db
  .insert(picks)
  .values(pickData)
  .onConflictDoUpdate({
    target: [picks.userId, picks.eventId],
    set: { teamId: pickData.teamId, updatedAt: new Date() },
  });
```

### Avoid N+1

Never query inside a loop. Use the relational API with `with`, or do a single query with `inArray` and group in application code.

### Migrations

```bash
pnpm drizzle-kit generate   # generate migration from schema changes
pnpm drizzle-kit migrate    # apply migrations
```

Never edit generated migration files. Fix the schema and regenerate.

---

## 7. Authentication

### Better Auth

Authentication is handled by Better Auth. The configuration lives in `lib/auth.ts`.

### getSession()

Use the `getSession()` helper in every action and any Server Component that needs the current user. It throws `UnauthorizedError` if no session exists — never returns null.

```ts
import { getSession } from "@/lib/auth";

const session = await getSession(); // throws if not authenticated
const userId = session.user.id;
```

### Auth guard in (app) layout

The `app/(app)/layout.tsx` calls `getSession()`. If it throws, the error boundary redirects to login. Individual pages and actions do not need to duplicate this check for rendering, but **actions must always call `getSession()` themselves** — layout guards only protect rendering, not mutations.

### Authorization

Authorization logic (who can do what) lives in `lib/permissions.ts`. Use `assert*` functions that throw `ForbiddenError`.

```ts
// lib/permissions.ts
export function assertLeagueCommissioner(userId: string, league: League) {
  if (!isLeagueCommissioner(userId, league)) {
    throw new ForbiddenError("Must be league commissioner");
  }
}
```

---

## 8. Validation

### Zod schemas in lib/validators/

All Zod schemas live in `lib/validators/`. Group by domain.

```
lib/validators/
├── picks.ts
├── leagues.ts
├── members.ts
└── auth.ts
```

### Shared between client and server

The same schema is used on both sides. Never write separate "client schema" and "server schema" for the same input.

### Don't duplicate validation

If the database has a constraint (e.g., unique email), don't replicate it with a Zod `.refine()` pre-flight query. Let the database enforce it and catch the error.

---

## 9. Business Logic

### Single source of truth in lib/

All business logic lives in `lib/`. Nothing in `components/`, `app/`, or `actions/` contains domain logic — they orchestrate and display.

### Key modules

```
lib/
├── nfl/
│   ├── scoring.ts       # NFL scoring rules, point calculations
│   ├── scheduling.ts    # Phase/week logic, lock times
│   └── leagues.ts       # NFL-specific league rules
├── permissions.ts       # assert* authorization functions
├── espn/
│   ├── shared/          # Shared ESPN API utilities
│   └── nfl/             # NFL-specific ESPN API client
├── sync/
│   └── nfl/             # NFL sync orchestration (used by cron routes)
└── simulator.ts         # Simulation logic for dev/testing
```

### Sport-specific modules

NFL-specific logic lives in `lib/nfl/`. When a second sport is added, it gets its own `lib/[sport]/` directory. Shared cross-sport logic (if any emerges) goes in `lib/` directly.

ESPN integration is similarly namespaced: `lib/espn/nfl/` for NFL-specific ESPN client code, `lib/espn/shared/` for common utilities.

### Pure functions where possible

Business logic functions should be pure — same input, same output, no side effects. Side effects (DB calls, network) belong in `data/` or sync modules, not in `lib/nfl/scoring.ts`.

```ts
// Good — pure, testable
export function calculateScore(picks: Pick[], results: EventResult[]): number {
  // ...
}

// Bad — side effect in business logic
export async function calculateAndSaveScore(userId: string, leagueId: string) {
  const picks = await getPicks(userId, leagueId); // belongs in data/
  // ...
}
```

### No business logic in components, pages, or actions

Actions orchestrate: validate → authenticate → authorize → call lib/ → call data/ → revalidate. They do not contain domain logic themselves.

---

## 10. Testing

### Vitest

All tests use Vitest. Run with `pnpm test`.

### What to test (in priority order)

1. **`lib/`** — business logic, scoring, scheduling, permissions
2. **`actions/`** — the pipeline (validate/auth/authorize/execute)
3. **`lib/permissions.ts`** — authorization rules are critical

### What not to test

- Components — too brittle, too slow to maintain
- Data layer — integration test territory, not unit tests
- Validators — Zod handles this
- Routing — Next.js handles this

### Mock at import boundaries

Mock at the module boundary, not deep inside implementation. Mock `data/` when testing actions. Mock `lib/auth` when testing things that need a session.

```ts
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

vi.mock("@/data/picks", () => ({
  upsertPicks: vi.fn().mockResolvedValue(undefined),
}));
```

### Colocate test files

Test files live next to the code they test.

```
lib/nfl/scoring.ts
lib/nfl/scoring.test.ts
```

### Inject time via optional `now` param

Functions that depend on the current time accept an optional `now` parameter so tests can control time without mocking global `Date`.

```ts
export function isPicksLocked(phase: Phase, now = new Date()): boolean {
  return now >= phase.locksAt;
}

// In tests:
expect(isPicksLocked(phase, new Date("2026-01-01"))).toBe(false);
```

### The simulator

For testing the full app flow, use the simulator (`lib/simulator.ts`) with the admin UI at `/admin/simulator`. The simulator replays past NFL seasons phase by phase, advancing state on demand — this is how we develop and test without waiting for a live season.

---

## 11. Components

### Server vs Client boundary

Default to Server Components. Only add `"use client"` when the component needs:

- `useState` / `useReducer`
- `useEffect`
- Browser APIs
- Event handlers that aren't server action calls

Push the client boundary as far down the tree as possible. A page can be a Server Component that renders a form which is a Client Component.

### Organization by feature

```
components/
├── ui/                  # shadcn primitives — do not edit directly
├── leagues/
│   ├── league-card.tsx
│   ├── standings-table.tsx
│   └── ...
├── picks/
│   ├── picks-form.tsx
│   └── ...
├── layout/
│   ├── nav.tsx
│   └── ...
└── shared/
    └── ...
```

### No business logic in components

Components receive data as props and render it. They call actions on user interaction. They do not compute derived domain values — that belongs in `lib/`.

---

## 12. Styling (Tailwind v4)

### CSS-first config

Tailwind v4 uses a CSS-first configuration. Custom tokens, theme extensions, and design system values are defined in your global CSS file, not `tailwind.config.js`.

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  --color-brand: oklch(55% 0.2 250);
  --radius-card: 0.75rem;
}
```

### Dark mode via next-themes

Dark mode is handled by `next-themes`. Use the `dark:` variant in Tailwind classes. The theme toggle lives in the layout.

### cn() utility

Use the `cn()` helper from `lib/utils.ts` (wraps `clsx` + `tailwind-merge`) for conditional class names.

```ts
import { cn } from "@/lib/utils";

<div className={cn("base-class", isActive && "active-class", className)} />
```

### Mobile-first responsive

Write mobile styles first, layer up with `sm:`, `md:`, `lg:` prefixes. Never write desktop-first and override down.

---

## 13. Error Handling

### AppError hierarchy

```ts
// lib/errors.ts
export class AppError extends Error {}
export class BadRequestError extends AppError {}
export class UnauthorizedError extends AppError {}
export class ForbiddenError extends AppError {}
export class NotFoundError extends AppError {}
```

### When to throw vs return

| Error type              | Mechanism                                              |
| ----------------------- | ------------------------------------------------------ |
| `UnauthorizedError`     | `throw` — caught by error boundary, redirects to login |
| `ForbiddenError`        | `throw` — caught by error boundary, shows 403          |
| `NotFoundError`         | `throw` — caught by error boundary, shows 404          |
| Business rule violation | `return ActionResult` with `success: false`            |
| Unexpected/system error | `throw` — caught by error boundary, logged to Sentry   |

### error.tsx boundaries

Each route segment can have an `error.tsx` that catches thrown errors and renders a recovery UI. The `(app)/layout.tsx` level error boundary handles auth errors globally.

### Sentry for unexpected errors

Unexpected errors (not `AppError` subclasses) are logged to Sentry. Do not swallow unexpected errors — let them propagate to the boundary where Sentry captures them.

---

## 14. TypeScript

### Strict mode

`strict: true` in `tsconfig.json`. No exceptions.

### Infer from Drizzle and Zod — don't declare

Let the type system do the work. Derive types from your schema rather than writing them by hand.

```ts
// Good — inferred from schema
import type { InferSelectModel } from "drizzle-orm";
import { leagues } from "@/lib/db/schema/leagues";
export type League = InferSelectModel<typeof leagues>;

// Good — inferred from Zod
import { submitPicksSchema } from "@/lib/validators/picks";
export type SubmitPicksInput = z.infer<typeof submitPicksSchema>;

// Bad — manually declared type that can drift from schema
export type League = {
  id: string;
  name: string;
  // ...
};
```

### No `any`

If you find yourself reaching for `any`, stop. Use `unknown` and narrow it, or fix the types upstream.

### Explicit return types on exported functions

Exported functions in `lib/`, `data/`, and `actions/` must have explicit return types. This makes the public API clear and catches type errors at the definition site.

```ts
// Good
export async function getLeagueById(id: string): Promise<League | null> { ... }

// Bad — implicit return type
export async function getLeagueById(id: string) { ... }
```

### ActionResult type

```ts
// lib/types.ts
export type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };
```

All Server Actions return `Promise<ActionResult<T>>`.

---

## 15. Performance

### Server Components first

Every component is a Server Component unless it needs to be a Client Component. This reduces client bundle size and eliminates loading states for initial data.

### Parallel fetching

Use `Promise.all` for independent data fetches. See [Data Fetching](#3-data-fetching).

### loading.tsx

Add `loading.tsx` at route segments that have meaningful data-fetching delays. This enables Next.js streaming and shows a skeleton immediately.

### Database indexes

Add indexes for every foreign key and every column used in a `WHERE` clause. Drizzle supports inline index definition on the table.

```ts
export const picks = pgTable(
  "picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    eventId: uuid("event_id").notNull(),
    // ...
  },
  (table) => [
    index("picks_user_id_idx").on(table.userId),
    index("picks_event_id_idx").on(table.eventId),
  ],
);
```

### next/image

Always use `next/image` for images. Never raw `<img>` tags.

### Minimal client JS

Every `"use client"` component adds to the client bundle. Audit regularly. If a component grew a `"use client"` for a minor reason, see if you can extract just the interactive part.

---

## 16. Linting & Formatting

### ESLint

Config extends `next/core-web-vitals` and `next/typescript`. Do not disable rules inline without a comment explaining why.

```bash
pnpm lint        # check
pnpm lint --fix  # autofix where possible
```

### Prettier

Minimal config (see `.prettierrc`). Formatting is non-negotiable — run it before committing.

```bash
pnpm format      # format all files
```

### CI

Lint and format checks run in CI. A PR with lint errors will not merge.

---

## 17. File & Naming Conventions

### File names

kebab-case everywhere.

```
league-card.tsx        ✓
LeagueCard.tsx         ✗
leagueCard.tsx         ✗
```

### Data function names

| Prefix    | Purpose                      |
| --------- | ---------------------------- |
| `get*`    | Read a single record or list |
| `insert*` | Create a new record          |
| `update*` | Update an existing record    |
| `upsert*` | Insert or update             |
| `remove*` | Delete a record              |

### Permission function names

`assert*` — throws if the condition is not met.

```ts
assertLeagueMember(userId, leagueId);
assertLeagueCommissioner(userId, league);
```

### Action names

verb + noun, descriptive.

```ts
submitPicksAction;
createLeagueAction;
updateLeagueSettingsAction;
inviteMemberAction;
```

### Flat over nested

Avoid deep nesting. If a folder has one file, question whether the folder is needed. Nest when there are genuinely related files that belong together.

### Environment variables

All env vars are documented in `.env.example`. Never commit `.env`. Any new env var must be added to `.env.example` with a description.

### Named exports

Prefer named exports over default exports everywhere except Next.js pages and layouts (which must be default exports).

---

## 18. Comments & Readability

### WHY not WHAT

Code should be readable enough to not need explanation of what it does. Comments explain why a decision was made, why something non-obvious is necessary, or why a workaround exists.

```ts
// Good — explains why
// Picks lock 1 hour before kickoff to prevent last-minute injury abuse
const LOCK_BUFFER_MS = 60 * 60 * 1000;

// Bad — explains what (the code already says this)
// Set lock buffer to 1 hour in milliseconds
const LOCK_BUFFER_MS = 60 * 60 * 1000;
```

### Extract instead of comment

If you feel the urge to add a section comment inside a function, extract that section into a named function instead.

```ts
// Bad
async function processSync() {
  // Fetch events from ESPN
  const events = await ...;

  // Update events in database
  await ...;

  // Calculate standings
  await ...;
}

// Good
async function processSync() {
  const events = await fetchEventsFromEspn();
  await updateEvents(events);
  await recalculateStandings();
}
```

### No unnecessary JSDoc

Do not add JSDoc to functions whose name, parameters, and return type already tell the whole story. JSDoc is appropriate for public-facing library code or genuinely complex functions where the type signature alone is insufficient.

---

## Project Structure

```
/
├── app/                          # Next.js App Router
│   ├── (public)/                 # Public routes
│   │   ├── login/page.tsx
│   │   └── join/[token]/page.tsx
│   ├── (app)/                    # Authenticated routes
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Home
│   │   ├── profile/page.tsx
│   │   ├── account/page.tsx
│   │   ├── admin/simulator/page.tsx
│   │   └── leagues/
│   │       ├── page.tsx
│   │       ├── create/page.tsx
│   │       └── [leagueId]/
│   │           ├── layout.tsx
│   │           ├── page.tsx      # Standings
│   │           ├── my-picks/page.tsx
│   │           ├── league-picks/page.tsx
│   │           ├── members/page.tsx
│   │           └── settings/page.tsx
│   └── api/
│       ├── auth/[...all]/route.ts
│       └── cron/nfl/
│           ├── setup/route.ts
│           ├── weekly-sync/route.ts
│           ├── odds-sync/route.ts
│           └── live-scores/route.ts
├── lib/
│   ├── db/                       # Drizzle schema + client
│   │   ├── index.ts
│   │   └── schema/
│   ├── auth.ts
│   ├── errors.ts
│   ├── types.ts                  # ActionResult type
│   ├── utils.ts                  # cn() helper
│   ├── nfl/                      # NFL-specific business logic
│   │   ├── scoring.ts
│   │   ├── scheduling.ts
│   │   └── leagues.ts
│   ├── permissions.ts
│   ├── espn/                     # ESPN API client
│   │   ├── shared/
│   │   └── nfl/
│   ├── sync/                     # Sync orchestration
│   │   └── nfl/
│   ├── cron-auth.ts
│   ├── simulator.ts
│   └── validators/
├── actions/
├── data/
│   └── utils.ts                  # withTransaction
├── components/
│   ├── ui/                       # shadcn primitives
│   └── ...feature folders
├── docs/
├── rules/
├── work/
├── drizzle/                      # Generated migrations
└── drizzle.config.ts
```
