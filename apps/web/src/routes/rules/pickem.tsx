import { createFileRoute } from "@tanstack/react-router";
import { StaticPage } from "@/components/static-page";

export const Route = createFileRoute("/rules/pickem")({
  component: PickemRules,
});

// Reader-shaped restatement of docs/mvp-spec.md §Game Mode 1 — the spec is
// the source of truth, and a rules change edits both or the guide lies.
function PickemRules() {
  return (
    <StaticPage title="NFL Pick'em rules" subtitle="How a Pick'em league works">
      <section>
        <p>
          A season-long league where members compete to build the best record picking NFL games each
          week, on both a weekly and a cumulative season leaderboard.
        </p>
      </section>

      <section>
        <h2>League settings</h2>
        <ul>
          <li>
            <strong>Season range</strong> — the NFL regular season, weeks 1–18. A league created
            mid-season starts at the first week that hasn&apos;t kicked off yet; the range is fixed
            once the league starts.
          </li>
          <li>
            <strong>Pick type</strong> — Straight Up or Against the Spread, applied to every pick
            all season.
          </li>
          <li>
            <strong>Picks per week</strong> — 1 to 16 (default 5).
          </li>
        </ul>
      </section>

      <section>
        <h2>Weekly picks</h2>
        <ul>
          <li>
            Each week you submit <strong>one set of picks</strong> — the week&apos;s full required
            set, in a single submission. Every game in that week&apos;s slate is eligible, and
            members choose their own games.
          </li>
          <li>
            <strong>The submission is final.</strong> Once it lands, no pick in that week can be
            changed, replaced, or removed. A misclick is permanent for that week.
          </li>
          <li>
            If the week has fewer available games than your league&apos;s picks per week, everyone
            picks every available game.
          </li>
          <li>
            <strong>Each pick locks at its game&apos;s kickoff</strong> — that&apos;s when it
            becomes visible to the rest of the league, and when the game drops out of what a member
            who hasn&apos;t submitted can still pick.
          </li>
          <li>
            Submitting late costs picks, not the week: you submit a full set of what can still be
            picked, and games that already kicked off score nothing. A member who never submits
            scores zero for the week — there is no auto-pick.
          </li>
          <li>
            In Against the Spread leagues, you accept the spreads shown at the moment you submit, on
            the whole set at once.
          </li>
        </ul>
      </section>

      <section>
        <h2>Scoring</h2>
        <ul>
          <li>Correct pick: +1 point.</li>
          <li>Incorrect pick: 0 points.</li>
          <li>Push (against the spread) or tie (straight up): +0.5.</li>
          <li>Cancelled game: treated as a push — there is no substitute pick.</li>
          <li>A game postponed within the same week resolves normally when played.</li>
        </ul>
      </section>

      <section>
        <h2>Standings</h2>
        <ul>
          <li>
            <strong>Weekly</strong> — that week&apos;s points only, resetting each week.
          </li>
          <li>
            <strong>Season</strong> — cumulative points from the league&apos;s start week through
            its end week. A week with no submission counts as zero.
          </li>
          <li>
            Members who tie on points <strong>share the rank</strong> — there is no tiebreaker.
          </li>
          <li>
            A member who joins mid-season simply has zero-point weeks for the weeks already
            completed.
          </li>
        </ul>
      </section>
    </StaticPage>
  );
}
