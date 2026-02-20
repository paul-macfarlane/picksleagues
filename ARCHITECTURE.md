# PicksLeagues — Architectural Practices

> Rules and patterns for building the PicksLeagues codebase. This document is intended to be consumed by AI agents and human developers alike. Follow these practices to keep the codebase simple, consistent, DRY, and performant.
>
> For business rules, see [BUSINESS_SPEC.md](./BUSINESS_SPEC.md). For tech choices, see [TECH_STACK.md](./TECH_STACK.md). For background jobs, see [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md).

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

---

## 1. Core Principles

**Simple** — Prefer the obvious approach. If a pattern requires explanation, it's probably too clever. Three similar lines of code are better than a premature abstraction.

**Consistent** — Do the same thing the same way everywhere. If the first data function uses a certain pattern, every data function should follow it. Consistency enables AI agents and new developers to pattern-match and move fast.

**DRY** — Extract shared logic when it appears in three or more places. Not before. Duplicate code is better than the wrong abstraction.

**Performant** — Fetch data on the server, minimize client JavaScript, avoid waterfalls. But don't optimize until there's a reason to — correctness first.

---

## 2. Next.js 16 Patterns

### 2.1 App Router Conventions

This app uses **Next.js 16 App Router**. Key rules:

- **Server Components are the default.** Every component is a Server Component unless it needs interactivity (`onClick`, `useState`, `useEffect`). Never add `"use client"` to a file unless you need browser APIs or event handlers.
- **All dynamic APIs are async (mandatory in v16).** `params`, `searchParams`, `headers()`, `cookies()`, and `draftMode()` are all Promises. Synchronous access was deprecated in v15 and is **fully removed** in v16.

```tsx
// params — always await
export default async function Page(props: PageProps<"/leagues/[leagueId]">) {
  const { leagueId } = await props.params;
}

// searchParams — always await
export default async function Page(props: { searchParams: Promise<{ weekId?: string }> }) {
  const { weekId } = await props.searchParams;
}

// headers/cookies — always await
import { headers } from "next/headers";
const headersList = await headers();
```

- **Use `PageProps` from `next typegen`.** Run `npx next typegen` to generate route-aware page prop types. This gives you type-safe `params` tied to your actual route segments:

```tsx
// Auto-typed: params will have { leagueId: string }
export default async function Page(props: PageProps<"/leagues/[leagueId]">) {
  const { leagueId } = await props.params;
}
```

- **Route groups for layout boundaries.** Use `(public)` for unauthenticated routes and `(app)` for authenticated routes. Each group gets its own layout.
- **Turbopack** is the default dev bundler in v16. No configuration needed.

### 2.2 File Conventions

Use Next.js file conventions consistently:

| File | Purpose |
|------|---------|
| `page.tsx` | Route UI |
| `layout.tsx` | Shared layout wrapping child routes |
| `loading.tsx` | Suspense fallback for the route segment |
| `error.tsx` | Error boundary (must be a client component) |
| `not-found.tsx` | 404 UI for `notFound()` calls |

### 2.3 What Goes Where

| Logic Type | Location | Example |
|-----------|----------|---------|
| Page rendering | `app/**/page.tsx` | Composing data functions + components |
| Shared layout | `app/**/layout.tsx` | Navbar, auth guard, tab navigation |
| Data access (reads) | `data/*.ts` | `getLeagueStandings()` |
| Data access (writes) | `data/*.ts` | `insertPick()`, `updateLeague()` |
| Mutations / orchestration | `actions/*.ts` | `submitPicks()` — validate, auth, call data layer, revalidate |
| Database schema | `lib/db/schema/*.ts` | Table definitions |
| Business logic | `lib/*.ts` | Scoring calculations, lock time checks |
| Shared validation | `lib/validators/*.ts` | Zod schemas |
| UI components | `components/**/*.tsx` | Reusable React components |
| shadcn primitives | `components/ui/*.tsx` | Button, Card, Dialog, etc. |

**Do not** put business logic in components. Components render; functions compute.

**Do not** put Drizzle calls outside `data/`. The data layer is the only place ORM-specific code lives.

---

## 3. Data Fetching

### 3.1 Server Components Fetch Directly

All reads happen in Server Components by calling data layer functions. No `useEffect` + `fetch`. No API client layer.

```tsx
// app/(app)/leagues/[leagueId]/page.tsx
import { getLeagueStandings } from "@/data/standings";

export default async function StandingsPage({ params }: Props) {
  const { leagueId } = await params;
  const standings = await getLeagueStandings(leagueId);
  return <StandingsTable standings={standings} />;
}
```

### 3.2 Data Access Layer

All database operations live in `data/`, grouped by domain. Each file exports functions for reading and writing data. This is the **only** place Drizzle ORM code appears in the application.

