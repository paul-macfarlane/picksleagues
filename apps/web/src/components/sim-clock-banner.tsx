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
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5 text-xs sm:px-6">
        <span className="font-medium text-foreground">Simulated time</span>
        <span>{formatDateTime(clock.now)}</span>
        <span aria-hidden="true">·</span>
        <span>{activeScenario ? activeScenario.name : "No scenario loaded"}</span>
        <Link
          to="/sim"
          className="ml-auto underline outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Simulator
        </Link>
      </div>
    </div>
  );
}
