import type { Metadata } from "next";

import { DeleteAccountDialog } from "@/components/account/delete-account-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getLeagueMembershipSummaryForUser } from "@/data/members";
import { getSoleCommissionerBlockers } from "@/lib/account";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Account",
};

export default async function AccountPage() {
  const session = await getSession();
  const summary = await getLeagueMembershipSummaryForUser(session.user.id);
  const blockers = getSoleCommissionerBlockers(summary);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as{" "}
          <span className="font-medium text-foreground">
            {session.user.email}
          </span>
          .
        </p>
      </header>

      <Card className="border-destructive/30 ring-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Deleting your account scrubs your identity but preserves your
            historical picks and standings in every league.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {blockers.length > 0 ? (
            <div className="rounded-md border border-dashed bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                You&apos;re the only commissioner of{" "}
                {blockers.map((b) => b.leagueName).join(", ")}.
              </p>
              <p className="text-muted-foreground">
                Promote another member before deleting your account so the
                league isn&apos;t left without an owner.
              </p>
            </div>
          ) : null}
          <DeleteAccountDialog blocked={blockers.length > 0} />
        </CardContent>
      </Card>
    </div>
  );
}
