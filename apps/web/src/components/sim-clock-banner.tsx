import { Link } from "@tanstack/react-router";
import { useMe } from "@/api/me";
import { useSimState } from "@/api/sim";
import { formatDateTime } from "@/lib/format";

/**
 * The simulator's persistent indicator (SIM-7). Simulated time is app-wide
 * state — every kickoff, lock, and deadline the SPA renders is derived against
 * it (arch D13) — so "now isn't real" belongs in the shell, not only on the
 * admin page an operator has navigated away from.
 *
 * Silent unless the simulator is actually shifting something: a sim-enabled
 * environment sitting at a zero offset with no scenario loaded behaves exactly
 * like a real one, and a permanent banner there would train operators to
 * ignore it.
 */
export function SimClockBanner() {
  const me = useMe();
  // Non-admins and sim-less environments never issue the request at all — the
  // route isn't registered there (ADR-0014), so an unconditional query would be
  // a guaranteed 404 on every page load.
  const enabled = Boolean(me.data?.isAdmin && me.data?.simEnabled);
  const state = useSimState(enabled);

  if (!enabled || !state.data) return null;

  const { clock, activeScenario } = state.data;
  if (clock.offsetMs === 0 && !activeScenario) return null;

  return (
    <div className="border-t border-border bg-muted text-muted-foreground">
      {/* The link is a sibling of the wrapping text rather than a member of it:
          as one flex-wrap row, `ml-auto` pushed it onto a line of its own at
          phone width, right-aligned under nothing and reading as a stray third
          row. Now the text block wraps inside its own column and the link stays
          put beside it, vertically centred. */}
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-1.5 text-xs sm:px-6">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
          <span className="font-medium text-foreground">Simulated time</span>
          <span>{formatDateTime(clock.now)}</span>
          {/* The separator only earns its place while both parts share a line;
              below `sm` the scenario takes its own, where a leading "·" would
              dangle off the end of the one above it. */}
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <span className="w-full sm:w-auto">
            {activeScenario ? activeScenario.name : "No scenario loaded"}
          </span>
        </div>
        <Link
          to="/sim"
          className="shrink-0 underline outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Simulator
        </Link>
      </div>
    </div>
  );
}
