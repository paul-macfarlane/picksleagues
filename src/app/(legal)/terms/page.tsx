import { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Terms of Service — PicksLeagues",
};

export default async function TermsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const backHref = session ? "/account" : "/";

  return (
    <div className="mx-auto max-w-2xl px-6">
      <Link
        href={backHref}
        className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-sm underline transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <h1 className="mb-2 text-3xl font-bold tracking-tight">
        Terms of Service
      </h1>
      <p className="text-muted-foreground mb-10 text-sm">
        Last updated: February 21, 2026
      </p>

      <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold">1. What PicksLeagues Is</h2>
          <p>
            PicksLeagues is a free, invite-only NFL Pick&apos;Em platform. Users
            create or join private leagues, make weekly game predictions
            (straight-up or against the spread), and compete on a season-long
            leaderboard. PicksLeagues is not a gambling or betting service — no
            real money is wagered.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">2. Eligibility</h2>
          <p>
            You must be at least 13 years old to use PicksLeagues. By creating
            an account you confirm that you meet this requirement.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">3. Accounts</h2>
          <p>
            You sign in through a third-party provider (Google or Discord). You
            are responsible for the security of your provider account. One
            person may maintain only one PicksLeagues account.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">4. User Conduct</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Choose a username that is not offensive or misleading.</li>
            <li>Do not impersonate other users or public figures.</li>
            <li>
              Do not attempt to exploit, disrupt, or reverse-engineer the
              service.
            </li>
            <li>
              Commissioners are responsible for managing their own leagues
              fairly.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">5. Leagues &amp; Picks</h2>
          <p>
            All leagues are private and invite-only. Picks must be submitted
            before the weekly deadline and cannot be changed after a game kicks
            off. Scoring is automatic and based on official NFL results sourced
            from ESPN. Spread data shown in the app is for informational
            purposes and is frozen at the time of pick submission.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">6. Account Deletion</h2>
          <p>
            You may delete your account at any time from the Account page. When
            you do, your identity is anonymized but your historical picks and
            standings are preserved to maintain league integrity. If you are the
            sole commissioner of a league with other members, you must transfer
            the commissioner role before deleting your account.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">
            7. Disclaimers &amp; Limitation of Liability
          </h2>
          <p>
            PicksLeagues is provided &ldquo;as is&rdquo; without warranties of
            any kind. We do not guarantee accuracy of NFL data, scores, or
            spreads. We are not liable for any damages arising from your use of
            the service.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">8. Changes to These Terms</h2>
          <p>
            We may update these terms from time to time. Continued use of
            PicksLeagues after changes constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">9. Contact</h2>
          <p>
            Questions about these terms? Reach out via the project&apos;s GitHub
            repository.
          </p>
        </section>
      </div>
    </div>
  );
}
