# UI Rules

> For full patterns, see [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) Sections 11-12.

## Mobile First

**UX/UI MUST be mobile-first.** Users will primarily use the app on their phones.

- Start with mobile layout, then enhance for larger screens
- Use `sm:`, `md:`, `lg:` breakpoints for progressive enhancement
- Touch-friendly tap targets (minimum 44px)
- Test all flows at mobile viewport widths

## Component Library

- **shadcn/ui** for all UI primitives (Button, Card, Dialog, Table, etc.)
- **Tailwind CSS v4** with CSS-first configuration (no tailwind.config.js)
- **next-themes** for dark mode toggle (light/dark/system)
- **sonner** for toast notifications
- **lucide-react** for icons
- **react-hook-form** + Zod resolver for all forms

## Server vs Client Components

- **Default to Server Components** — only add `"use client"` for interactivity
- Push `"use client"` as close to leaf components as possible
- Server Components fetch data; Client Components handle interaction
- Pass server-fetched data as props to Client Components

## No Business Logic in Components

Components render data and handle UI interactions. They do NOT:
- Calculate pick results (use `lib/nfl/scoring.ts`)
- Determine permissions (use `lib/permissions.ts`)
- Call the data layer directly (pages fetch data and pass as props)

## Styling Conventions

- Use Tailwind utility classes directly — no CSS files for component styles
- Use `cn()` helper (clsx + tailwind-merge) for conditional classes
- No `@apply` except in `globals.css` for base styles
- Responsive: mobile-first with progressive breakpoints

## Forms

- Every form uses react-hook-form with Zod resolver
- One Zod schema shared between form validation and Server Action
- Default values are required for all form fields
- Forms are always Client Components (keep as leaf components)
- Error feedback via sonner toast; field-level errors via `<FormMessage>`

## Design Aesthetic

- Sports fan feel — bold, energetic, not corporate
- Straightforward to use — simplicity is the priority
- No ads, no monetization UI
- Quality-of-life features (standings scenarios, stats for picks)
