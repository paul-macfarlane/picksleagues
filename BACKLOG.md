# PicksLeagues — Backlog & Progress

> Persistent task tracking for work across sessions. Updated by both humans and AI agents.
>
> **Format**: Markdown checkboxes grouped by feature area. Each item maps to a section of [BUSINESS_SPEC.md](./BUSINESS_SPEC.md) or an infrastructure concern.

---

## How to Read This File

- `[ ]` — Not started
- `[~]` — In progress (note who/what session is working on it)
- `[x]` — Complete
- `[!]` — Blocked (reason noted inline)

Items within a section are ordered by dependency — work top to bottom.

---

## Status Summary

| Status | Count |
|--------|-------|
| Not started | 17 |
| In progress | 0 |
| Complete | 0 |
| Blocked | 0 |

---

## Epic Overview

| # | Epic | Spec Sections | Depends On | Status |
|---|------|---------------|------------|--------|
| 1 | Project Setup & Infrastructure | — (infra) | — | Not started |
| 2 | Authentication & User Profiles | §2, §12.1, §12.7, §13 | Epic 1 | Not started |
| 3 | NFL Data Model & ESPN Sync | §6, §11, §14 | Epic 1 | Not started |
| 4 | Leagues | §3, §14 | Epics 2, 3 | Not started |
| 5 | Membership & Roles | §4, §13 | Epic 4 | Not started |
| 6 | Invitations | §5, §12.2, §12.6, §13 | Epic 5 | Not started |
| 7 | Odds & Spreads | §9, §11 | Epic 3 | Not started |
| 8 | Picks | §7, §12.5, §13 | Epics 5, 7 | Not started |
| 9 | Live Scores, Outcomes & Scoring | §8, §10, §11 | Epics 3, 8 | Not started |
| 10 | Home Page, Navigation & Polish | §3.5, §12.2–12.4 | All previous | Not started |

**Parallelism**: Epics 2+3 can run in parallel. Epics 6+7 can run in parallel. Critical path: 1 → 2/3 → 4 → 5 → 8 → 9 → 10.

---

## Epic 1: Project Setup & Infrastructure

Scaffold the Next.js 16 app with all tooling configured. Nothing user-facing — every subsequent epic depends on this.

- [ ] 1.1 Initialize Next.js 16 project (TypeScript, App Router, Tailwind, ESLint, `src/` directory, strict mode)
- [ ] 1.2 Configure Tailwind CSS v4 (`globals.css` with `@theme`, `next-themes` for dark mode, `cn()` utility with `clsx` + `tailwind-merge`)
- [ ] 1.3 Initialize shadcn/ui (install core components: button, card, input, label, badge, avatar, tabs, table, dialog, sheet, dropdown-menu, select, alert, sonner, etc.)
- [ ] 1.4 Create directory structure matching TECH_STACK.md §7 (`app/(public)`, `app/(app)`, `lib/db/schema/`, `lib/inngest/functions/`, `lib/espn/`, `lib/validators/`, `data/`, `actions/`, `components/`)
- [ ] 1.5 Set up Drizzle ORM + Neon PostgreSQL (`drizzle-orm`, `@neondatabase/serverless`, `drizzle.config.ts`, db client at `lib/db/index.ts`, `withTransaction` helper at `data/utils.ts`)
- [ ] 1.6 Set up Better Auth (Google + Discord OAuth config, catch-all API route, `getSession()` helper, generate auth schema tables)
- [ ] 1.7 Create error classes and core types (`lib/errors.ts`: AppError/BadRequest/Unauthorized/Forbidden/NotFound; `lib/types.ts`: ActionResult)
- [ ] 1.8 Set up Inngest (client at `lib/inngest/client.ts`, index export, API route at `app/api/inngest/route.ts`)
- [ ] 1.9 Set up Vitest (`vitest.config.ts` with path aliases, smoke test for `cn()` utility, `"test"` script in package.json)
- [ ] 1.10 Configure ESLint + Prettier (extend `next/core-web-vitals`, `next/typescript`, `prettier`; `.prettierrc`; format scripts)
- [ ] 1.11 Install shared dependencies (`date-fns`, `date-fns-tz`, `react-hook-form`, `@hookform/resolvers`, `zod`)
- [ ] 1.12 Set up Sentry (`@sentry/nextjs`, wizard config, filter out expected AppError subclasses)
- [ ] 1.13 Create `.env.example` with all required vars (DATABASE_URL, BETTER_AUTH_SECRET, OAuth credentials, Inngest keys, Sentry DSN)
- [ ] 1.14 Generate route type stubs (`npx next typegen`)
- [ ] 1.15 Verify full build (`npm run build`, `next lint`, `prettier --check`, `tsc --noEmit`, `vitest run`)
- [ ] 1.16 Commit scaffold
- [ ] 1.17 Set up GitHub remote and push

### Dependencies
- 1.3 depends on 1.2 (shadcn needs Tailwind)
- 1.6 depends on 1.5 (Better Auth needs database)
- 1.13 accumulates env vars from 1.5, 1.6, 1.8, 1.12
- 1.15 and 1.16 come last (final verification)
- All others can run after 1.1 in any order

### Notes
- The `.env.example` grows as tasks add new env vars — task 1.13 is a final consolidation pass
- shadcn components are installed liberally upfront to avoid repeated init during later epics
- No business logic or user-facing features in this epic

---

## Epic 2: Authentication & User Profiles (BUSINESS_SPEC §2, §12.1, §12.7)

_Tasks will be detailed when Epic 1 is complete._

---

## Epic 3: NFL Data Model & ESPN Sync (BUSINESS_SPEC §6, §11)

_Tasks will be detailed when Epic 1 is complete._

---

## Epic 4: Leagues (BUSINESS_SPEC §3)

_Tasks will be detailed when Epics 2 and 3 are complete._

---

## Epic 5: Membership & Roles (BUSINESS_SPEC §4)

_Tasks will be detailed when Epic 4 is complete._

---

## Epic 6: Invitations (BUSINESS_SPEC §5)

_Tasks will be detailed when Epic 5 is complete._

---

## Epic 7: Odds & Spreads (BUSINESS_SPEC §9)

_Tasks will be detailed when Epic 3 is complete._

---

## Epic 8: Picks (BUSINESS_SPEC §7)

_Tasks will be detailed when Epics 5 and 7 are complete._

---

## Epic 9: Live Scores, Outcomes & Scoring (BUSINESS_SPEC §8, §10)

_Tasks will be detailed when Epic 8 is complete._

---

## Epic 10: Home Page, Navigation & Polish (BUSINESS_SPEC §12)

_Tasks will be detailed when all previous epics are complete._
