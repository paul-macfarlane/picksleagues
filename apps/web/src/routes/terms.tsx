import { createFileRoute } from "@tanstack/react-router";
import { StaticPage } from "@/components/static-page";

export const Route = createFileRoute("/terms")({
  component: Terms,
});

function Terms() {
  return (
    <StaticPage eyebrow="Effective August 9, 2026" title="Terms of Service">
      <section>
        <p>
          Picks Leagues is a free web app for running sports pick&apos;em leagues with people you
          know. By creating an account or using the service you agree to these terms.
        </p>
      </section>

      <section>
        <h2>The service</h2>
        <p>
          Picks Leagues lets you create leagues, invite members, make picks on real sporting events,
          and see results and standings. It is a game between friends: no money passes through the
          service, no wagering is offered, and nothing here is a gambling product. Game schedules,
          spreads, and scores come from third-party sports data and are provided as-is — they can be
          late, revised, or wrong, and league results follow the data and the league&apos;s
          settings, with corrections applied by the service&apos;s administrators when warranted.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <p>
          You sign in with a Google or Discord account and claim a username. You are responsible for
          what happens under your account. You must be at least 13 years old to use the service.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <ul>
          <li>No harassment or abuse of other members.</li>
          <li>
            No offensive usernames, display names, league names, or avatar images — commissioners
            and administrators can remove members and content that cross the line.
          </li>
          <li>No attempts to break, overload, or gain unauthorized access to the service.</li>
        </ul>
      </section>

      <section>
        <h2>Leagues and commissioners</h2>
        <p>
          League commissioners control their league&apos;s settings, membership, and invites.
          Joining a league means the members of that league can see your username, display name,
          avatar, and — after each game locks — your picks and results.
        </p>
      </section>

      <section>
        <h2>Account deletion</h2>
        <p>
          You can delete your account at any time from your profile. Deletion is permanent and
          immediate, and works by anonymizing your profile in place: your username is released, your
          display name becomes a placeholder, and your sign-in identities are removed — but your
          past picks, results, and standings remain in the leagues you played in, attributed to an
          anonymous placeholder. There is no undelete. See the Privacy Policy for details.
        </p>
      </section>

      <section>
        <h2>No warranty, limited liability</h2>
        <p>
          The service is provided &quot;as is&quot;, without warranties of any kind. It is a free,
          personally operated project; to the maximum extent permitted by law, the operator is not
          liable for any damages arising from your use of the service, and the service may change or
          shut down at any time.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          These terms may change as the service evolves. Material changes will be reflected on this
          page with a new effective date; continuing to use the service after a change means you
          accept the updated terms.
        </p>
      </section>
    </StaticPage>
  );
}
