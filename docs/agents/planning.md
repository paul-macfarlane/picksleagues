<!-- atlas-v3:planning:start -->
# Repository planning profile

This document is the repository's scoped planning profile. Each entry has the
authority named by its classification; the document is not blanket mandatory
policy.

Read this guide before clarifying, researching, prototyping, specifying,
decomposing, technically planning, or red-team reviewing proposed work. It
routes repository-specific concerns; generic planning mechanics remain in the
invoked skill.

| Classification | Trigger | Required consideration |
|---|---|---|
| confirmed team policy | Any change that would deviate from docs/mvp-spec.md or docs/architecture.md | Stop. Both documents are locked at v0.3 and mutually reconciled. Escalate to the owner and record an ADR via /adr before writing code. Never resolve the deviation autonomously. |
| confirmed team policy | Any code that needs the current time | Read the injected Clock. No Date.now(), no new Date() for now, no SQL now() in domain logic; Clock values reach SQL as bound parameters. In the SPA use useAppNow(). Lock state is derived from kickoff_at vs clock.now(), never stored. |
| confirmed team policy | Changes to scoring, settlement, or standings | packages/scoring stays pure: plain data in, plain data out, no imports from db or core. Settlement is a pure derivation -- every result and standings table must be fully recomputable from (picks, results, settings). Every scoring rule and edge case in docs/mvp-spec.md needs a table-driven unit test; a spec rule without a test case is a review failure. Run /atlas-red-team on this surface. |
| confirmed team policy | Zod schema, DTO, or API route changes | Regenerate and commit openapi/ in the same change. Never wrap an .openapi()-registered schema in .nullable() or .optional() inline -- register a nullable variant as its own component instead; this failure is silent and contract:check stays green while the generated client types go wrong. |
| discovered repository fact | Database schema or migration changes | Plan the forward migration, compatibility with stored rows, rollback, and data verification. Settings JSONB evolves additively with a Zod .default() or ships a data migration -- stored settings and the current schema must never silently diverge. Constraints encode the rules; app-level checks are a second line of defense, not the only line. |
| discovered repository fact | Authentication, authorization, or admin-capability changes | Plan threat, privilege, privacy, and audit impacts. Admin capability is the admin role in users.app_role, checked server-side against the database and granted only by direct DB update. Job endpoints require the shared-secret header; sim endpoints require an admin session AND are not registered when the simulator is disabled. |
| discovered repository fact | Job endpoint or ingestion changes | Jobs must be idempotent -- safe to re-run, safe to double-trigger, safe to fire manually. Request paths never call ESPN; external data is ingested into our tables and reads serve our tables. Job endpoints return non-2xx on failure so the cron scheduler's notifications fire. |
| Atlas recommendation | User-interface changes | Mobile-first: design and verify at phone width first. Bind tests to accessible role and name, never to copy, column index, or DOM structure. Query-backed views go through QueryState with skeletons; failed actions toast, failed views do not. Theme tokens only. Capture UI evidence per the evidence policy. |
| Atlas recommendation | A backlog task lacks a clear outcome even after reading its referenced doc section | Return to the owner. Do not invent acceptance criteria that the locked docs do not support, and do not treat a deliberately thin task line as license to expand scope. |
| unresolved question | Craft debt: duplication, files accreting past roughly 400 lines, idiom drift | Atlas reviews correctness and standards conformity, not craft debt. The repo's /simplify pass is parked in .claude/_parked/ for the duration of this experiment with no Atlas equivalent. Flag craft debt to the owner rather than silently absorbing or silently ignoring it. See docs/atlas-experiment.md section 6. |

Classifications have distinct authority: confirmed team policy is mandatory;
Atlas recommendations are proposals; discovered repository facts are evidence;
unresolved questions must not be silently converted into policy.

## Work-package plan contract

`/atlas-plan <ticket-epic-or-spec>` reads the complete stable contract, existing
technical or execution plan, dependencies, decisions, and relevant repository
areas. For tracked work it also reads state, comments, linked parent specs, and
applicable children. Its plan covers intent, affected areas and interfaces,
ordered steps, declared scope, dependencies, AC and DoD coverage, run surface,
verification commands, real-dependency checks, fixtures, and human
prerequisites. It preserves the stable contract and adequate existing plan
content.

Return an unclear or unbounded work package to `/grill-with-docs`, Wayfinder,
`/to-spec`, or `/to-tickets`; a stable repository spec is a valid input, but
`/atlas-plan` does not invoke those flows or create product specs or child
tickets from unresolved material.

## Review and publication

Red-team policy: Risk-gated rather than mandatory. Run /atlas-red-team on any plan that touches packages/scoring, lock or pick-visibility semantics, settlement or recompute, override precedence, or a database migration -- this repo's bugs will live there. Skip it otherwise: this is a solo repository and red-teaming every plan is not worth the tokens. On demand at the owner's request at any time..

Storage: **repository**. Drafts before approval:
**true**. A repository spec uses
the planning section of sibling `execution.md`; tracked work uses the configured
storage. Exact file or tracker mutations are previewed before publication. Read
`docs/agents/issue-tracker.md` for the authoritative approval and persistence
rules, `docs/agents/triage-labels.md` for decomposition, `docs/agents/domain.md`
for terminology, and `docs/agents/testing.md` for AC, DoD, fixture, and
verification design.
<!-- atlas-v3:planning:end -->
