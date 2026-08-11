import { createFileRoute } from "@tanstack/react-router";
import { StaticPage } from "@/components/static-page";

export const Route = createFileRoute("/rules/simulator")({
  component: SimulatorGuide,
});

// Reader-shaped restatement of docs/simulator-guide.md for the people testing
// on staging (FB-10) — that doc is the operator source of truth, and a
// simulator change edits both or this guide lies. Public like the rules pages:
// the page only *describes* the simulator; the controls stay admin-only, so
// there is nothing here to gate.
function SimulatorGuide() {
  return (
    <StaticPage
      title="How the simulator works"
      subtitle="What simulated time means when you're testing the app"
    >
      <section>
        <p>
          On a test environment, the app doesn&apos;t run on the real NFL calendar. It runs a{" "}
          <strong>season simulator</strong>: a replayed or hand-built season, on a clock an
          organizer can move. That&apos;s what lets a whole season of picking, scoring, and
          standings play out in an afternoon instead of five months.
        </p>
      </section>

      <section>
        <h2>What this means for you</h2>
        <ul>
          <li>
            <strong>The app&apos;s &quot;now&quot; is not your watch.</strong> Every kickoff time,
            pick deadline, and &quot;starts in&hellip;&quot; label follows the simulated clock. A
            game can kick off, play, and go final while no real time passes at all.
          </li>
          <li>
            <strong>You use the app exactly as you would for real.</strong> Join a league, make your
            picks, watch the standings. Nothing about picking works differently — only the calendar
            is compressed.
          </li>
          <li>
            <strong>Picks still lock at kickoff</strong> — the simulated one. If the organizer
            advances time past a game&apos;s kickoff, that pick is locked and revealed to the
            league, just as a real Sunday would have done.
          </li>
          <li>
            <strong>Results arrive when the organizer advances time.</strong> If your picks seem
            frozen, the season is simply paused between moves — nothing is wrong.
          </li>
          <li>
            <strong>Games showing 0&ndash;0 are &quot;in progress&quot;.</strong> The simulator
            deliberately hides a game&apos;s final score until the game is over, so a live sim game
            always reads 0&ndash;0 until it goes final.
          </li>
        </ul>
      </section>

      <section>
        <h2>How a season gets driven (for the organizer)</h2>
        <p>
          The simulator is two independent levers: a <strong>clock offset</strong> (the app&apos;s
          &quot;now&quot;, shifted) and a <strong>scenario</strong> (the season data a provider
          would report — a replayed real season or a canned edge case). Nothing in the product
          changes until a sync job ingests what the provider says, so every move is two steps: move
          the clock, then run the sync.
        </p>
        <ul>
          <li>
            <strong>Reset</strong> the environment first — loading a scenario doesn&apos;t clear
            previously ingested seasons, and a mix of two seasons is confusing to read.
          </li>
          <li>
            <strong>Load a scenario</strong>, then run the schedule (and odds) sync from Admin
            &rarr; Jobs.
          </li>
          <li>
            <strong>Jump the clock</strong> to a week &mdash; &quot;before first kickoff&quot; is
            the anchor for making picks, &quot;after last game&quot; for settling a finished week.
          </li>
          <li>
            <strong>Advance past kickoffs, then sync scores</strong> — games go final and picks
            grade as the scores land.
          </li>
        </ul>
        <p>
          The full operator reference — anchors, fixtures, the scenario library — lives in the
          repo&apos;s <code>docs/simulator-guide.md</code>.
        </p>
      </section>

      <section>
        <h2>Where it exists</h2>
        <p>
          The simulator only exists on test environments. Production never registers it — real
          leagues always run on the real clock and real NFL data. The simulator controls themselves
          are visible only to an admin, under <strong>Simulator</strong> in the top navigation.
        </p>
      </section>
    </StaticPage>
  );
}
