# 0014. `SIM_ENABLED` toggles the simulator; production overrides it unconditionally

- **Status:** Accepted
- **Date:** 2026-07-25
- **Related:** amends ADR-0011 decision 2 (which made `APP_ENV=production` itself the gate); ADR-0012 decision 5 (sim routes in the committed contract); `docs/architecture.md` §Environments, §Simulator & Time

## Context

The simulator was enabled implicitly, by `APP_ENV !== "production"`. That conflates two
questions — *which environment is this* and *is the simulator available here* — with three
consequences:

- The simulator cannot be turned off in staging without lying about `APP_ENV`, which would
  also change clock and provider behavior, OAuth expectations, and the runbook's meaning.
- There is no way to answer "is the simulator on?" without knowing the environment naming
  convention, so the predicate got re-derived in **five** places: the route mount, `/me`'s
  capability flag, `resolveClock`, `resolveGameDataProvider`, and the runtime deps assembly.
  Five copies of a security-relevant predicate is four too many.
- Toggling required a config change that also changed unrelated behavior — not a toggle.

## Decision

**1. `SIM_ENABLED` is an explicit env var, default false.** Absent means off. This is the
knob: staging can run with the simulator off, or on, without touching `APP_ENV`.

**2. Production ignores it.** `isSimEnabled(env)` is
`env.APP_ENV !== PRODUCTION && env.SIM_ENABLED` — production is a hard override, not a
default that a flag can outrank. The simulator can move the clock and truncate league and
sports data; one mis-set Vercel variable must not be able to point that at the production
database. Enabling it in production would require changing `APP_ENV`, which is a deliberate,
visible act, not a typo.

**3. `isSimEnabled` is the only definition.** `resolveClock` and `resolveGameDataProvider`
now take `simEnabled: boolean` rather than `appEnv` — "the simulator is off" is exactly what
those functions previously meant by "this is production", so the boolean is the honest
parameter. The runtime computes it once and passes it to both, so the clock, the provider,
and the route mount cannot disagree.

**4. The env-less case still mounts the sim routes.** `generate-openapi.ts` builds the app
with no deps, and the routes must appear in the committed contract for the SPA to reach them
through the generated client (ADR-0012 decision 5). The condition is therefore
`deps.env === undefined || isSimEnabled(deps.env)`. A real deployment always supplies env
(`loadEnv` throws otherwise), so spec generation is the only caller that takes that branch —
and even there every handler's own guard returns a misconfiguration 500 rather than serving
anything.

## Consequences

Easier: one predicate instead of five, and a real toggle. Staging can be flipped to
real-ESPN-only for a release rehearsal without pretending to be production. The
`APP_ENV × SIM_ENABLED` matrix is unit-tested, with the production-plus-flag case asserted
on its own so it cannot be lost inside a table.

Harder/accepted: default-false changes existing behavior, so every config surface had to be
updated — `.env.example`, CI's generated `.env`, the test-env factory, and the runbook. A
developer who doesn't update their `.env` silently loses the simulator; the symptom is sim
routes 404ing, which the runbook now names. **Staging's Vercel `SIM_ENABLED` must be set to
`true` manually** — it is not inferable from the branch.

The env var is still not a capability grant: `/sim/*` remains admin-role gated on top of it
(ADR-0011, ADR-0013). `SIM_ENABLED` decides whether the surface exists at all.
