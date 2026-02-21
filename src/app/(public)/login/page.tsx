import Link from "next/link";

import { LoginButtons } from "./login-buttons";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="mx-auto w-full max-w-sm space-y-6 p-4">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">PicksLeagues</h1>
          <p className="text-muted-foreground">
            Sign in to create or join a league
          </p>
        </div>
        <LoginButtons />
        <p className="text-muted-foreground text-center text-xs">
          By signing in, you agree to our{" "}
          <Link href="/terms" className="hover:text-foreground underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="hover:text-foreground underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
