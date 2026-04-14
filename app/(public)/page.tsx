import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, Lock, Trophy } from "lucide-react";

import { LogoMark } from "@/components/brand/logo-mark";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";

export const metadata: Metadata = {
  title: "PicksLeagues — NFL Pick'Em with your friends",
  description:
    "Create or join a private league, make weekly picks, climb the season-long leaderboard.",
};

export default async function LandingPage() {
  let session;
  try {
    session = await getSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return <SplashContent />;
    }
    throw error;
  }

  const profile = await getProfileByUserId(session.user.id);
  if (!profile || !profile.setupComplete) {
    redirect("/setup");
  }
  redirect("/home");
}

function SplashContent() {
  return (
    <div className="flex flex-1 flex-col gap-16 py-8 sm:py-12 lg:gap-24 lg:py-16">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 text-center">
        <LogoMark className="h-16 w-16" title="PicksLeagues logo" />
        <h1 className="font-heading text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          NFL Pick&apos;Em with your friends.
        </h1>
        <p className="max-w-xl text-base text-muted-foreground text-balance sm:text-lg">
          Create or join a private league, make weekly picks, climb the
          season-long leaderboard.
        </p>
        <Button asChild size="lg" className="mt-2">
          <Link href="/login">Get started</Link>
        </Button>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="gap-2">
            <Lock className="h-6 w-6 text-primary" />
            <CardTitle>Private leagues</CardTitle>
            <CardDescription>
              Invite-only pools of 2 to 20 members. No strangers, no ads.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            <CardTitle>Weekly picks</CardTitle>
            <CardDescription>
              Pick straight up or against the spread. Edit any time before
              kickoff.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="gap-2">
            <Trophy className="h-6 w-6 text-primary" />
            <CardTitle>Season-long leaderboard</CardTitle>
            <CardDescription>
              Track wins, losses, and pushes with dense rankings all season.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          Sign in with Google or Discord — no passwords.
        </p>
        <Button asChild variant="outline">
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    </div>
  );
}
