import { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Privacy Policy — PicksLeagues",
};

export default async function PrivacyPage() {
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

      <h1 className="mb-2 text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="text-muted-foreground mb-10 text-sm">
        Last updated: February 21, 2026
      </p>

      <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold">1. Information We Collect</h2>
          <p>
            When you sign in with Google or Discord, we receive your name, email
            address, and profile picture from the provider. We also store the
            username and display name you set during profile setup. We do not
            collect passwords — authentication is handled entirely by your OAuth
            provider.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">
            2. How We Use Your Information
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Account &amp; profile</strong>: To identify you within the
              app and display your name, username, and avatar to other league
              members.
            </li>
            <li>
              <strong>Gameplay</strong>: To record your picks, calculate scores,
              and maintain league standings.
            </li>
            <li>
              <strong>Communication</strong>: To display invites and league
              activity within the app. We do not send marketing emails.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">3. Data Sharing</h2>
          <p>
            Your picks, standings, and profile information are visible to
            members of your leagues (picks are hidden until the weekly lock
            deadline). We do not sell or share your data with third parties for
            advertising or marketing purposes.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">4. Third-Party Services</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Google &amp; Discord OAuth</strong>: Used for
              authentication. Their respective privacy policies apply to the
              data they process.
            </li>
            <li>
              <strong>ESPN</strong>: NFL schedules, scores, and odds are sourced
              from ESPN&apos;s public API. No user data is sent to ESPN.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">5. Data Retention</h2>
          <p>
            Your account data is retained as long as your account is active.
            When you delete your account, your identity is anonymized (username,
            name, and email are replaced with anonymous placeholders).
            Historical picks and standings are preserved in anonymized form to
            maintain league integrity.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">6. Security</h2>
          <p>
            We use industry-standard measures to protect your data, including
            encrypted connections (HTTPS), secure session management, and
            database-level access controls. However, no system is perfectly
            secure — use the service at your own risk.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">7. Your Rights</h2>
          <p>
            You can view and edit your profile information at any time. You can
            delete your account at any time, which triggers the anonymization
            process described above. If you have questions about your data,
            contact us via the project&apos;s GitHub repository.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">8. Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. Continued use of
            PicksLeagues after changes constitutes acceptance.
          </p>
        </section>
      </div>
    </div>
  );
}
