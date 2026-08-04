<!-- atlas-v3:guardrails:start -->
# Atlas guardrails and hooks

`CLAUDE.md` declares the repository's cross-cutting guardrails and routes agents
here for their authoritative enforcement, activation, exception, and
troubleshooting rules.

## Layers and failure behavior

- Claude `PreToolUse` enforcement blocks live secret access, secret material,
  destructive or bypassing git, remote/credential tampering, protected-branch
  pushes, unsafe egress, and human-only merge actions. It fails closed.
- Cloud and infrastructure mutation is denied by default; plan, validate, show,
  diff, and confirmed read-only commands remain available. An exception must be
  durable, narrowly scoped, attributable, environment-specific, and time-bounded.
- Claude's native session and subagent transcripts remain the source for
  retrospective tool-call and token analysis; Atlas does not duplicate commands
  or credentials into repository-local audit logs.
- Git pre-commit checks secret-bearing paths and uses gitleaks when available,
  with a documented lower-strength added-line fallback.
- Git pre-push evaluates resolved refspecs and blocks protected branches and
  remote deletion. Commit-msg enforces the configured conventional subject.
- Atlas verification remains failed until every configured repository has the
  committed git-hook path active.

Secret templates such as `.env.example`, `.env.sample`, `.env.template`, and
public keys remain accessible. Live secret files do not.

Claude permission precedence is `deny` over `ask` over `allow`, regardless of
specificity. A permission mode that suppresses prompts may bypass interactive
`ask`; it cannot override `deny` or an enforcement hook.

## Activation and verification

A human activates committed git hooks:

```bash
git config core.hooksPath .githooks
```

Run these commands from the Atlas workspace root, then run `/setup-atlas`
verification afterward. Each generated hook also supports `--self-test`. Never
activate hooks silently during setup.

## Transcripts and privacy

Claude's native session and subagent transcripts already contain tool calls,
results, and token usage. Atlas does not copy that sensitive data into local
repository audit logs. Apply the organization's access and retention policy to
Claude transcripts. A compliance-grade audit trail requires an external,
access-controlled or append-only sink rather than agent-writable repository files.

## Exceptions

A human-approved exception records authorizer, exact action, environment,
scope, and expiry in the ticket or spec. Conversation-only approval is invalid.
Do not weaken a hook or permission rule to grant yourself authority.
<!-- atlas-v3:guardrails:end -->
