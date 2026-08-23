import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { Band } from "@/components/band";
import { BrandMark } from "@/components/brand";
import { LegalFooter } from "@/components/legal-footer";
import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/welcome")({
  // A signed-in member has a dashboard; the front door is for visitors.
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session) {
      throw redirect({ to: "/" });
    }
  },
  component: Welcome,
});

const MODES = [
  {
    name: "NFL Pick'em",
    description:
      "Pick winners every week — straight up or against the spread. Most correct picks tops the standings.",
    status: null,
  },
  {
    name: "NFL Survivor",
    description:
      "One team a week, never the same team twice. Back a loser and you're out — last member standing wins.",
    status: null,
  },
  {
    name: "March Madness Pool",
    description: "Fill out a bracket and score points as it survives the tournament.",
    status: "Coming for the 2027 tournament",
  },
] as const;

const STEPS = [
  {
    title: "Start a league",
    description: "Create one and invite your friends with a link, or join a public league.",
  },
  {
    title: "Make your picks",
    description:
      "Every pick locks at its game's kickoff — after that, everyone's picks are revealed.",
  },
  {
    title: "Settle it on the scoreboard",
    description: "Results and standings update as games go final, all season long.",
  },
] as const;

function Welcome() {
  return (
    <div className="flex min-h-svh flex-col">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-6 sm:px-6 sm:py-10">
        {/* The one band with no league in it (ADR-0043 §2): a visitor has no
            league to be the subject, so the product is. */}
        <Band className="items-center gap-5 py-10 text-center sm:py-14">
          <BrandMark className="size-20" />
          <div className="flex flex-col gap-3">
            <h1 className="text-5xl sm:text-6xl">Picks Leagues</h1>
            <p className="mx-auto max-w-md text-lg text-muted-foreground">
              Season-long sports leagues with friends. Create one, invite your crew, and settle
              bragging rights on the scoreboard.
            </p>
          </div>
          <Link to="/sign-in" className={cn(buttonVariants({ size: "lg" }), "px-8")}>
            Sign in to play
          </Link>
          <p className="type-eyebrow">Free to play · Sign in with Google or Discord</p>
        </Band>

        <Section eyebrow="Game modes" title="Three ways to play">
          <div className="grid gap-4 sm:grid-cols-3">
            {MODES.map((mode) => (
              <Card key={mode.name}>
                <CardHeader>
                  <CardTitle>{mode.name}</CardTitle>
                  {mode.status && (
                    <div>
                      <StatusPill>{mode.status}</StatusPill>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {mode.description}
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>

        <Section eyebrow="The season" title="How it works">
          <ol className="flex flex-col gap-5">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="type-display w-10 shrink-0 text-3xl leading-none text-foreground"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="flex flex-col gap-0.5 pt-0.5">
                  <h3 className="text-base leading-snug">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      </main>
      <LegalFooter className="mx-auto w-full max-w-3xl px-4 sm:px-6" />
    </div>
  );
}
