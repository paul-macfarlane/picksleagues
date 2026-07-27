#!/usr/bin/env bash
# predev sweep: anything already listening on the dev API/web ports is by
# definition stale (the dev stack we're about to start owns them for the
# duration of this run) — killing it up front prevents a stale listener from
# either blocking the new process or, worse, silently pushing Vite to 5174,
# which breaks the OAuth callback origin pinned to 5173.
set -euo pipefail

# KILL_STALE_DEV_PORTS lets tests point this at a throwaway port; unset in
# normal `pnpm dev` use, where it defaults to the real api/web ports.
ports="${KILL_STALE_DEV_PORTS:-3000 5173}"

if ! command -v lsof >/dev/null 2>&1; then
  exit 0
fi

# shellcheck disable=SC2086 # ports is intentionally word-split, one per port
for port in $ports; do
  pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    continue
  fi
  echo "kill-stale-dev: killing stale listener(s) on port ${port}: ${pids}"
  # shellcheck disable=SC2086 # pids is intentionally word-split, one per pid
  kill -TERM $pids 2>/dev/null || true
done
