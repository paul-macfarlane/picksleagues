# Repository agent harness

`AGENTS.md` is the shared entry point. Engineering standards, workflows, and the independent reviewer contract live here; edit them here, not in host adapters. No model, paid plugin, or provider API key is required by the harness itself.

## Using it

- **Codex:** open this repository. Codex reads the root `AGENTS.md` and discovers the six adapters in `.agents/skills/`. Invoke `$task next`, `$backlog`, `$feedback`, `$ask`, `$adr`, or `$worktree`; ordinary requests such as “run task next” still work. In the CLI/IDE, `/skills` opens the selector. If newly added skills do not appear, restart Codex.
- **Claude Code:** the existing `/task`, `/backlog`, `/feedback`, `/ask`, `/adr`, and `/worktree` skills delegate to the same documents. `CLAUDE.md` imports the shared instructions. The evaluator inherits the selected model.
- **Other agents:** explicitly ask the agent to read `AGENTS.md` if its host does not discover it. It needs repository reads and a shell for implementation/testing; browser control is needed only for visual or otherwise untested flows.

Fresh-context review uses the host's independent-agent capability with `evaluator.md` as the brief's review instructions. Supply the diff, acceptance criteria, and plan. If unavailable, prepare a handoff for a separate session or human and leave the review pending. A self-review does not satisfy the risk gate. No particular agent name, model, messaging tool, or review plugin is required.

Worktrees require human-provisioned environment values. Agents can inspect templates and perform other setup, but must not read or copy live secret files. Integration and E2E suites share state and run serially even across worktrees.

## Enforcement boundaries

The shared safety rules in `AGENTS.md` apply everywhere, but instructions are not a security boundary. Claude's permission settings and `PreToolUse` hook remain Claude-only; this migration does not claim equivalent command interception in Codex. The existing hook is a heuristic, not a shell parser. Do not rely on it to catch every spelling or indirect invocation of an operation.

Use each host's native permissions and sandbox; keep protected branches enforced on GitHub. The existing Git pre-commit and CI checks remain agent-independent. Do not enable bypass modes or weaken protection to run a workflow. If mandatory command-level enforcement is required in another host, configure and verify it in that host before granting access to shared environments. This repository does not install global agent configuration or silently grant permissions.

## Maintenance and verification

Keep `.agents/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md`, `.claude/agents/evaluator.md`, and `.claude/rules/engineering.md` as small adapters. Historical ADRs and completed backlog entries can retain their original `.claude/` paths; those paths still resolve to the shared guidance. Runtime launch recipes stay in `docs/runbooks/verification.md`.

For documentation-only harness edits, verify adapter targets, review workflow behavior and safety boundaries, and run `git diff --check`. Application changes still use the normal test gates. Smoke-check a new host with a read-only request such as “use the backlog workflow”; confirm it reads the shared workflow and makes no changes before relying on it for implementation.

Codex discovery follows the [official AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md). A fresh session is the simplest way to ensure a newly added entry point is loaded.
