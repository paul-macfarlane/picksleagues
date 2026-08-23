import { createFileRoute } from "@tanstack/react-router";
import { StaticPage } from "@/components/static-page";

export const Route = createFileRoute("/rules/survivor")({
  component: SurvivorRules,
});

// Reader-shaped restatement of docs/mvp-spec.md §Game Mode 2 — the spec is
// the source of truth, and a rules change edits both or the guide lies.
function SurvivorRules() {
  return (
    <StaticPage eyebrow="Rules" title="NFL Survivor rules">
      <section>
        <p>
          A survivor pool across the NFL regular season. Each week, every member picks one team to
          win, straight up. Correct — you advance. Incorrect, or no pick — you&apos;re out. Last
          member standing wins.
        </p>
      </section>

      <section>
        <h2>Weekly picks</h2>
        <ul>
          <li>
            One pick per week, and each member has exactly <strong>one life</strong> — a single
            wrong week eliminates.
          </li>
          <li>
            <strong>Each team can be used at most once all season.</strong> Teams you&apos;ve
            already picked are unavailable in your future weeks.
          </li>
          <li>
            Picks can be made or changed <strong>until the picked game&apos;s kickoff</strong>, and
            become visible to the league at kickoff.
          </li>
          <li>A missed week counts as a wrong pick — you&apos;re eliminated.</li>
        </ul>
      </section>

      <section>
        <h2>Survival and elimination</h2>
        <ul>
          <li>
            <strong>Everyone out in the same week?</strong> All members eliminated that week are
            revived and play on — whatever the mix of wrong and missed picks.
          </li>
          <li>
            <strong>Ties:</strong> a tie advances you, with the team consumed — the game was played,
            so the team is spent.
          </li>
          <li>
            <strong>Cancelled game:</strong> counts as a push — you survive, and the team is not
            consumed. A game postponed within the same week resolves normally when played.
          </li>
          <li>
            Eliminated members stay in the league with full visibility of everyone&apos;s picks —
            they just can&apos;t make any more of their own.
          </li>
        </ul>
      </section>

      <section>
        <h2>Winning</h2>
        <p>
          The league concludes at whichever comes first: the final week of its range settles, or
          settlement leaves exactly one member alive. The members alive at that moment win — if
          several make it to the end together, they are co-winners and share first place. There are
          no extension weeks and no tiebreaker.
        </p>
      </section>

      <section>
        <h2>The board</h2>
        <p>
          The survivor board shows every member&apos;s status (alive or eliminated), the week they
          went out, their week-by-week pick history — each pick revealed at its game&apos;s kickoff
          — and the teams they&apos;ve consumed.
        </p>
      </section>
    </StaticPage>
  );
}
