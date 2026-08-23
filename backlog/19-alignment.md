# Epic: Alignment (ALN)

Two sweeps across the whole app, both about consistency rather than new
behaviour. The first measures the codebase against the written standards;
the second measures the written product against the running app. The
asymmetry matters: for code, the standards win and the code moves; for
product, **the app wins** — what shipped reflects what the owner actually
wanted over what the v0.3 spec said — but every difference is surfaced for
the owner to confirm before the docs move, because some differences are
bugs and only the owner can say which.

A sweep that finds more than a PR can hold is split, not skipped: append
`ALN-n` tasks per area rather than widening one. Findings that change what
the app does (as opposed to how it's written) leave this epic and go to the
owning epic as a task of their own.

Ref: `.claude/rules/engineering.md` (every rule, with its stated failure);
`docs/design-system.md`; `docs/mvp-spec.md` and `docs/architecture.md`
(locked at v0.3 — deviations recorded per `CLAUDE.md` §Working here).

## Code quality

- [x] **ALN-1** — Standards sweep, report first: walk every rule in `.claude/rules/engineering.md` and every primitive/role in `docs/design-system.md` against the whole codebase (`apps/`, `packages/`, `e2e/`) and produce one findings list — rule, file:line, what's inconsistent — grouped by rule and sized. No fixes in this task; the list is the deliverable, so the fix PRs that follow are reviewable per area instead of one sweep nobody can read. Where a rule is violated in enough places that the *rule* looks wrong rather than the code, say so — that goes to the owner and, if accepted, to `engineering.md` in the same round (per the preamble's own bar). _(deps: none)_
- [ ] **ALN-2** — Fix the ALN-1 findings (`docs/sweeps/ALN-1-standards-sweep.md`), one PR per area the report grouped — its six rule questions were all decided per recommendation (owner, 2026-08-23) and the rule amendments are in `engineering.md`, so each PR sweeps its area against the amended text (e.g. API boundaries/refusals, SPA data bindings, time/clock, surface tiers/type roles, comments/headers, tests). Each PR is pure conformance — no behaviour change — and the evaluator runs on any PR touching scoring, lock/visibility, settlement, overrides, or a migration. Append further `ALN-n` tasks if the report's areas don't fit this one line. _(deps: ALN-1)_

## Product alignment

- [ ] **ALN-3** — Spec-vs-app diff, report first: for every rule in `docs/mvp-spec.md` (each mode's rule set, league lifecycle, visibility, commissioner powers, settlement) and every decision in `docs/architecture.md`'s log and `docs/adr/`, state what the app actually does today — verified in code and, where it's cheap, in the simulator — and mark it **matches** / **differs** / **not implemented**. Every `differs` carries the owner's question: intended (doc moves) or bug (task to the owning epic)? No doc edits and no code changes in this task; the report is the deliverable and it is what the owner triages. _(deps: none)_ _(needs-triage)_
- [ ] **ALN-4** — Owner triage of the ALN-3 report: each `differs` and `not implemented` row gets a verdict — keep the app (doc moves), fix the app (task appended to the owning epic), or drop the rule (doc deletes it). Human-only; the agent's job is to present the rows and record the answers. _(deps: ALN-3)_ _(ready-for-human)_
- [ ] **ALN-5** — Align the docs with the app per the ALN-4 verdicts: `docs/mvp-spec.md`, `docs/architecture.md`, the rules guide in `apps/web` (it is the member-facing copy of the spec and drifts the same way), and the runbooks. The locked docs bump from v0.3 and stay mutually reconciled; a deviation with a reason that outlives this sweep gets an ADR rather than a silent rewrite. _(deps: ALN-4)_
- [!] **ALN-6** — TypeScript 6 → 7 (ALN-1 report, area F). Blocked: `typescript-eslint`'s newest release (8.67) caps its TypeScript peer at `<6.1`, so under TS 7 `pnpm lint` crashes in `typescript-estree` — the upgrade ships when typescript-eslint supports TS 7, not before. Everything else already passes under 7 (typecheck, unit tests, the web build; verified 2026-08-23), and the one deprecation — `baseUrl` in `apps/web/tsconfig.json` — was removed ahead of time in the same check. `@types/node` stays at 24 deliberately: it tracks `engines.node`. _(deps: ALN-1)_
