# OpenAPI contract

Generated artifacts, committed on purpose (arch D4):

- `openapi.json` — the spec, emitted from the Hono routes in `apps/api`.
- `client/` — `openapi-typescript` types consumed by the SPA via `openapi-fetch`.

Regenerate with `pnpm contract:generate` after any Zod schema or route change and commit
schema, spec, and client together. CI fails if regeneration dirties these files
(`pnpm contract:check`).
