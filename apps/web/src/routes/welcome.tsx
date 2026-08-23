import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { BrandMark } from "@/components/brand";
import { LegalFooter } from "@/components/legal-footer";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 py-12 sm:px-6 sm:py-16">
        <section className="flex flex-col items-center gap-5 text-center">
          <BrandMark className="size-20" />
          <h1 className="text-4xl text-foreground sm:text-5xl">Picks Leagues</h1>
          <p className="max-w-md text-lg text-muted-foreground">
            Season-long sports leagues with friends. Create one, invite your crew, and settle
            bragging rights on the scoreboard.
          </p>
          <Link to="/sign-in" className={cn(buttonVariants({ size: "lg" }), "px-8")}>
            Sign in to play
          </Link>
          <p className="text-xs text-muted-foreground">
            Free to play. Sign in with Google or Discord.
          </p>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="modes-heading">
          <h2 id="modes-heading" className="text-xl font-semibold text-foreground">
            Three ways to play
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {MODES.map((mode) => (
              <Card key={mode.name}>
                <CardHeader>
                  <CardTitle>{mode.name}</CardTitle>
                  {mode.status && (
                    <CardDescription className="text-xs font-medium uppercase tracking-wide">
                      {mode.status}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {mode.description}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="how-heading">
          <h2 id="how-heading" className="text-xl font-semibold text-foreground">
            How it works
          </h2>
          <ol className="flex flex-col gap-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink type-display text-sm text-ink-foreground"
                >
                  {index + 1}
                </span>
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <LegalFooter className="mx-auto w-full max-w-3xl px-4 sm:px-6" />
    </div>
  );
}
