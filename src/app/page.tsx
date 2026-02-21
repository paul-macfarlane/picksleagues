import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Shield,
  Target,
  Trophy,
  Users,
  Zap,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirectIfAuthenticated } from "@/lib/auth";

export default async function RootPage() {
  await redirectIfAuthenticated();

  return (
    <div className="bg-background relative min-h-screen overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
        style={{
          backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px),
            linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
        }}
      />

      <SplashNav />
      <HeroSection />
      <SectionDivider />
      <FeaturesSection />
      <SectionDivider />
      <CtaBand />
      <SplashFooter />
    </div>
  );
}

function SplashNav() {
  return (
    <nav className="relative z-10 flex items-center justify-between px-6 py-4 md:px-12">
      <div className="flex items-center gap-2">
        <div className="bg-primary flex h-8 w-8 items-center justify-center rounded-md">
          <Trophy className="text-primary-foreground h-4 w-4" />
        </div>
        <span className="text-lg font-bold tracking-tight">PicksLeagues</span>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button asChild size="sm">
          <Link href="/login">Sign In</Link>
        </Button>
      </div>
    </nav>
  );
}

function HeroSection() {
  return (
    <section className="relative z-10 mx-auto max-w-5xl px-6 pt-20 pb-16 md:px-12 md:pt-32 md:pb-24">
      <div className="flex flex-col items-start gap-6">
        <Badge variant="outline" className="gap-1.5 px-3 py-1">
          <Zap className="h-3 w-3" />
          Beta
        </Badge>

        <h1 className="max-w-3xl text-4xl leading-[1.1] font-extrabold tracking-tight md:text-6xl lg:text-7xl">
          Your league.
          <br />
          Your picks.
          <span className="text-muted-foreground"> Your bragging rights.</span>
        </h1>

        <p className="text-muted-foreground max-w-lg text-lg md:text-xl">
          Create private NFL Pick&apos;Em leagues, go head-to-head with friends
          each week, and climb the season-long leaderboard.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button asChild size="lg" className="gap-2 text-base">
            <Link href="/login">
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <p className="text-muted-foreground text-sm">
            Free to use &middot; No credit card
          </p>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section className="relative z-10 mx-auto max-w-5xl px-6 py-16 md:px-12 md:py-24">
      <p className="text-muted-foreground mb-10 text-sm font-medium tracking-widest uppercase">
        How it works
      </p>

      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <div className="bg-card flex h-10 w-10 items-center justify-center rounded-lg border">
            <Users className="h-5 w-5" />
          </div>
          <h3 className="font-semibold">Private Leagues</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Create invite-only leagues for up to 20 members. You control who
            plays.
          </p>
        </div>

        <div className="space-y-3">
          <div className="bg-card flex h-10 w-10 items-center justify-center rounded-lg border">
            <Target className="h-5 w-5" />
          </div>
          <h3 className="font-semibold">Pick Your Way</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Straight-up winners or against the spread. Choose the format that
            fits your league.
          </p>
        </div>

        <div className="space-y-3">
          <div className="bg-card flex h-10 w-10 items-center justify-center rounded-lg border">
            <Zap className="h-5 w-5" />
          </div>
          <h3 className="font-semibold">Live Scoring</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Picks are scored automatically as games finish. No manual tracking.
          </p>
        </div>

        <div className="space-y-3">
          <div className="bg-card flex h-10 w-10 items-center justify-center rounded-lg border">
            <BarChart3 className="h-5 w-5" />
          </div>
          <h3 className="font-semibold">Season Leaderboard</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Track wins, losses, and pushes across the full season. See who
            really knows football.
          </p>
        </div>
      </div>
    </section>
  );
}

function CtaBand() {
  return (
    <section className="relative z-10 mx-auto max-w-5xl px-6 py-16 md:px-12 md:py-24">
      <div className="flex flex-col items-center gap-4 text-center">
        <Shield className="text-muted-foreground h-8 w-8" />
        <h2 className="max-w-md text-2xl font-bold tracking-tight md:text-3xl">
          Ready to prove you know football?
        </h2>
        <Button asChild size="lg" className="mt-2 gap-2 text-base">
          <Link href="/login">
            Create Your League
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function SectionDivider() {
  return <div className="mx-6 border-t md:mx-12" />;
}

function SplashFooter() {
  return (
    <footer className="relative z-10 border-t px-6 py-8 md:px-12">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-muted-foreground text-sm">
          &copy; {new Date().getFullYear()} PicksLeagues. All rights reserved.
        </p>
        <div className="flex gap-6">
          <Link
            href="/terms"
            className="text-muted-foreground hover:text-foreground text-sm underline transition-colors"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="text-muted-foreground hover:text-foreground text-sm underline transition-colors"
          >
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
