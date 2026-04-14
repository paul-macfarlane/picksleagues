import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How PicksLeagues collects, uses, and protects your data.",
};

const LAST_UPDATED = "April 13, 2026";

export default function PrivacyPage() {
  return (
    <article className="prose prose-invert mx-auto w-full max-w-3xl space-y-6 py-8 text-sm leading-relaxed sm:text-base">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Privacy Policy
        </h1>
        <p className="text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </header>

      <section className="space-y-2">
        <p>
          PicksLeagues is a small, ad-free sports prediction app operated by an
          individual. This policy explains what information we collect, how we
          use it, and the choices you have.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">
          Information we collect
        </h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Account information</strong> from the OAuth provider you
            choose to sign in with (Google or Discord). We receive your email,
            name, and avatar image.
          </li>
          <li>
            <strong>Profile information</strong> you provide, such as your
            username and display name.
          </li>
          <li>
            <strong>Usage data</strong> created as you use the app &mdash;
            leagues you belong to, picks you submit, and related activity
            required to run the game.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">
          How we use information
        </h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>To authenticate you and keep your account secure.</li>
          <li>To run league features: invites, picks, scoring, standings.</li>
          <li>To debug issues and protect the service from abuse.</li>
        </ul>
        <p>
          We do not sell your data. We do not run ads. We do not use your data
          for advertising profiles.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">
          Third-party services
        </h2>
        <p>
          We rely on a small set of service providers to operate the app:
          hosting and deployment, our database provider, and the OAuth sign-in
          providers listed above. They process data only as needed to provide
          their service.
        </p>
        <p>
          Game data (teams, schedules, scores, odds) is fetched from public
          sports data sources and is not tied to your account.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">
          Data retention and deletion
        </h2>
        <p>
          You can delete your account at any time from the account settings
          page. Deletion is handled as <em>soft anonymization</em>: your
          personal details (name, email, avatar) are removed from our systems,
          but records of picks you submitted remain attached to an anonymous
          placeholder so that league history and standings stay intact for the
          other members.
        </p>
        <p>
          If you are the sole commissioner of a league with other members, you
          must transfer the role or remove the league before deleting your
          account.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">Cookies</h2>
        <p>
          We use cookies that are strictly necessary to keep you signed in. We
          do not use tracking or advertising cookies.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">Children</h2>
        <p>
          PicksLeagues is not directed to children under 13 and we do not
          knowingly collect information from them.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">Changes</h2>
        <p>
          We may update this policy from time to time. Material changes will be
          reflected in the &ldquo;last updated&rdquo; date above.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">Contact</h2>
        <p>
          Questions about this policy can be directed to{" "}
          <a
            href="mailto:picksleagues@gmail.com"
            className="underline hover:text-foreground"
          >
            picksleagues@gmail.com
          </a>
          .
        </p>
      </section>
    </article>
  );
}