```
data/
├── utils.ts        # withTransaction helper
├── leagues.ts      # getLeague, getLeaguesByUser, insertLeague, updateLeague
├── picks.ts        # getUserPicks, getPicksByEvent, insertPick, updatePick
├── standings.ts    # getLeagueStandings, upsertStanding
├── events.ts       # getEventsByWeek, getCurrentWeekEvents
├── teams.ts        # upsertTeam
├── members.ts      # getLeagueMembers, getLeagueMember, insertMember, removeMember
├── invites.ts      # getPendingInvites, insertInvite, updateInvite
├── profiles.ts     # getProfileByUserId, updateProfile
└── seasons.ts      # getCurrentSeason, getWeeksBySeason
```

Each data function:
- Takes explicit parameters (no request/context objects)
- Returns typed data
- Calls Drizzle directly
- Has no auth checks (auth is handled by callers)
- Accepts an optional `tx` parameter for participating in transactions

```tsx
// data/standings.ts
export async function getLeagueStandings(leagueId: string): Promise<Standing[]> {
  return db.query.standings.findMany({
    where: eq(standings.leagueId, leagueId),
    with: { user: { with: { profile: true } } },
    orderBy: asc(standings.rank),
  });
}

export async function upsertStanding(data: NewStanding, tx?: Transaction) {
  const client = tx ?? db;
  return client.insert(standings).values(data).onConflictDoUpdate({
    target: [standings.leagueId, standings.userId, standings.seasonId],
    set: { wins: data.wins, losses: data.losses, pushes: data.pushes, points: data.points, rank: data.rank },
  });
}
```

### 3.3 Avoid Waterfalls

When a page needs multiple independent pieces of data, fetch them in parallel:

```tsx
// Good — parallel
const [standings, currentWeek] = await Promise.all([
  getLeagueStandings(leagueId),
  getCurrentWeek(weeks),
]);

// Bad — sequential waterfall
const standings = await getLeagueStandings(leagueId);
const currentWeek = await getCurrentWeek(weeks);
```

### 3.4 No Client-Side Data Fetching (with exceptions)

Do not use `useEffect` + `fetch` or React Query for data that can be fetched on the server. The only exceptions where client-side fetching is acceptable:

- **Search-as-you-type** (e.g., user search in the invite flow) — use a Server Action called from the client with debouncing
- **Polling** (e.g., live scores during a game) — if needed, use client-side polling with `setInterval` calling a Server Action

---

## 4. Mutations (Server Actions)

### 4.1 Structure

Every mutation is a Server Action in `actions/`. Actions **orchestrate** — they validate, authenticate, check permissions, call the data layer, and revalidate. They do not contain Drizzle calls directly.

1. **Validate input** with Zod
2. **Authenticate** — get session (throws `UnauthorizedError` if missing — caught by error boundary)
3. **Authorize** — check the user has permission (throws `ForbiddenError` — caught by error boundary)
4. **Check business rules** — call `lib/` functions for domain validation
5. **Execute** — call data layer functions
6. **Revalidate** — call `revalidatePath()` to refresh affected routes
7. **Return** — return `ActionResult`

```tsx
"use server";

import { SubmitPicksSchema } from "@/lib/validators/picks";
import { getSession } from "@/lib/auth";
import { assertLeagueMember } from "@/lib/permissions";
import { isGameStarted } from "@/lib/scheduling";
import { getEventById } from "@/data/events";
import { insertPicks } from "@/data/picks";

export async function submitPicks(input: SubmitPicksInput): Promise<ActionResult> {
  const validated = SubmitPicksSchema.parse(input);
  const session = await getSession();                       // throws UnauthorizedError
  await assertLeagueMember(session.user.id, validated.leagueId); // throws ForbiddenError

  for (const pick of validated.picks) {
    const event = await getEventById(pick.eventId);
    if (isGameStarted(event)) {
      return { success: false, error: "Picks are locked for this game" };
    }
  }

  await insertPicks(validated.picks.map(p => ({ ...p, userId: session.user.id })));
  revalidatePath(`/leagues/${validated.leagueId}/my-picks`);
  return { success: true, data: undefined };
}
```

### 4.2 Error Strategy

Server Actions use **two error mechanisms** for different situations:

- **Throw** for auth/permission failures (`UnauthorizedError`, `ForbiddenError`). These are caught by `error.tsx` boundaries and show a full-page error. The user shouldn't be here if they see this.
- **Return `ActionResult`** for expected business errors ("picks are locked", "league is at capacity"). These are returned to the calling component, which shows a toast or inline message. The user stays on the page.

```tsx
type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };
```

### 4.3 Calling Server Actions from Client Components

