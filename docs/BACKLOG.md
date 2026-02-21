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

| Status      | Count |
| ----------- | ----- |
| Not started | 0     |
| In progress | 0     |
| Complete    | 48    |
| Blocked     | 0     |

---

## Epic Overview

| #   | Epic                            | Spec Sections         | Depends On   | Status      |
| --- | ------------------------------- | --------------------- | ------------ | ----------- |
| 1   | Project Setup & Infrastructure  | — (infra)             | —            | Complete    |
| 2   | Authentication & User Profiles  | §2, §12.1, §12.7, §13 | Epic 1       | Complete    |
| 3   | NFL Data Model & ESPN Sync      | §6, §11, §14          | Epic 1       | Not started |
| 4   | Leagues                         | §3, §14               | Epics 2, 3   | Not started |
| 5   | Membership & Roles              | §4, §13               | Epic 4       | Not started |
| 6   | Invitations                     | §5, §12.2, §12.6, §13 | Epic 5       | Not started |
| 7   | Odds & Spreads                  | §9, §11               | Epic 3       | Not started |
| 8   | Picks                           | §7, §12.5, §13        | Epics 5, 7   | Not started |
| 9   | Live Scores, Outcomes & Scoring | §8, §10, §11          | Epics 3, 8   | Not started |
| 10  | Home Page, Navigation & Polish  | §3.5, §12.2–12.4      | All previous | Not started |

**Parallelism**: Epics 2+3 can run in parallel. Epics 6+7 can run in parallel. Critical path: 1 → 2/3 → 4 → 5 → 8 → 9 → 10.

---

## Epic 1: Project Setup & Infrastructure

Scaffold the Next.js 16 app with all tooling configured. Nothing user-facing — every subsequent epic depends on this.

- [x] 1.1 Initialize Next.js 16 project (TypeScript, App Router, Tailwind, ESLint, `src/` directory, strict mode)
- [x] 1.2 Configure Tailwind CSS v4 (`globals.css` with `@theme`, `next-themes` for dark mode, `cn()` utility with `clsx` + `tailwind-merge`)
- [x] 1.3 Initialize shadcn/ui (19 core components: button, card, input, label, badge, avatar, tabs, table, dialog, sheet, dropdown-menu, select, alert, sonner, collapsible, navigation-menu, popover, command, form)
- [x] 1.4 Create directory structure matching TECH_STACK.md §7 (`app/(public)`, `app/(app)`, `lib/db/schema/`, `lib/inngest/functions/`, `lib/espn/`, `lib/validators/`, `data/`, `actions/`, `components/`)
- [x] 1.5 Set up Drizzle ORM + PostgreSQL (`drizzle-orm`, `pg`, `drizzle.config.ts`, db client at `lib/db/index.ts`, `withTransaction` helper at `data/utils.ts`)
- [x] 1.5b Set up local PostgreSQL 17 via Docker Compose (port 5433, `docker-compose.yml`)
- [x] 1.6 Set up Better Auth (Google + Discord OAuth config, catch-all API route, `getSession()` helper, auth schema tables)
- [x] 1.7 Create error classes and core types (`lib/errors.ts`: AppError/BadRequest/Unauthorized/Forbidden/NotFound; `lib/types.ts`: ActionResult)
- [x] 1.8 Set up Inngest (client at `lib/inngest/client.ts`, index export, API route at `app/api/inngest/route.ts`)
- [x] 1.9 Set up Vitest (`vitest.config.ts` with path aliases, smoke test for `cn()` utility, `"test"` script in package.json)
- [x] 1.10 Configure ESLint + Prettier (flat config with `eslint-config-prettier`, `.prettierrc`, format scripts)
- [x] 1.11 Install shared dependencies (`date-fns`, `date-fns-tz`, `react-hook-form`, `@hookform/resolvers`, `zod` — most installed via shadcn/ui)
- [x] 1.12 Set up Sentry (`@sentry/nextjs`, `withSentryConfig`, `instrumentation.ts`, filter out expected AppError subclasses)
- [x] 1.13 Create `.env.example` with all required vars (DATABASE_URL, BETTER_AUTH_SECRET, OAuth credentials, Inngest keys, Sentry DSN)
- [x] 1.14 Generate route type stubs (`npx next typegen`)
- [x] 1.15 Verify full build (`npm run build`, `eslint .`, `prettier --check`, `tsc --noEmit`, `vitest run` — all pass)
- [x] 1.16 Commit scaffold
- [x] 1.17 Set up GitHub remote and push

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

