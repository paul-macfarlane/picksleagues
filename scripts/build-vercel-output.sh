#!/usr/bin/env bash
# Assembles .vercel/output/ (Build Output API v3) — Vercel runs this as the
# project's buildCommand (vercel.json); framework auto-detection is bypassed
# (docs/runbooks/environments.md §Vercel).
#
# The API bundle is ESM, but deps like pg are CJS and call require() for Node
# built-ins at runtime — the createRequire banner is what makes that work.
# Removing it builds fine and then crashes prod at cold start.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf .vercel/output
mkdir -p .vercel/output/static

pnpm --filter @picksleagues/web build
cp -R apps/web/dist/. .vercel/output/static/

FUNC_DIR=.vercel/output/functions/api.func
mkdir -p "$FUNC_DIR"
pnpm exec esbuild apps/api/src/vercel.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --target=node24 \
  --external:pg-native \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="$FUNC_DIR/index.mjs"

cat > "$FUNC_DIR/.vc-config.json" <<'JSON'
{
  "runtime": "nodejs24.x",
  "handler": "index.mjs",
  "launcherType": "Nodejs",
  "shouldAddHelpers": false,
  "supportsResponseStreaming": true
}
JSON

# Route order: immutable-cache headers for hashed assets, then static files,
# then every /api path to the function (it owns its own 404s), then the SPA
# fallback for client-side routes.
cat > .vercel/output/config.json <<'JSON'
{
  "version": 3,
  "routes": [
    {
      "src": "/assets/(.*)",
      "headers": { "cache-control": "public, max-age=31536000, immutable" },
      "continue": true
    },
    { "handle": "filesystem" },
    { "src": "^/api(?:/.*)?$", "dest": "/api" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
JSON

echo "Build Output API assembly complete:"
find .vercel/output -maxdepth 3 -not -path '*/static/assets/*' | sort
