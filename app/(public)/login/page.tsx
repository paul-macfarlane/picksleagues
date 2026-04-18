import type { Metadata } from "next";

import { LogoMark } from "@/components/brand/logo-mark";
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

function safeCallback(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Only allow same-origin paths: must start with "/" followed by a char
  // that isn't "/" or "\", otherwise browsers may treat "//evil" or "/\evil"
  // as a protocol-relative redirect.
  if (value && /^\/[^/\\]/.test(value)) {
    return value;
  }
  return "/leagues";
}

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const callbackURL = safeCallback(searchParams.redirect);

  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <LogoMark className="mb-2 h-12 w-12" title="PicksLeagues logo" />
          <CardTitle className="text-2xl">Sign in to PicksLeagues</CardTitle>
          <CardDescription>
            NFL Pick&apos;Em leagues with friends.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginButtons callbackURL={callbackURL} />
        </CardContent>
      </Card>
    </div>
  );
}
