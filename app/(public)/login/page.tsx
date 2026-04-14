import type { Metadata } from "next";

import { LoginButtons } from "@/components/auth/login-buttons";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Sign in to PicksLeagues</CardTitle>
          <CardDescription>
            NFL Pick&apos;Em leagues with friends.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginButtons />
        </CardContent>
      </Card>
    </div>
  );
}