For **forms with fields**, use react-hook-form (see [Section 5](#5-forms)).

For **simple action buttons** (no form fields), call the Server Action directly with loading state:

```tsx
"use client";

import { useTransition } from "react";
import { acceptInvite } from "@/actions/invites";
import { toast } from "sonner";

function AcceptInviteButton({ inviteId }: { inviteId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await acceptInvite({ inviteId });
      if (!result.success) toast.error(result.error);
    });
  }

  return (
    <Button onClick={handleClick} disabled={isPending}>
      {isPending ? "Joining..." : "Accept Invite"}
    </Button>
  );
}
```

### 4.4 Revalidation Strategy

After a mutation, revalidate only what changed:

- `revalidatePath("/leagues/[id]/my-picks")` — after submitting/editing picks
- `revalidatePath("/leagues/[id]")` — after updating league settings
- `revalidatePath("/")` — after accepting/declining an invite (home page shows invites)

Prefer `revalidatePath` over `revalidateTag`. Path-based revalidation is simpler to reason about and sufficient for this app's needs.

---

## 5. Forms

### 5.1 Stack

Use **react-hook-form** with the **Zod resolver** (`@hookform/resolvers/zod`) for all forms. shadcn/ui provides a `Form` component built on top of react-hook-form that handles field wiring, labels, descriptions, and error messages.

```
npm install react-hook-form @hookform/resolvers
```

### 5.2 Pattern

Every form follows the same structure:

1. **Zod schema** — defined in `lib/validators/` (shared with the Server Action)
2. **`useForm` hook** — initialized with the Zod resolver and default values
3. **shadcn `<Form>` wrapper** — provides form context to child fields
4. **`<FormField>` components** — each field connects to the form via `control` and `name`
5. **Server Action submission** — form calls a Server Action on submit

```tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CreateLeagueSchema, type CreateLeagueInput } from "@/lib/validators/leagues";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { createLeague } from "@/actions/leagues";

export function CreateLeagueForm() {
  const form = useForm<CreateLeagueInput>({
    resolver: zodResolver(CreateLeagueSchema),
    defaultValues: {
      name: "",
      seasonFormat: "full",
      size: 10,
      picksPerWeek: 5,
      pickType: "spread",
    },
  });

  async function onSubmit(data: CreateLeagueInput) {
    const result = await createLeague(data);
    if (!result.success) {
      // Show error via toast or form-level error
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>League Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* ... other fields */}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Create League
        </Button>
      </form>
    </Form>
  );
}
```

### 5.3 Key Rules

- **One schema, two consumers.** The Zod schema in `lib/validators/` is used by both the form (client-side validation via resolver) and the Server Action (server-side validation via `.parse()`). Never define validation rules in only one place.
- **Default values are required.** react-hook-form works best with complete default values. Always provide them matching the schema shape.
- **Server Actions handle the mutation.** The form's `onSubmit` calls the Server Action directly. Use `form.formState.isSubmitting` for loading state.
- **Error feedback via toast.** After a failed Server Action call, show error feedback using `sonner` toast notifications. Use `<FormMessage>` for field-level validation errors caught client-side.
- **Forms are always Client Components.** Every form file needs `"use client"`. Keep forms as leaf components — the parent Server Component fetches any data the form needs and passes it as props.

---

## 6. Database (Drizzle)

### 6.1 Data Access Layer

All Drizzle ORM code is isolated in the `data/` directory. No other part of the application imports from Drizzle or writes raw queries. This means:

- **Server Actions** call `data/` functions — they never call `db.insert()` or `db.query` directly
- **Pages** call `data/` functions for reads — they never import Drizzle
- **Business logic** (`lib/`) is ORM-free — it takes data in and returns results out
- **Background jobs** (Inngest) call `data/` functions for syncing

If Drizzle is ever swapped for another ORM, only the `data/` directory changes.

### 6.2 Schema Conventions

- One schema file per domain area (`schema/leagues.ts`, `schema/picks.ts`, etc.)
- Use `pgTable` for table definitions
- All tables include `createdAt` and `updatedAt` timestamp columns
- Use `uuid` for primary keys (generated by the database via `defaultRandom()`)
- Foreign keys use `references(() => table.column)` with explicit `onDelete` behavior
- Define Drizzle relations using `defineRelations` for the relational query API

### 6.3 Query Patterns

**Use the relational query API** (`db.query.*`) for reads that need related data:

```tsx
// data/leagues.ts
export async function getLeagueWithMembers(leagueId: string) {
  return db.query.leagues.findFirst({
    where: eq(leagues.id, leagueId),
    with: {
      members: true,
      startWeek: true,
      endWeek: true,
    },
  });
}
```

**Use the SQL-like API** (`db.select()`, `db.insert()`, etc.) for:
- Complex joins that the relational API doesn't support cleanly
- Aggregations (`count`, `sum`, etc.)
- Bulk operations
- Inserts, updates, deletes

### 6.4 Transactions

Wrap multi-step writes in transactions. The data layer exports a `withTransaction` helper so that actions never import Drizzle directly:

```tsx
// data/utils.ts
export async function withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
```

Data layer functions accept an optional `tx` parameter to participate in a transaction:

```tsx
// data/members.ts
export async function insertMember(data: NewMember, tx?: Transaction) {
  const client = tx ?? db;
  return client.insert(leagueMembers).values(data).returning();
}

// data/standings.ts
export async function insertStanding(data: NewStanding, tx?: Transaction) {
  const client = tx ?? db;
  return client.insert(standings).values(data).returning();
}
```

Actions orchestrate transactions via `withTransaction`:

```tsx
// actions/invites.ts
import { withTransaction } from "@/data/utils";
import { insertMember } from "@/data/members";
import { insertStanding } from "@/data/standings";

await withTransaction(async (tx) => {
  await insertMember({ leagueId, userId, role: "member" }, tx);
  await insertStanding({ leagueId, userId, seasonId, points: 0, rank: 1 }, tx);
});
```

### 6.5 Upserts

Use `onConflictDoUpdate` for idempotent sync operations:

```tsx
// data/teams.ts
export async function upsertTeam(data: NewTeam) {
  return db.insert(teams).values(data).onConflictDoUpdate({
    target: teams.id,
    set: { name: sql`excluded.name`, abbreviation: sql`excluded.abbreviation` },
  });
}
```

### 6.6 Avoid N+1

Never query inside a loop. If you need related data for a list, either:
- Use the relational API's `with` clause
- Use `inArray()` to batch-fetch

```tsx
// Good — single query
const picks = await db.query.picks.findMany({
  where: inArray(picks.eventId, eventIds),
  with: { team: true },
});

// Bad — N+1
for (const event of events) {
  const pick = await db.query.picks.findFirst({
    where: eq(picks.eventId, event.id),
  });
}
```

### 6.7 Migrations

- Generate migrations with `drizzle-kit generate` after schema changes
- Never manually edit generated migration SQL
- Commit migrations to the repo
- Apply migrations before deploying new code

---

## 7. Authentication

### 7.1 Session Access

Use Better Auth's API to get the session. Create a thin wrapper for consistency:

```tsx
// lib/auth.ts — export a helper
export async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  return session;
}
```

Call `getSession()` at the start of any Server Action or page that requires auth.

### 7.2 Auth Guard

The `(app)/layout.tsx` layout should check for a session and redirect to `/login` if absent. This protects all authenticated routes.

```tsx
// app/(app)/layout.tsx
export default async function AppLayout({ children }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return <AppShell user={session.user}>{children}</AppShell>;
}
```

Individual pages and actions should still call `getSession()` for the user ID — don't pass it through component props chains.

### 7.3 Authorization

Authorization is checked in Server Actions and pages, not in components. Authorization logic lives in `lib/permissions.ts` and calls the data layer to check membership:

```tsx
// lib/permissions.ts
import { getLeagueMember } from "@/data/members";

export async function assertCommissioner(userId: string, leagueId: string) {
  const member = await getLeagueMember(userId, leagueId);
  if (!member || member.role !== "commissioner") {
    throw new ForbiddenError("Must be a commissioner");
  }
}
```

---

## 8. Validation

### 8.1 Zod Schemas

Define Zod schemas in `lib/validators/` grouped by domain:

```
lib/validators/
├── leagues.ts      # CreateLeagueSchema, UpdateLeagueSchema
├── picks.ts        # SubmitPicksSchema
├── invites.ts      # CreateInviteSchema, RespondToInviteSchema
└── profiles.ts     # UpdateProfileSchema
```

### 8.2 Shared Between Client and Server

Schemas are imported by both Server Actions (for validation) and client components (for form validation). This ensures the same rules apply everywhere:

```tsx
// lib/validators/leagues.ts
export const CreateLeagueSchema = z.object({
  name: z.string().min(3).max(50),
  seasonFormat: z.enum(["regular", "postseason", "full"]),
  size: z.number().int().min(2).max(20).default(10),
  picksPerWeek: z.number().int().min(1).max(16).default(5),
  pickType: z.enum(["straight-up", "spread"]),
});

// Used in Server Action:
const validated = CreateLeagueSchema.parse(input);

// Used in client form (via react-hook-form resolver):
const form = useForm({ resolver: zodResolver(CreateLeagueSchema) });
```

### 8.3 Don't Duplicate Validation

If a Zod schema already defines the constraint, don't re-check it in application code. The schema is the single source of truth for input shape validation. Application code handles business rule validation (e.g., "is the league at capacity?").

---

## 9. Business Logic

### 9.1 Single Source of Truth

Every business rule must live in **one place**. If the same logic is needed by a Server Action, a page, and a background job, all three import from the same shared module. Never re-implement a rule in a second location — that's how bugs are born.

### 9.2 Where Business Logic Lives

All business logic functions live in `lib/` under domain-specific modules:

```
lib/
├── scoring.ts       # Pick result calculation (win/loss/push), standings points
├── scheduling.ts    # Pick lock time checks, game window detection, week boundaries
├── permissions.ts   # League membership checks, commissioner-only guards, capacity checks
└── leagues.ts       # Season format resolution, season rollover logic
```

These modules are **pure functions** where possible — they take data in, return results out, and have no side effects. This makes them easy to test and safe to call from anywhere.

The one exception is `lib/permissions.ts`, which calls the data layer to look up membership. This is acceptable because permissions are an inherently data-dependent concern.

### 9.3 Key Business Logic Modules

**`lib/scoring.ts`** — The scoring algorithm:
- `calculatePickResult(pick, outcome)` → `"win" | "loss" | "push"`
- `calculateStandingsPoints(result)` → number
- Used by: standings recalculation (Inngest job), pick display components (via data results), pick result cards

**`lib/scheduling.ts`** — Time-based rules. Use `date-fns` and `date-fns-tz` for all date manipulation and time zone conversions (lock times are defined in Eastern time). Store all dates as UTC in the database; convert to Eastern only for display and lock time calculations. There are **two distinct lock concepts**:
- `isGameStarted(event, now?)` → boolean — has this specific game kicked off? Used to lock individual picks at kickoff. A pick for a started game cannot be edited even if the week deadline hasn't passed.
- `isWeekPastLockTime(week, now?)` → boolean — has the week's pick lock deadline passed (Sunday 1PM ET for regular season, Saturday 1PM ET for postseason)? After this, no new picks can be submitted for any game in the week, and all picks become visible to other members.
- `getWeekLockTime(week)` → Date — the deadline for the week
- `getCurrentWeek(weeks, now?)` → the week containing today
- Used by: pick submission action (both checks), pick visibility logic (`isWeekPastLockTime`), pick UI (show/hide edit controls per game via `isGameStarted`), odds sync (to know when to stop)

**`lib/permissions.ts`** — Authorization logic:
- `assertLeagueMember(userId, leagueId)` → throws if not a member
- `assertCommissioner(userId, leagueId)` → throws if not commissioner
- `assertLeagueNotAtCapacity(leagueId)` → throws if full
- `assertNotInSeason(leagueId)` → throws if league has active season (for settings changes)
- Used by: Server Actions, pages

**`lib/leagues.ts`** — League lifecycle:
- `resolveSeasonWeeks(seasonFormat, season)` → { startWeek, endWeek }
- `canEditLeagueSettings(league)` → boolean
- Used by: league creation action, league settings action, UI display

### 9.4 Rules for Business Logic

- **Never put business logic in components.** Components call functions from `lib/`; they don't implement rules themselves.
- **Never put business logic in page files.** Pages compose data and components; they don't compute results.
- **Server Actions validate and orchestrate; they don't compute.** An action calls `isGameStarted()` from `lib/scheduling.ts` — it doesn't inline the kickoff time comparison.
- **Background jobs import from the same modules.** The standings Inngest job uses `calculatePickResult()` from `lib/scoring.ts` — the same function the UI relies on for display.
- **The data layer has no business logic.** `data/` functions read and write data. They don't decide whether a pick is locked or a league is at capacity.

### 9.5 Example: Pick Scoring

The pick scoring rule lives in one place and is used by multiple consumers:

```tsx
// lib/scoring.ts — THE source of truth for pick results
export function calculatePickResult(
  pick: { teamId: string; spreadAtLock: number | null },
  outcome: { homeTeamId: string; homeScore: number; awayScore: number },
): "win" | "loss" | "push" {
  // Implementation from BUSINESS_SPEC.md Section 8.1
}

// Used in Inngest job (standings/recalculate):
import { calculatePickResult } from "@/lib/scoring";
const result = calculatePickResult(pick, outcome);

// Used in Server Component (to enrich pick display data):
import { calculatePickResult } from "@/lib/scoring";
const enrichedPicks = picks.map(p => ({ ...p, result: calculatePickResult(p, outcomes[p.eventId]) }));
```

---

## 10. Testing

### 10.1 Philosophy

Tests are **documentation of intended behavior**. They prove that business logic produces the correct output for a given input. They also protect existing functionality from accidental breakage during changes.

Focus on **what** the code returns, not **how** it does it internally:
- Assert return values and outputs
- Don't assert that internal functions were called a certain number of times
- Don't test framework behavior (Next.js routing, Drizzle query building, etc.)

### 10.2 Stack

Use **Vitest** as the test runner. It's fast, TypeScript-native, and has the same API as Jest.

```
npm install -D vitest
```

### 10.3 Mocking

Mock imported dependencies — especially the data layer — so tests run fast and don't require a database.

```tsx
// actions/picks.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { submitPicks } from "./picks";

// Mock the data layer
vi.mock("@/data/picks", () => ({
  getEventById: vi.fn(),
  insertPicks: vi.fn(),
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

import { getEventById, insertPicks } from "@/data/picks";

describe("submitPicks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success for unlocked games", async () => {
    (getEventById as any).mockResolvedValue({
      id: "event-1",
      startTime: new Date("2099-01-01"), // future = unlocked
    });

    const result = await submitPicks({
      leagueId: "league-1",
      picks: [{ eventId: "event-1", teamId: "team-a" }],
    });

    expect(result).toEqual({ success: true, data: undefined });
  });

  it("returns error for a locked game", async () => {
    (getEventById as any).mockResolvedValue({
      id: "event-1",
      startTime: new Date("2000-01-01"), // past = locked
    });

    const result = await submitPicks({
      leagueId: "league-1",
      picks: [{ eventId: "event-1", teamId: "team-a" }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("locked");
  });
});
```

The data layer isolates all ORM code, which makes mocking clean — mock `@/data/*` and the entire database is out of the picture.

### 10.4 What to Test

Prioritize in this order:

**1. Business logic functions (`lib/`)** — highest value, easiest to test. These are pure functions with clear inputs and outputs. No mocking needed.

```tsx
// lib/scoring.test.ts
import { calculatePickResult } from "./scoring";

describe("calculatePickResult", () => {
  it("returns win when picked team covers the spread", () => {
    const pick = { teamId: "team-a", spreadAtLock: -3.5 };
    const outcome = { homeTeamId: "team-a", homeScore: 28, awayScore: 21 };
    expect(calculatePickResult(pick, outcome)).toBe("win");
  });

  it("returns push when result lands exactly on the spread", () => {
    const pick = { teamId: "team-a", spreadAtLock: -7 };
    const outcome = { homeTeamId: "team-a", homeScore: 28, awayScore: 21 };
    expect(calculatePickResult(pick, outcome)).toBe("push");
  });
});
```

```tsx
// lib/scheduling.test.ts
import { isGameStarted, isWeekPastLockTime } from "./scheduling";

describe("isGameStarted", () => {
  it("returns false before kickoff", () => {
    const event = { startTime: new Date("2025-09-07T17:00:00Z") };
    expect(isGameStarted(event, new Date("2025-09-07T12:00:00Z"))).toBe(false);
  });

  it("returns true after kickoff", () => {
    const event = { startTime: new Date("2025-09-07T17:00:00Z") };
    expect(isGameStarted(event, new Date("2025-09-07T18:00:00Z"))).toBe(true);
  });
});

describe("isWeekPastLockTime", () => {
  it("returns false before Sunday 1PM ET for regular season", () => {
    const week = { lockTime: new Date("2025-09-07T17:00:00Z") }; // Sunday 1PM ET = 5PM UTC
    expect(isWeekPastLockTime(week, new Date("2025-09-07T16:00:00Z"))).toBe(false);
  });

  it("returns true after Sunday 1PM ET for regular season", () => {
    const week = { lockTime: new Date("2025-09-07T17:00:00Z") };
    expect(isWeekPastLockTime(week, new Date("2025-09-07T18:00:00Z"))).toBe(true);
  });
});
```

**2. Server Actions (`actions/`)** — mock the data layer and auth, then test the orchestration logic: does it validate correctly, reject unauthorized users, call the right data functions, and return the right result?

**3. Permission helpers (`lib/permissions.ts`)** — mock the data layer, test that the right errors are thrown for unauthorized access.

**4. Do not test:**
- React components (UI behavior is verified manually and via the type system)
- Data layer functions (these are thin wrappers around Drizzle — testing them means testing the ORM)
- Next.js routing, layouts, or middleware
- CSS or styling

### 10.5 Test Structure

Colocate test files next to the code they test:

```
lib/
├── scoring.ts
├── scoring.test.ts
├── scheduling.ts
├── scheduling.test.ts
├── permissions.ts
└── permissions.test.ts
actions/
├── picks.ts
├── picks.test.ts
├── leagues.ts
└── leagues.test.ts
```

### 10.6 Rules

- **Mock at the import boundary.** Use `vi.mock("@/data/picks")` to mock entire data modules. This keeps tests focused on the logic being tested.
- **Inject time for time-dependent logic.** Business logic functions that depend on "now" should accept an optional `now` parameter instead of calling `new Date()` internally.
- **Keep tests fast.** All tests mock external dependencies and run in milliseconds.
- **Test edge cases from the business spec.** If BUSINESS_SPEC.md defines a rule (e.g., "push returns 0 points"), there should be a test for it.
- **`beforeEach(() => vi.clearAllMocks())`** in every describe block to prevent test pollution.

---

## 11. Components

### 11.1 Server vs Client Boundary

Default to Server Components. Only add `"use client"` when you need:
- Event handlers (`onClick`, `onSubmit`, `onChange`)
- State (`useState`, `useReducer`)
- Effects (`useEffect`)
- Browser-only APIs (`window`, `localStorage`)
- React 19 hooks (`useActionState`, `useFormStatus`, `useOptimistic`)

### 11.2 Push Client Boundaries Down

Keep `"use client"` as close to the leaves as possible. A common pattern:

```tsx
// Server Component — fetches data
export default async function MyPicksPage() {
  const picks = await getUserPicks(leagueId, userId);
  const events = await getEventsByWeek(weekId);
  return <PickSelector events={events} existingPicks={picks} />;
}

// Client Component — handles interaction
"use client";
function PickSelector({ events, existingPicks }) {
  const [selected, setSelected] = useState(existingPicks);
  // ... toggle/submit logic
}
```

The Server Component does the data fetching. The Client Component only handles the interactive bits.

### 11.3 Component Organization

```
components/
├── ui/                 # shadcn/ui primitives (Button, Card, Dialog, etc.)
├── app-layout.tsx      # Navbar, mobile menu, user dropdown
├── week-switcher.tsx   # Prev/next week navigation
├── picks/
│   ├── pick-display.tsx          # Read-only pick result card
│   └── interactive-pick.tsx      # Clickable team selection (client)
├── leagues/
│   ├── league-card.tsx           # League preview card
│   └── league-settings-form.tsx  # Settings form (client)
├── standings/
│   └── standings-table.tsx       # Sortable standings table (client)
├── members/
│   ├── member-list.tsx
│   ├── invite-link-form.tsx      # Create invite link (client)
│   └── direct-invite-form.tsx    # Search + invite user (client)
└── common/
    └── confirm-dialog.tsx        # Reusable confirmation modal (client)
```

### 11.4 No Business Logic in Components

Components should render data and handle UI interactions. They should not:
- Calculate pick results (that's `lib/scoring.ts`)
- Determine permissions (that's `lib/permissions.ts`)
- Call the data layer directly (pages do that and pass data as props)

```tsx
// Bad — business logic in component
function PickDisplay({ pick, outcome }) {
  const adjustedScore = outcome.homeScore + pick.spread;
  const result = adjustedScore > outcome.awayScore ? "win" : "loss";
  return <Badge>{result}</Badge>;
}

// Good — logic extracted
import { calculatePickResult } from "@/lib/scoring";

function PickDisplay({ pick, outcome }) {
  const result = calculatePickResult(pick, outcome);
  return <Badge>{result}</Badge>;
}
```

---

## 12. Styling (Tailwind v4)

### 12.1 Setup

Tailwind CSS v4 uses **CSS-first configuration**. No `tailwind.config.js` file.

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  --color-primary: /* your brand color */;
  --color-destructive: /* red for errors/danger */;
  --radius-lg: 0.5rem;
  /* ... other theme tokens */
}
```

### 12.2 Dark Mode

Use `next-themes` for the theme toggle (light/dark/system). Tailwind v4's `dark:` variant works with the `class` strategy by default when using `next-themes`.

### 12.3 Conventions

- Use Tailwind utility classes directly. Don't create CSS files for component styles.
- Use the `cn()` helper (clsx + tailwind-merge) for conditional classes:

```tsx
import { cn } from "@/lib/utils";

<div className={cn(
  "rounded-lg border p-4",
  isWin && "border-green-500 bg-green-50",
  isLoss && "border-red-500 bg-red-50",
)} />
```

- Don't use `@apply` except in `globals.css` for base styles.
- Responsive design: mobile-first. Use `sm:`, `md:`, `lg:` breakpoints.

---

## 13. Error Handling

### 13.1 Error Classes

Define a small hierarchy of errors in `lib/errors.ts`:

```tsx
export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request") { super(400, message); }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") { super(401, message); }
}
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") { super(403, message); }
}
export class NotFoundError extends AppError {
  constructor(message = "Not found") { super(404, message); }
}
```

### 13.2 Where Errors Are Thrown

- **Auth helpers** throw `UnauthorizedError` when no session exists
- **Permission helpers** throw `ForbiddenError` when access is denied

These are "shouldn't be here" errors — the user is in a state they shouldn't be in. They bubble up to `error.tsx` boundaries.

### 13.3 Where Errors Are Returned

- **Server Actions** return `{ success: false, error: "message" }` for expected business errors ("picks are locked", "league at capacity"). The calling component shows a toast or inline message. The user stays on the page.

See [Section 4.2](#42-error-strategy) for the full error strategy.

### 13.4 Where Errors Are Caught

- **`error.tsx`** boundaries catch thrown errors (auth/permission) and display user-friendly messages
- **Client components** check `result.success` from Server Actions and display feedback via `sonner` toast or `<FormMessage>`
- **Don't catch and swallow errors silently.** If something fails, the user should know.

### 13.5 Sentry

Unexpected errors (not `AppError` subclasses) should be captured to Sentry. Configure Sentry's Next.js SDK to automatically capture unhandled exceptions. Don't manually call `Sentry.captureException` for expected business errors.

---

## 14. TypeScript

### 14.1 Strict Mode

Enable `strict: true` in `tsconfig.json`. No exceptions.

### 14.2 Infer, Don't Declare

Let Drizzle and Zod infer types. Don't manually write interfaces that mirror your schema.

```tsx
// Good — inferred from schema
type League = typeof leagues.$inferSelect;
type NewLeague = typeof leagues.$inferInsert;

