#!/bin/bash
# PreToolUse guard for Bash: force a permission prompt on outward-facing or
# destructive commands, enforced by the harness regardless of model behavior.
# Complements the escalation rules in /task.

cmd=$(jq -r '.tool_input.command // ""')

ask() {
  jq -n --arg reason "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$reason}}'
  exit 0
}

if echo "$cmd" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+push\b'; then
  # Feature-branch pushes are routine; only staging/main need confirmation.
  if echo "$cmd" | grep -qwE '(staging|main)'; then
    ask "git push involving staging/main — confirm"
  fi
  # Bare `git push` (no refspec) targets the current branch's upstream.
  current=$(git -C "${CLAUDE_PROJECT_DIR:-.}" branch --show-current 2>/dev/null)
  if [ "$current" = "staging" ] || [ "$current" = "main" ]; then
    ask "git push while on $current — confirm"
  fi
fi

if echo "$cmd" | grep -qE '\bvercel\b.*--prod|\bvercel[[:space:]]+(promote|rollback)\b'; then
  ask "Vercel production deploy/promote/rollback — confirm"
fi

if echo "$cmd" | grep -qE '\bdrizzle-kit[[:space:]]+(push|migrate)\b'; then
  # Non-local if any DATABASE_URL in the command, env, or .env files points off-localhost
  haystack="$cmd $DATABASE_URL $(grep -hs '^DATABASE_URL=' "$CLAUDE_PROJECT_DIR/.env" "$CLAUDE_PROJECT_DIR/.env.local" 2>/dev/null)"
  if echo "$haystack" | grep -qE 'postgres(ql)?://' && ! echo "$haystack" | grep -qE 'localhost|127\.0\.0\.1'; then
    ask "drizzle-kit migration against a non-local database — confirm"
  fi
fi

# Job/sim endpoints against non-local hosts mutate shared environments.
if echo "$cmd" | grep -qE '\bcurl\b.*/(api/)?(jobs|sim)/' && ! echo "$cmd" | grep -qE 'localhost|127\.0\.0\.1'; then
  ask "job/sim endpoint call against a non-local host — confirm"
fi

exit 0