## Epic 2: Authentication & User Profiles (BUSINESS_SPEC §2, §12.1, §12.7, §13)

Complete the auth flow end-to-end: OAuth login, auto-generated profile on first login, profile setup wizard, profile editing, and account deletion with soft anonymization.

- [x] 2.1 Create profiles schema (`lib/db/schema/profiles.ts`): profiles table with id (uuid PK), userId (text FK → user.id, unique, cascade delete), username (text, unique, not null), name (text, not null), avatarUrl (text, nullable), setupComplete (boolean, default false). Define Drizzle relations (profile ↔ user). Generate and apply migration.
- [x] 2.2 Create profile data layer (`data/profiles.ts`): `getProfileByUserId(userId)`, `getProfileByUsername(username)`, `insertProfile(data, tx?)`, `updateProfile(userId, data, tx?)`
- [x] 2.3 Create username generator (`lib/username.ts`): `generateUsername(email)` — pure function that derives a username from email prefix (lowercase, strip special chars, append random 4-digit suffix, ensure 3–50 char range)
- [x] 2.4 Create profile validator schemas (`lib/validators/profiles.ts`): `UpdateProfileSchema` — username (3–50 chars, not `"anonymous"`), name (required non-empty string), avatarUrl (optional valid URL or empty string)
- [x] 2.5 Add Better Auth onboarding hook (`lib/auth.ts`): `databaseHooks.user.create.after` — on user creation, generate username from email via `generateUsername()`, parse name from OAuth display name, insert profile with `setupComplete: false`
- [x] 2.6 Create login page (`app/(public)/login/page.tsx`): server component wrapper + client component with Google and Discord OAuth buttons using `authClient.signIn.social()` with `callbackURL: "/"` and `newUserCallbackURL: "/profile?setup=true"`. Redirect to `/` if already authenticated.
- [x] 2.7 Create app layout with auth guard (`app/(app)/layout.tsx`): check session → redirect to `/login` if not authenticated. Check profile `setupComplete` → redirect to `/profile?setup=true` if false (unless already on `/profile`). Move home page from `app/page.tsx` to `app/(app)/page.tsx` (placeholder for now).
- [x] 2.8 Create profile update action (`actions/profiles.ts`): `updateProfile(input)` server action — validate with `UpdateProfileSchema` → authenticate → check username uniqueness (excluding own) → update profile → if setup mode, set `setupComplete: true` → `revalidatePath("/profile")` → return `ActionResult`
- [x] 2.9 Create profile page + form (`app/(app)/profile/page.tsx` + `components/profile/profile-form.tsx`): server component fetches profile, renders client form component. Form uses react-hook-form + `UpdateProfileSchema`. Supports `?setup=true` query param (different heading/CTA: "Complete Your Profile" vs "Edit Profile"). On setup completion, redirect to `/`.
- [x] 2.10 Create account page + delete action (`app/(app)/account/page.tsx` + `actions/account.ts`): account page with "Danger Zone" section. `deleteAccount()` server action performs soft anonymization — sets username to `"anonymous"`, name to `"Anonymous User"`, clears avatar, deletes auth sessions/accounts. Confirmation dialog before deletion. **Note**: "sole commissioner" guard deferred to Epic 5 (requires league membership data).
- [x] 2.11 Write tests: `lib/username.test.ts` (generation from various email formats, length bounds), `lib/validators/profiles.test.ts` (reserved username rejection, length boundaries), `actions/profiles.test.ts` (mock data layer + auth, test uniqueness check, setup completion), `actions/account.test.ts` (soft anonymization behavior)
- [x] 2.12 Verify full build: `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` — all pass

### Dependencies

- 2.2 depends on 2.1 (data layer needs schema)
- 2.5 depends on 2.1, 2.2, 2.3 (hook needs schema, data layer, and username generator)
- 2.7 depends on 2.2 (layout checks profile setup status)
- 2.8 depends on 2.2, 2.4 (action needs data layer and validator)
- 2.9 depends on 2.8 (page needs action)
- 2.10 depends on 2.2 (deletion needs profile data layer)
- 2.11 depends on 2.3, 2.4, 2.8, 2.10 (tests for those modules)
- 2.12 comes last
- 2.3, 2.4, 2.6 have no dependencies within this epic and can start immediately

