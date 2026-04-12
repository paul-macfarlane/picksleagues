# Next.js 16 Rules

> **Before writing any Next.js code**, read the relevant guide in `node_modules/next/dist/docs/`. Your training data may not reflect Next.js 16 changes.

## Mandatory Patterns

- **Server Components are the default.** Only add `"use client"` when you need browser APIs, event handlers, or React state/effects.
- **All dynamic APIs are async.** `params`, `searchParams`, `headers()`, `cookies()`, and `draftMode()` are all Promises. Synchronous access is **fully removed** in v16.

```tsx
// Always await params
export default async function Page(props: PageProps<"/leagues/[leagueId]">) {
  const { leagueId } = await props.params;
}

// Always await headers/cookies
const headersList = await headers();
```

- **Use `PageProps` from `next typegen`.** Run `pnpm exec next typegen` to generate route-aware page prop types.
- **Route groups**: `(public)` for unauthenticated routes, `(app)` for authenticated routes.
- **Turbopack** is the default dev bundler. No configuration needed.

## File Conventions

| File            | Purpose                                   |
| --------------- | ----------------------------------------- |
| `page.tsx`      | Route UI                                  |
| `layout.tsx`    | Shared layout wrapping child routes       |
| `loading.tsx`   | Suspense fallback                         |
| `error.tsx`     | Error boundary (must be client component) |
| `not-found.tsx` | 404 UI for `notFound()` calls             |

## Revalidation

- Use `revalidatePath()` after mutations, not `revalidateTag()`
- Revalidate only what changed — don't over-invalidate

## Performance

- Use `Promise.all` for parallel data fetching in pages
- Use `loading.tsx` for meaningful loading states
- Keep `"use client"` as close to leaf components as possible
- Use `next/image` for team logos and avatars
