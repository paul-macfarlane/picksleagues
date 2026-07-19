---
description: Answer an ad-hoc question about current behavior — scout-verified facts first, then a recommendation if one was asked for
argument-hint: <question about how something works or what it should do>
---

Answer this question about the codebase/product: **$ARGUMENTS**

## Ground rules

- **Read-only.** This command investigates and answers; it never edits code, docs, or backlog. If the answer implies a change worth making, end with the concrete next step (a proposed backlog item, `/task`, or `/adr`) and stop.
- **Facts come from scouts, not memory.** Dispatch one or more `scout` subagents to establish current behavior — schema, mutation paths, and render sites for behavior questions; call sites and coverage for code questions. Independent angles go out in parallel. Exception: a question answerable from one known file may be read directly.
- **Check the spec, not just the code.** When the question is "what _should_ it do", also check `docs/mvp-spec.md`, `docs/architecture.md` (incl. its decision log D1–D15), and `docs/adr/` — the answer may already be decided, and a recommendation that contradicts the locked docs must say so explicitly.

## Answer shape

1. **Lead with the direct answer** to what was asked, in plain prose.
2. **Current behavior** — every claim anchored to file:line from scout findings. Distinguish "does X" from "never does X" (absence the scout verified).
3. **Recommendation** (only if asked or the current behavior is a gap/bug) — what to do, why, and the cheapest version that satisfies the requirement. Cite the spec/architecture section it serves or note that it's unspecified.
4. **Next step** — if action is warranted: proposed backlog one-liner and which epic it belongs in, or "run `/task ...`", or "record via `/adr`". If no action is needed, say so.

Keep it a scannable answer, not a research dump — the scout report is raw material, not the deliverable.
