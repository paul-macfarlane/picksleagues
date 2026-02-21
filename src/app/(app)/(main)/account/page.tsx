import Link from "next/link";

import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";
import { DeleteAccountSection } from "./delete-account-section";

export default async function AccountPage() {
  const session = await getSession();
  const profile = await getProfileByUserId(session.user.id);

  return (
    <div className="mx-auto max-w-md space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="text-muted-foreground">
          Signed in as {profile?.username ?? session.user.email}
        </p>
      </div>

      <DeleteAccountSection />

      <div className="border-t pt-6">
        <div className="flex gap-4">
          <Link
            href="/terms"
            className="text-muted-foreground hover:text-foreground text-sm underline transition-colors"
          >
            Terms of Service
          </Link>
          <Link
            href="/privacy"
            className="text-muted-foreground hover:text-foreground text-sm underline transition-colors"
          >
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
