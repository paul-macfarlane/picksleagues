# 0047. Shared repository harness with thin host adapters

- **Status:** Accepted
- **Date:** 2026-09-08
- **Related:** `AGENTS.md`, `docs/harness/README.md`; supersedes Claude-only instruction ownership

## Context

Engineering rules, task workflows, and review instructions lived under `.claude/`, with tool names and an Opus model selection embedded in them. Codex could not discover the same working contract automatically, and copying the harness would create two sets of rules that drift.

## Decision

Use root `AGENTS.md` as the common entry point and `docs/harness/` as the single source for engineering standards, workflows, and the independent evaluator. Add thin Codex skill adapters in `.agents/skills/` for explicit `$task`-style invocation. Retain thin Claude adapters and its existing permission hook. Use host capabilities instead of model or tool names; agents without independent review must report that gate pending. Worktree environment setup follows the existing prohibition on agents reading or writing live secrets.

## Consequences

Codex and other agents can follow the workflows through ordinary requests or native skill mentions, while Claude retains its slash commands. Instruction portability does not make Claude's hook portable: native permissions and protected branches remain necessary enforcement layers. Product architecture and MVP rules are unchanged. Add a host-specific adapter only when it provides a capability that shared documents cannot.
