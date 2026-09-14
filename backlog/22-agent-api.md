# Agent API exposure

Source: [owner-approved Notion design](https://app.notion.com/p/3d5c4dbb621780d183a9cbd25a1a3d40).

- [x] **AGENT-1** — Ship the read-only NFL agent diagnostic API, isolated authentication/contract, privacy boundary and rollout documentation per ADR-0049 and `docs/runbooks/agent-api.md`. _(deps: none)_ _(ready-for-agent)_

Credential provisioning, staging/production connection, deployment, durable job history and MCP are outside this implementation slice.

- [x] **AGENT-2** — Add read-only scoring reconciliation for one league season: replay Pick’em results and weekly/season standings, Survivor results/state/team-release flags; return aggregate missing/unexpected/mismatch counts in a repeatable-read snapshot. Reuse scoring/replay rules; test corrections and incomplete weeks; independent review and isolated contract regeneration. No repairs or provider calls. [Notion task](https://app.notion.com/p/3dbc4dbb62178176bb3fd91928e2e466). _(deps: AGENT-1)_ _(ready-for-agent)_

- [ ] **AGENT-3** — Specify diagnostic-assisted repairs: eligible discrepancies, human approval/preview, separate write authorization, audit, concurrency, retry/refusal and recovery rules. Specification only; implementation needs owner approval. [Notion idea](https://app.notion.com/p/3dbc4dbb62178194a44fd59fda09304f). _(deps: AGENT-2)_ _(needs-human-input)_