// Good — inferred from Zod
type CreateLeagueInput = z.infer<typeof CreateLeagueSchema>;

// Bad — manually duplicated
interface League {
  id: string;
  name: string;
  // ... mirrors the schema
}
```

### 14.3 No `any`

Never use `any`. Use `unknown` and narrow with type guards when you don't know the type. The only acceptable place for `any` is in type assertions for third-party library gaps, and those should be commented with why.

### 14.4 Consistent Return Types

Data layer functions should have explicit return types for documentation clarity:

```tsx
// Data layer — explicit return type
export async function getLeague(leagueId: string): Promise<LeagueWithMembers | null> { }
```

Server Actions should always return `ActionResult` (see [Section 4.2](#42-error-strategy)):

```tsx
// lib/types.ts
type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

// Every Server Action returns this shape
export async function createLeague(input: CreateLeagueInput): Promise<ActionResult<{ leagueId: string }>> { }
export async function submitPicks(input: SubmitPicksInput): Promise<ActionResult> { }
```

Auth and permission errors are the exception — they throw (caught by error boundaries, never reach the return).

---

## 15. Performance

### 15.1 Server Components First

The single biggest performance win. Server Components send zero JavaScript to the client. Every component that doesn't need interactivity should be a Server Component.

### 15.2 Parallel Data Fetching

Use `Promise.all` for independent data calls in the same page (see [Section 3.3](#33-avoid-waterfalls)).

### 15.3 Loading States

Use `loading.tsx` files to show meaningful loading UI while Server Components fetch data. For client-side transitions, use `useTransition` to get `isPending` state.

### 15.4 Database

- Use Drizzle's relational queries to fetch related data in a single query instead of multiple round trips
- Use `inArray()` for batch lookups instead of loops
- Use transactions for multi-step writes (single round trip)
- Add database indexes for columns used in `WHERE` and `ORDER BY` clauses (league_id, user_id, event_id on picks/standings tables)

### 15.5 Images

Use `next/image` for team logos and user avatars. It handles lazy loading, resizing, and format optimization automatically.

### 15.6 Bundle Size

- Keep `"use client"` components small and leaf-level
- Don't import large libraries in Client Components (e.g., don't import all of `date-fns` — import specific functions)
- shadcn/ui components are already tree-shakeable since they're local files

---

## 16. Linting & Formatting

### 16.1 ESLint

Use **ESLint** with the Next.js built-in configuration. Next.js 16 ships with ESLint support via `next lint`.

```json
// .eslintrc.json
{
  "extends": ["next/core-web-vitals", "next/typescript"]
}
```

`next/core-web-vitals` includes React, React Hooks, and Next.js-specific rules. `next/typescript` adds TypeScript-aware rules. No additional plugins are needed.

Run linting:

```bash
npx next lint
```

### 16.2 Prettier

Use **Prettier** for code formatting. It handles all style decisions (semicolons, quotes, indentation) so developers and AI agents don't have to think about it.

```
npm install -D prettier eslint-config-prettier
```

`eslint-config-prettier` disables ESLint rules that conflict with Prettier. Add it to the ESLint config:

```json
// .eslintrc.json
{
  "extends": ["next/core-web-vitals", "next/typescript", "prettier"]
}
```

Keep Prettier config minimal — the defaults are fine. Only override if the team has a strong preference:

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "all"
}
```

