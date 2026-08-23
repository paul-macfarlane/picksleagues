import { Link } from "@tanstack/react-router";
import { useMe } from "@/api/me";
import { useSimState } from "@/api/sim";
import { useAppNow } from "@/lib/app-clock";
import { formatDateTime } from "@/lib/format";

/**
 * The simulator's persistent indicator (SIM-7). Simulated time is app-wide
 * state — every kickoff, lock, and deadline the SPA renders is derived against
 * it (arch D13) — so "now isn't real" belongs in the shell, not only on the
 * admin page an operator has navigated away from.
 *
 * Two audiences, two sources, and the split is the point (FB-38):
 *
 * - **Operators** get the full row from `GET /api/sim/state`, including the
 *   loaded scenario and a way into the simulator. That route is admin-only and
 *   unregistered when the simulator is off (ADR-0011/ADR-0014), which is why
 *   non-admins can't simply be shown the same thing.
 * - **Everyone else** gets the clock alone, from `/me`'s `simClockOffsetMs` —
 *   a member testing on staging is reading lock states derived against an
 *   instant nothing on screen states, and the scenario name is not their
 *   business.
 *
 * Silent unless the simulator is actually shifting something: a sim-enabled
 * environment sitting at a zero offset with no scenario loaded behaves exactly
 * like a real one, and a permanent banner there would train people to ignore it.
 */
export function SimClockBanner() {
  const me = useMe();
  const isOperator = Boolean(me.data?.isAdmin && me.data?.simEnabled);
  // Non-admins and sim-less environments never issue the request at all — the
  // route isn't registered there (ADR-0014), so an unconditional query would be
  // a guaranteed 404 on every page load.
  const state = useSimState(isOperator);

  if (isOperator) {
    if (!state.data) return null;
    const { clock, activeScenario } = state.data;
    if (clock.offsetMs === 0 && !activeScenario) return null;
    return (
      <SimClockBar now={clock.now} operator>
        {/* Its own eyebrow rather than a "·"-joined clause: below `sm` the
            scenario takes its own line, and a label reads there where a
            dangling separator would not. */}
        <span className="type-eyebrow w-full sm:w-auto">
          {activeScenario ? activeScenario.name : "No scenario loaded"}
        </span>
      </SimClockBar>
    );
  }

  return <MemberSimClockBanner />;
}

/**
 * The member-facing half. Split out rather than branching inline because it
 * reads the app clock through a hook, and a hook called under the operator
 * branch's early returns would break the rules of hooks.
 */
function MemberSimClockBanner() {
  const me = useMe();
  // The app clock, which is the server's (arch D13) — not `me.now`, which is
  // the instant one response landed at and would sit still on a page left open.
  const now = useAppNow();

  if (!me.data?.simEnabled || me.data.simClockOffsetMs === 0) return null;

  return <SimClockBar now={now.toISOString()} />;
}

/**
 * The shared strip, so the two audiences can't drift on placement or styling.
 * A ticker in the scoreboard voice (ADR-0043): an eyebrow naming the reading,
 * the instant as a display numeral at the 20px floor, on the warm `accent`
 * tint — not ink, which is the league band's and would put a second dark
 * surface on every screen, and not orange, which means "yours to act on" and
 * this is a warning, not an action.
 */
function SimClockBar({
  now,
  operator = false,
  children,
}: {
  now: string;
  // Gates the link into the simulator rather than inferring it from `children`:
  // an operator-only affordance must turn on something named, not on whether a
  // caller happened to pass extra content.
  operator?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-t border-border bg-accent text-accent-foreground">
      {/* The link is a sibling of the wrapping text rather than a member of it:
          as one flex-wrap row, `ml-auto` pushed it onto a line of its own at
          phone width, right-aligned under nothing and reading as a stray third
          row. Now the text block wraps inside its own column and the link stays
          put beside it, vertically centred. */}
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-1 sm:px-6">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="type-eyebrow">Simulated time</span>
          <span className="type-display text-xl">{formatDateTime(now)}</span>
          {children}
        </div>
        {operator && (
          <Link
            to="/sim"
            className="type-eyebrow shrink-0 text-accent-foreground underline outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Simulator
          </Link>
        )}
      </div>
    </div>
  );
}
