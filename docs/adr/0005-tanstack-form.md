# 0005. TanStack Form for SPA forms

- **Status:** Accepted
- **Date:** 2026-07-21
- **Related:** architecture.md §Stack (SPA row); .claude/rules/engineering.md (Forms rule); apps/web/src/components/form-field.tsx

## Context

The first two data-entry forms (username claim, profile) were hand-rolled: one `useState` per field plus per-field error state, duplicated aria wiring, and copy-pasted 409-to-field-error handling. Human review asked for a form library before more forms land (league creation is a multi-step settings form). Candidates: TanStack Form, react-hook-form, or continuing hand-rolled.

## Decision

**`@tanstack/react-form` is the forms standard for the SPA.**

- The workspace's Zod v4 schemas implement Standard Schema, which TanStack Form accepts as field validators directly — `UsernameSchema`/`DisplayNameSchema` from `packages/schemas` plug in with no resolver package and no restated rules, preserving the one-definition-per-DTO rule. react-hook-form would need the `@hookform/resolvers` shim.
- Its controlled-field model fits the Base UI/shadcn `Input` primitives; react-hook-form's register-centric uncontrolled model does not.
- It completes an ecosystem already locked in (TanStack Router + Query).
- Server-side field conflicts (e.g. username 409) map to field errors via `form.setErrorMap`; all other failures follow the shared toast rule. Per-field Label/Input/error a11y wiring lives in one shared `FormTextField` component.

## Consequences

- Codified in `.claude/rules/engineering.md` (Forms rule); both existing forms migrated with behavior parity (submit-only validation, typing-clears-error, changed-fields-only PATCH).
- Inside a form `onSubmit`, mutations are invoked fire-and-forget (`mutate`, not awaited `mutateAsync`) — form-core re-throws awaited rejections out of `handleSubmit` as unhandled rejections; the mutation's `onError` owns failures.
- One more dependency in `apps/web`; future forms (league creation, settings) start from this pattern instead of re-deciding.
