# Agent diagnostic API

AGENT-1 / [ADR-0049](../adr/0049-read-only-agent-diagnostics.md). Engineering access to stored NFL facts and league-season aggregates; no repairs, job triggers or generic queries.

## Contract and authentication

The committed `openapi/agent-openapi.json` and public `/api/agent-openapi.json` contain only these four bearer-authenticated GET operations:

| Path under `/api/agent/v1` | Diagnostic |
| --- | --- |
| `/system` | Environment, server time, current NFL season/week IDs and current-week freshness/anomalies |
| `/weeks/{weekId}` | All five game status counts, missing spreads, final games without scores, scheduled games at/past kickoff |
| `/games/{gameId}` | Technical IDs/team abbreviations, kickoff, status, scores, period/clock, spread and whether attribution exists |
| `/league-seasons/{leagueSeasonId}/diagnostics` | Safe settings, current in-range week, member/pick/result/season-standing or Survivor-state counts and inconsistencies |

Send `Authorization: Bearer <credential>` using the consumer's secret configuration, never a URL parameter. Tokens are independently provisioned per environment, 32–256 URL-safe characters (`A–Z`, `a–z`, digits, `_`, `-`). Missing configuration disables access with the same 401 as an invalid credential. Cookies and job headers confer no access. The token does not grant human/admin or job access. Responses use `Cache-Control: no-store`; non-GET methods are refused. Diagnostic UUIDs must come from a known incident/admin view; there is no league enumeration route.

Generate both contracts with `pnpm contract:generate`; never hand-edit them. The consumer must use an explicit environment base URL plus the `/api/...` paths in the isolated contract. No MCP adapter is required.

## Interpreting diagnostics

- V1 system discovery supports NFL, the currently shipped modes. Missing current-season ingestion is `no_season`. Current week reuses the app's in-progress, next, then last-played rule. Unsupported league modes return `unsupported_mode` and zero diagnostic counts rather than pretending they were checked.
- `dataUpdatedAt` / `gameStateUpdatedAt` mean latest relevant row **change**. An unchanged successful poll does not advance them. Week/system freshness is the newest game change in that week, not a guarantee every game is fresh. Odds, schedule and scores share the timestamp. No separate odds/score timestamp, job-success claim or cron-job.org state is exposed.
- `missingSpreadCount` includes every null spread, including cancelled/final games; it is a diagnostic fact, not necessarily an ingestion failure. `scheduledAfterKickoffCount` includes the exact kickoff instant. A scheduled game can remain scheduled until the next poll.
- `submittedPickCount` counts pick rows, not complete weekly submission sets. `gradedPickCount` counts result rows. `ungradedResolvedPickCount` counts picks on cancelled games or scored final games with no result. This can be ordinary settlement lag; no staleness threshold is invented.
- Pick'em `standingStateRowCount` counts cumulative season standings only. Once any result exists, absent cumulative rows for current members count as `missingStandingCount`. Stored cumulative points are compared with summed result points. Weekly ranks/record totals are not recomputed by diagnostics.
- Survivor `standingStateRowCount` counts stored state rows. Missing state is normally alive, so `missingStandingCount` is always zero. Stored eliminated/lives contradictions count as inconsistencies; this is not a complete replay of the everyone-out revival rule.
- `inconsistentRowCount` sums flagged rows across checks: pick/game week mismatch, wrong season or league membership, missing accepted ATS spread, result/pick identity-scope mismatch, and standing/state inconsistencies. A pick and its result can each contribute. `duplicateRowCount` counts excess picks by the mode's unique key; normal database constraints keep this zero. No claim of exhaustive corruption detection is made.
- League diagnostics use a read-only repeatable-read snapshot. No user/member IDs, raw picks, team choices, outcome distributions, names, emails, avatars, league names, invites, dues, arbitrary settings, raw errors or provider free-text values appear. Internal IDs are technical references, not proof of anonymization; small aggregate counts can still describe a small group.

## Rollout and privacy review

1. A human provisions an independent staging `AGENT_API_TOKEN` through deployment secret configuration and configures the consuming agent's bearer credential out of band. No token is created or stored in this repository, Notion, examples or logs.
2. On staging, validate the isolated OpenAPI consumer, valid/invalid auth, all four reads, forbidden methods and the response allowlist. Verify the target environment in `/system`. Never use the general admin contract for this consumer.
3. Review the consumer's actual data handling before production connection. The current `/privacy` page says “No selling or sharing of your data with anyone” and lists Vercel/Neon and sign-in providers. It does not yet explain engineering-agent processing of technical facts and league aggregates. Determine the actual consumer/provider and retention first, then update that disclosure before sending production diagnostics. This implementation deliberately does not invent a provider or claim production sharing has begun.
4. After staging and disclosure review, separately provision a different production token and configure the production consumer. This runbook grants no deployment or production-access approval.

Rotate by replacing the environment's token and updating its consumer; the old token stops working after the deployment/runtime consumes the new configuration. Revoke by removing the variable and rolling out that configuration. There is no multi-token overlap or token-management endpoint. Restrict who can configure the consuming agent: this is one shared engineering principal per environment, not per-person attribution.

## Audit and verification

Logs contain a server-generated request ID, fixed operation ID, environment, status and duration; hosting supplies timestamps. No request/response bodies, caller-supplied IDs, query strings or authorization headers are logged by this boundary. Unexpected agent failures log a generic internal code and return JSON 500; investigate locally using the technical target and request metadata. Existing non-agent logging is unchanged.

Unit tests cover auth/configuration, methods, sanitized failures and isolated OpenAPI security. Integration tests use synthetic local data to cover both modes, aggregate gaps, safe projections, status counts and exact kickoff boundaries. Full existing integration/e2e gates check that mounting the new router leaves member/admin flows intact.