Run formatting:

```bash
npx prettier --write .
```

### 16.3 Integration

- **Pre-commit**: Run `next lint` and `prettier --check` before commits. Use `lint-staged` with `husky` to automate this.
- **CI**: Run both lint and format checks in CI. Fail the build if either reports issues.
- **Editor**: Configure VS Code (or your editor) to format on save with Prettier and show ESLint errors inline.

### 16.4 No Custom Rules

Don't add custom ESLint rules beyond what `next/core-web-vitals` and `next/typescript` provide. The goal is zero configuration overhead. If a rule needs to be disabled frequently, it's probably not right for this project — disable it globally rather than sprinkling `eslint-disable` comments everywhere.

---

## 17. File & Naming Conventions

### 17.1 File Names

- **kebab-case** for all files: `league-card.tsx`, `submit-picks.ts`, `create-league-schema.ts`
- **No index files** for re-exporting. Import directly from the source file. Index files obscure where things live.

### 17.2 Function Names

- **Data layer reads**: `get*` — `getLeague`, `getUserPicks`, `getLeagueStandings`
- **Data layer writes**: `insert*`, `update*`, `upsert*`, `remove*` — `insertPick`, `updateLeague`, `removeMember`
- **Server Actions**: verb + noun — `createLeague`, `submitPicks`, `respondToInvite`
- **Auth assertions**: `assert*` — `assertCommissioner`, `assertLeagueMember`, `assertNotInSeason`
- **Business logic**: descriptive — `calculatePickResult`, `isGameStarted`, `isWeekPastLockTime`, `formatSpread`

### 17.3 Directory Rules

- Flat over nested. Don't create directories with a single file.
- Group by feature domain, not by technical role (except for the top-level `data/`, `actions/`, `components/` split which provides clarity on the data flow).
- If a component is only used in one page, consider colocating it in the route folder instead of the shared `components/` directory.

### 17.4 Environment Variables

Maintain an `.env.example` file at the project root listing all required environment variables with placeholder values. This serves as documentation for new developers and AI agents setting up the project. Never commit actual secrets — `.env` and `.env.local` must be in `.gitignore`.

### 17.5 Exports

- Prefer named exports over default exports (except for Next.js page/layout components which require default exports).
- One primary export per file. A file can have supporting types and helpers, but if it's growing, split it.
