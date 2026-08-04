<!-- atlas-v3:tooling:start -->
# Repository tooling and plugin capabilities

This document is the authoritative registry of repository capability status and
usage constraints. A listed capability is not blanket permission and never
overrides repository policy, approvals, or guardrails.

Read this guide before work that depends on a cloud provider, infrastructure
tool, language server, browser driver, source host, tracker, or current
third-party library documentation.

| Plugin | Status | Why it applies | Use when | Prerequisites | Install or state |
|---|---|---|---|---|---|
| `context7` | installed | The repository depends on many versioned third-party libraries (TanStack, Drizzle, Hono, Better Auth, Zod v4). | Checking current, version-specific library or framework behavior and examples. | none | active |
| `playwright` | recommended | Playwright configuration and an e2e/ suite are present, and e2e is the merge gate. | Driving browser workflows and capturing UI evidence when the run surface requires it. | none | `/plugin install playwright@claude-plugins-official` |
| `typescript-lsp` | unavailable | TypeScript source was detected, but the required typescript-language-server binary is not on PATH (verified by a read-only path check). | Would be used for language-server diagnostics while navigating and editing TypeScript. | typescript-language-server | `/plugin install typescript-lsp@claude-plugins-official` |
| `github` | declined | The gh CLI is already on PATH and covers pull-request operations, and this repository does not use GitHub Issues -- work is tracked in backlog/. | Not applicable. | none | `/plugin install github@claude-plugins-official` |

`installed` means setup verified the plugin is enabled and any named binary is
available. `recommended` means the repository signals match but installation
still needs human approval. `declined` and `unavailable` are explicit outcomes,
not permission to pretend the capability exists.

Use Context7 when it is installed and a plan or implementation relies on
version-specific external library or framework behavior. Otherwise consult the
primary official documentation and record the source and version used.

Use language-server plugins during code navigation and editing; they supplement
rather than replace the repository's lint, typecheck, and test commands. Use
browser plugins only when a UI or browser run surface exists. Provider, source-
host, tracker, and browser plugins never override Atlas guardrails, repository
permissions, approval policy, or human-only actions.
<!-- atlas-v3:tooling:end -->
