# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07-18
- **Related:** —

## Context

Solo project built largely through agent-driven sessions. Decisions made in conversation are lost when the session ends; future work then relitigates or silently contradicts them. Paulitakes proved the ADR habit pays for itself at this scale.

## Decision

Record every non-obvious, hard-to-reverse, or precedent-setting technical decision as an ADR in `docs/adr/`, using `template.md`, created via `/adr`. ADRs are immutable once merged — supersede, don't edit. Decisions that change the locked baseline also update `docs/architecture.md` (and `docs/mvp-spec.md` if product behavior changes), keeping the two reconciled.

## Consequences

Small ongoing writing cost per decision. In exchange: sessions and subagents can trust `docs/` as complete, and the evaluator can flag deviations against a written baseline rather than memory.
