import type { Metadata } from "next";

import { getSession } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeleteAccountDialog } from "@/components/account/delete-account-dialog";

export const metadata: Metadata = {
  title: "Account",
};

export default async function AccountPage() {
  const session = await getSession();

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
        <CardContent>
          <DeleteAccountDialog />
        </CardContent>
      </Card>
    </div>
  );
}
