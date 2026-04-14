import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of PicksLeagues.",
};

const LAST_UPDATED = "April 13, 2026";

export default function TermsPage() {
  return (
    <article className="prose prose-invert mx-auto w-full max-w-3xl space-y-6 py-8 text-sm leading-relaxed sm:text-base">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Terms of Service
        </h1>
        <p className="text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </header>

      <section className="space-y-2">
        <p>
          These terms govern your use of PicksLeagues. By creating an account or
          using the app, you agree to these terms. If you do not agree, do not
          use the service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">Eligibility</h2>
        <p>
          You must be at least 13 years old and able to form a binding agreement
          to use PicksLeagues. The app is intended for casual, private
          competition among friends &mdash; it is not a gambling service and
          does not involve real-money wagering.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">Your account</h2>
        <p>
          You are responsible for safeguarding the OAuth account you use to sign
          in and for all activity that occurs under your account. Keep your
          profile information accurate and up to date.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">Acceptable use</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Do not harass, threaten, or impersonate other users.</li>
          <li>
            Do not attempt to interfere with or disrupt the service, probe for
            vulnerabilities, or access data you are not authorized to access.
          </li>
          <li>
            Do not use the service to organize gambling or any activity that
            violates applicable law.
          </li>
          <li>
            Do not automate interactions with the service or scrape data without
            permission.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">
          Leagues and content
        </h2>
        <p>
          League commissioners are responsible for the leagues they create,
          including invites, membership, and any content they post (such as
          league names). You retain ownership of content you submit and grant us
          a limited license to display it within the app to other league
          members.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">Game data</h2>
        <p>
          Scores, schedules, and odds are provided by third-party data sources
          on a best-effort basis. We do not guarantee their accuracy or
          availability, and we may correct data after the fact when sources
          update their records.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">
          Service availability
        </h2>
        <p>
          PicksLeagues is a personal project offered as-is. We do not guarantee
          uptime, uninterrupted availability, or that the service will be free
          of bugs. We may add, change, or remove features at any time.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">Termination</h2>
        <p>
          You may delete your account at any time from the account settings
          page. We may suspend or terminate accounts that violate these terms or
          that create risk for the service or its users.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">
          Disclaimers and liability
        </h2>
        <p>
          The service is provided &ldquo;as is&rdquo; without warranties of any
          kind. To the fullest extent permitted by law, the maintainer is not
          liable for any indirect, incidental, or consequential damages arising
          out of your use of the service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">
          Changes to these terms
        </h2>
        <p>
          We may update these terms from time to time. Material changes will be
          reflected in the &ldquo;last updated&rdquo; date above. Continued use
          of the service after an update means you accept the updated terms.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold sm:text-xl">Contact</h2>
        <p>
          Questions about these terms can be directed to{" "}
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
