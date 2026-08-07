# Domain Docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- **`docs/mvp-spec.md`** — the complete MVP rule set for every game mode. Source of
  truth for _what_. **Locked at v0.3.**
- **`docs/architecture.md`** — stack, environments, simulator, data model, decision log
  (D1–D15). Source of truth for _how_. **Locked at v0.3**, mutually reconciled with the
  spec.
- **`docs/adr/`** — read the ADRs touching the area you're about to work in (0001–0017).
- **`CONTEXT.md`** at the repo root, if it exists — the glossary. It does not exist yet;
  `/domain-modeling` creates it lazily when terms actually get resolved. Proceed silently
  in its absence; don't flag it, don't propose creating it upfront.

## File structure

Single-context. The pnpm workspace splits by layer, not by bounded context — `apps/{api,web}`
and `packages/{core,db,schemas,scoring}` are one domain, so there is one root `docs/adr/`
and there will be one root `CONTEXT.md`.

```
/
├── CONTEXT.md              ← created lazily by /domain-modeling
├── docs/
│   ├── mvp-spec.md         ← the what (locked v0.3)
│   ├── architecture.md     ← the how  (locked v0.3)
│   └── adr/  0001…0017
├── apps/{api,web}
└── packages/{core,db,schemas,scoring}
```

## Use the glossary's vocabulary

When your output names a domain concept (a task title, a refactor proposal, a hypothesis,
a test name), use the term as the spec defines it. Don't drift to synonyms. Mode-specific
concepts carry their mode's name — `pickem*`, not a bare generic — per
`.claude/rules/engineering.md`.

If a concept you need isn't defined anywhere, that's a signal: either you're inventing
language the project doesn't use (reconsider), or there's a real gap (note it for
`/domain-modeling`).

## Flag conflicts, never override

If your output contradicts an ADR, surface it rather than silently overriding:

> _Contradicts ADR-0016 (per-mode result and standings tables) — but worth reopening because…_

The same applies with more force to `docs/mvp-spec.md` and `docs/architecture.md`: they are
locked, so a contradiction is a **stop-and-escalate**, not a judgement call. It needs an ADR
via `/adr` before any code changes.
