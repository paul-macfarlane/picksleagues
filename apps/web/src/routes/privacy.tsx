import { createFileRoute } from "@tanstack/react-router";
import { StaticPage } from "@/components/static-page";

export const Route = createFileRoute("/privacy")({
  component: Privacy,
});

function Privacy() {
  return (
    <StaticPage title="Privacy Policy" subtitle="Effective August 9, 2026">
      <section>
        <p>
          Picks Leagues stores the minimum it needs to run pick&apos;em leagues, and nothing else.
          This page describes exactly what that is.
        </p>
      </section>

      <section>
        <h2>What we store</h2>
        <ul>
          <li>
            <strong>Your OAuth profile:</strong> when you sign in with Google or Discord we receive
            and store your name, email address, and avatar URL. That is the only personal
            information collected — there are no forms asking for more, and no file uploads.
          </li>
          <li>
            <strong>What you do in the app:</strong> your username, an optional avatar URL you set
            yourself, your leagues and memberships, and your picks and their results.
          </li>
          <li>
            <strong>A session cookie</strong> to keep you signed in, and your theme preference in
            your browser&apos;s local storage. Neither is used to track you.
          </li>
          <li>
            <strong>Server logs</strong> kept by our hosting provider for operating and debugging
            the service.
          </li>
        </ul>
      </section>

      <section>
        <h2>What we don&apos;t do</h2>
        <ul>
          <li>No emails — the service never sends any, marketing or otherwise.</li>
          <li>No third-party analytics or advertising trackers.</li>
          <li>No selling or sharing of your data with anyone.</li>
          <li>No payment information — the service is free and stores none.</li>
        </ul>
      </section>

      <section>
        <h2>Who sees what</h2>
        <p>
          Members of a league you join can see your display name, username, avatar, and — once each
          game locks at kickoff — your picks and results. Your email address is never shown to other
          members. Public leagues additionally list their name and member count in discovery for any
          signed-in user.
        </p>
      </section>

      <section>
        <h2>Service providers</h2>
        <p>
          The app runs on Vercel (hosting) and Neon (database), which process data on our behalf.
          Google and Discord handle sign-in under their own privacy policies. Sports schedules and
          scores come from ESPN&apos;s public data; no user data is sent to ESPN.
        </p>
      </section>

      <section>
        <h2>Deleting your account</h2>
        <p>
          Deleting your account is permanent and immediate, and it works by{" "}
          <strong>anonymizing your profile in place rather than erasing your rows</strong>: your
          username is released for others to claim, your display name is replaced with a
          &quot;Deleted User&quot; placeholder, your email is replaced with a non-identifying
          placeholder, and your avatar, sign-in identities, and sessions are removed. Your picks,
          results, and standings history remain in your leagues, attributed to the anonymous
          placeholder — league history stays intact for the people you played with, while nothing
          identifying you remains. Signing in again with the same provider afterward creates a
          brand-new account.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Picks Leagues is a personally operated project. Questions or requests about your data:
          email{" "}
          <a href="mailto:picksleagues@gmail.com" className="underline hover:text-foreground">
            picksleagues@gmail.com
          </a>
          .
        </p>
      </section>
    </StaticPage>
  );
}