### Notes

- Account deletion's "blocked if sole commissioner of multi-member league" guard requires league/membership data from Epic 5. For now, deletion is always allowed. The guard will be wired in when `data/members.ts` exists.
- `newUserCallbackURL` on `signIn.social()` handles first-login redirect to profile setup. The `(app)` layout guard is a safety net to catch users who navigate away without completing setup.
- The home page (`app/(app)/page.tsx`) will be a minimal placeholder — full home page UI is Epic 10.
- User search by username/name (§2.2) is used in the invite flow (Epic 6). `getProfileByUsername` is created here; search functionality will be extended in Epic 6.

### Feedback Round 1

- [x] 2.F1 Fix middleware infinite redirect — removed middleware entirely, restructured auth into layout-based checks with nested `(app)/(main)/` route group for profile setup guard
- [x] 2.F2 Add Google/Discord branded SVG icons to OAuth login buttons
- [x] 2.F3 Create splash/landing page at root (`app/page.tsx`) — smart page that checks auth and renders splash or authenticated home. Added `next-themes` dark mode toggle (`ThemeProvider`, `ThemeToggle`), Beta badge, hero, features grid, CTA, footer
- [x] 2.F4 Generate Terms of Service and Privacy Policy pages (`app/(public)/terms/`, `app/(public)/privacy/`) — simple, factual pages based on BUSINESS_SPEC. Added terms/privacy link to login page footer
- [x] 2.F5 Generate and apply profile migration (`drizzle/0001_adorable_quicksilver.sql`), document migration workflow

### Feedback Round 2

- [x] 2.F6 Add avatar preview to profile form — live Avatar component next to URL input with initials fallback from name field
- [x] 2.F7 Create AppHeader with user menu and sign out — `components/app-header.tsx` with logo, user avatar dropdown (Profile, Account, Theme submenu, Sign Out). Added to `(main)` layout. Created authenticated home page at `(app)/(main)/home/page.tsx` with placeholder sections for invites and leagues.

### Feedback Round 5 — Code Quality & Standards

- [x] 2.F8 Delete validator tests (`lib/validators/profiles.test.ts`) — testing Zod schemas means testing the library
- [x] 2.F9 Move DB queries from `actions/account.ts` to data layer — created `data/users.ts` with `updateUser`, `deleteSessionsByUserId`, `deleteAccountsByUserId`. Rewrote `actions/account.test.ts` to mock data layer cleanly
- [x] 2.F10 Add explicit return types to all non-UI functions — type aliases in `data/profiles.ts`, return type on `getSession()` in `lib/auth.ts`
- [x] 2.F11 Extract JSX comments into named components — 6 private components in `app/page.tsx`, 2 in `home/page.tsx`. Removed WHAT comments from `actions/profiles.ts`, `lib/username.ts`
- [x] 2.F12 Unified auth redirect for public pages — created `(public)/layout.tsx` that redirects authed users. Simplified `login/page.tsx`
- [x] 2.F13 Move terms/privacy to `(legal)` route group — accessible to both authed and unauthed users. Auth-aware back link and `AppHeader` for authed users. Moved `join/[token]` out of `(public)` to root level
- [x] 2.F14 Add terms/privacy links to account page — subtle footer below delete section
- [x] 2.F15 Update ARCHITECTURE.md — added §18 (Comments & Readability), updated §6.1 (data layer isolation), §10.4 (don't test validators), §14.4 (explicit return types)

### Feedback Round 6

- [x] 2.F16 Add import sorting — installed `@ianvs/prettier-plugin-sort-imports`, configured groups (react → next → third-party → blank → @/ → relative). Ran format across codebase
- [x] 2.F17 Add underlines to non-button text links — splash footer, legal back links, account legal links now have `underline` class for mobile accessibility
- [x] 2.F18 Fix legal page vertical spacing — removed `py-12 md:py-20` from terms/privacy pages, added to `(legal)/layout.tsx` unauthed path. Authed users now get consistent `py-6` from layout (matching other app pages)
- [x] 2.F19 Move inferred types to schema files — exported `Profile`, `NewProfile` from `schema/profiles.ts` and `User`, `NewUser` from `schema/auth.ts`. Data files import these instead of declaring locally

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
