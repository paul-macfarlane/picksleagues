# Checking NFL injury reports

Season records and injuries have different sources. Before a team completes its
first game, the stats read may show its prior-season record. The injury block is
always the context stored for the selected game; it does not use that fallback.
See ADR-0040 and `apps/api/src/services/nfl/game-stats.ts`.

The Basic view omits Questionable players. Advanced includes every synced entry.
An empty Basic list therefore does not necessarily mean no injuries were reported.
The sheet names this filter and distinguishes filtered entries from an empty report.

`sync-stats` refreshes context for unstarted games in its target week window.
A started game retains its last pregame snapshot. The displayed timestamp is when
stored data last **changed**, not the last successful job run: identical data is
not rewritten. ESPN's event summaries serve live injury information even for old
events; they are not historical injury archives. Simulator reports are synthetic.

## Investigation: 2026-09-09

Read the public [2026 Week 1 scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=1)
and ran all 16 event summaries through the repository's `parseGameStatContext`.
All parsed successfully. Each returned five injury entries per team, with source
entry dates in August/September 2026. For example, the
[NE at SEA summary](https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872656)
identified the 2026 season and included September 7–8 injury entries. These are
2026 reports, not the 2025 season-record fallback. This verifies the event-summary
entries, not completeness relative to every team's full official injury report.

The API regression test in `apps/api/test/nfl-game-stats.test.ts` runs the ingestion
and read path with prior-season records, both with and without current-game injury
context. It checks that Questionable entries survive and the current context's
own timestamp is served alongside the prior-season record.

This investigation did not verify the production database's cached report: the
available browser was signed out. A signed-in check should open Stats → Advanced
for a current matchup and compare the names/statuses and displayed timestamp with
its ESPN summary. Missing context or an unexpectedly old report warrants inspecting
the existing sync job results. Do not run production jobs without approval.
