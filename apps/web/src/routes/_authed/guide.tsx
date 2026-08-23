import { createFileRoute, Link } from "@tanstack/react-router";
import { useMe } from "@/api/me";
import { AdminGate } from "@/components/admin/admin-gate";
import { StaticProse } from "@/components/static-page";

export const Route = createFileRoute("/_authed/guide")({
  component: () => (
    <AdminGate>
      <AdminGuide />
    </AdminGate>
  ),
});

// A standalone route linked from the Admin heading rather than an Admin tab:
// with it the admin bar was seven tabs, which scrolls at phone width (owner,
// 2026-08-22). Operator-shaped consolidation of docs/runbooks/jobs.md and
// docs/simulator-guide.md (ADM-5) — those docs are the source of truth, and a
// change to job behavior, cadence, overrides, or the simulator edits them and
// this page or this page lies. Deliberately repo-free: it exists so admin
// duties can be handed to someone who never opens the repository; anything
// that needs the repo (env vars, secrets, deploys) stays in docs/runbooks.
function AdminGuide() {
  const me = useMe();
  // Sim section only where the simulator exists — in production it describes
  // controls the reader can never see (ADR-0011 non-registration).
  const simEnabled = me.data?.simEnabled ?? false;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      {/* Eyebrow over the title, the shape every other guide page takes
          (`StaticPage`) — the one static page under the admin chrome reads as
          the same kind of page as the rules it sits beside. */}
      <header className="flex flex-col gap-1.5">
        <p className="type-eyebrow">Guide</p>
        <h1 className="text-2xl text-foreground">Admin guide</h1>
      </header>
      <div className="max-w-2xl">
        <StaticProse>
          <section>
            <p>
              This page is the manual for the admin side of the app: what each tab does, how the
              data gets here, and what to do when something looks wrong. Admin is an app-wide
              operator role, separate from being a league commissioner — it is granted only by a
              direct database update, checked on the server for every request, and invisible to
              everyone else. Everything below operates on live data.
            </p>
          </section>

          <section>
            <h2>How data gets into the app</h2>
            <p>
              Scheduled jobs pull NFL data from the provider into our own tables; every page in the
              app reads only our tables. Nothing you or a member does triggers a live call to the
              provider. Two consequences do most of the explaining when something looks off: if data
              is <strong>stale</strong>, a job hasn&apos;t run yet (or failed); if data is{" "}
              <strong>wrong at the source</strong>, you correct it with an override — never by
              waiting for the provider to fix itself.
            </p>
          </section>

          <section>
            <h2>Jobs</h2>
            <p>
              The Jobs tab has a button for each sync. Every job is <strong>idempotent</strong>:
              running one that has nothing to do is a harmless no-op, so pressing a button is always
              safe, no matter how recently it ran on its own.
            </p>
            <ul>
              <li>
                <strong>Sync schedule</strong> — seasons, weeks, games, and kickoff times. Runs
                twice a day; in the offseason it also creates the upcoming season on its own.
              </li>
              <li>
                <strong>Sync odds</strong> — point spreads for the current week and the next one.
                Runs three times a day in season.
              </li>
              <li>
                <strong>Sync scores</strong> — live and final scores, every 15 minutes. As a game
                goes final this job also grades its picks and updates standings, so results normally
                appear within minutes without anyone doing anything.
              </li>
              <li>
                <strong>Sync stats</strong> — team records, season stats, and the matchup
                sheet&apos;s injury/context data. Runs twice a day; the sheet shows its own &quot;as
                of&quot; stamp.
              </li>
            </ul>
            <p>
              A fifth job, the <strong>settlement sweep</strong>, has no button: it re-derives every
              league&apos;s results and standings from stored data twice a day as a safety net, so
              any correction or missed tick is reconciled by the next sweep at the latest.
            </p>
          </section>

          <section>
            <h2>Browsers</h2>
            <ul>
              <li>
                <strong>Games</strong> — every game in a selected week: kickoff, status, scores,
                spread, and the per-game override editor.
              </li>
              <li>
                <strong>Teams</strong> — team identity (name, abbreviation, location, logos) with
                its own override editor. Identity shows up everywhere in the app, so this is where a
                provider&apos;s wrong logo or renamed team gets fixed once.
              </li>
              <li>
                <strong>Stats</strong> — what the stats sync wrote: per-team season stats and
                records, and each game&apos;s matchup context, with as-of stamps and override
                editors.
              </li>
            </ul>
          </section>

          <section>
            <h2>Overrides</h2>
            <p>
              Every override works the same way: your correction is stored <em>beside</em> the
              provider&apos;s value and wins wherever the value is shown or used. A later re-sync
              updates the provider&apos;s value but <strong>never touches your correction</strong> —
              it stays until you clear it, and clearing returns the field to provider truth. Every
              override write lands in the Audit tab with who made it, when, and what stood before.
            </p>
            <ul>
              <li>
                <strong>Game overrides</strong> (kickoff, status, scores, spread) feed real
                outcomes: correcting a final score or status re-grades the affected picks and
                standings the next time the game settles — at the latest, the next settlement sweep.
              </li>
              <li>
                <strong>Stat and team identity overrides</strong> are display-only. They fix what
                members read, and affect no scoring.
              </li>
            </ul>
          </section>

          <section>
            <h2>Audit</h2>
            <p>
              Two things live here. The <strong>data integrity</strong> card flags games whose
              kickoff is still ahead while their status or score already gives the outcome away —
              members can still pick those, so correct the kickoff or the result when one appears.
              Below it, the <strong>audit log</strong> is the permanent trail of every override and
              admin action.
            </p>
          </section>

          <section>
            <h2>When something looks wrong</h2>
            <ul>
              <li>
                <strong>You got a job-failure email.</strong> One failure needs no action: every job
                re-runs on its schedule and heals itself (scores within 15 minutes, the daily jobs
                within about 12 hours). To fix it sooner, press the matching sync button — always
                safe.
              </li>
              <li>
                <strong>The same job keeps failing.</strong> Repeated failures are the signal worth
                acting on. Check the job&apos;s execution history in the cron scheduler
                (cron-job.org); after roughly 25 consecutive failures it <em>disables the job</em>,
                and a disabled scores sync means scores and standings stop moving until someone
                re-enables it there.
              </li>
              <li>
                <strong>A score, kickoff, or spread is wrong.</strong> Override it on the Games tab.
                Results and standings pick the correction up when the game next settles.
              </li>
              <li>
                <strong>Standings look wrong right after a correction.</strong> Give it a settlement
                cycle — corrections flow into standings when settlement runs, and the sweep
                reconciles everything twice a day regardless.
              </li>
              <li>
                <strong>The matchup sheet looks stale.</strong> Press Sync stats. The sheet&apos;s
                as-of stamp tells you whether it worked.
              </li>
            </ul>
          </section>

          {simEnabled && (
            <section>
              <h2>Simulator (this environment only)</h2>
              <p>
                This environment has the season simulator: a movable clock plus swappable season
                data, driven from the <Link to="/sim">Simulator</Link> section. Two rules explain
                nearly every surprise. First, the clock and the scenario are{" "}
                <strong>independent levers</strong> — loading a scenario changes what the provider{" "}
                <em>would</em> say, and moving the clock changes <em>when</em> &quot;now&quot; is.
                Second, <strong>nothing in the app changes until a sync job runs</strong> — the
                simulator feeds the same jobs pipeline as real data, so every move is two steps:
                move the clock (or load a scenario), then run the sync.
              </p>
              <ul>
                <li>Reset the environment first — loading doesn&apos;t clear the old season.</li>
                <li>Load a scenario, then run Sync schedule (plus odds and stats).</li>
                <li>Jump the clock to a week, make picks, advance past kickoff.</li>
                <li>Run Sync scores to see results land and standings move.</li>
              </ul>
              <p>
                The member-facing explanation of simulated time lives at{" "}
                <Link to="/rules/simulator">the simulator rules page</Link> — that&apos;s the one to
                send testers.
              </p>
            </section>
          )}

          <section>
            <p className="text-muted-foreground">
              Deeper operational detail — environment variables, secret rotation, deploys, cron
              schedule specifics — intentionally stays in the repository&apos;s runbooks rather than
              here.
            </p>
          </section>
        </StaticProse>
      </div>
    </main>
  );
}
