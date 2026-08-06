import { GAME_STATUS, type GameStatus } from "@picksleagues/schemas";
import { StatusPill } from "@/components/status-pill";

/**
 * The "being played right now" marker, shared by the pick editor and the
 * week/pick detail. A slate mid-Sunday is a mix of finished, running, and
 * not-yet-started games, and the running ones are the only rows whose state is
 * still moving — the reason they're worth separating from the rest at a glance.
 *
 * Deliberately unanimated, and deliberately not the word "Live": scores arrive
 * on a sync job every few minutes, so this is a stored reading rather than a
 * feed, and the UI never claims real-time freshness (spec §UI conventions — the
 * same rule that makes `gameStateAsOfLabel` read "as of …"). Contrast and the
 * dot do the standing out, neither of which costs any honesty.
 *
 * Renders nothing for every other status: `gameStateLabel` already says
 * "Scheduled"/"Final" in full on the line beneath, and a pill repeating that
 * would bury the one state worth spotting back in the noise.
 */
export function GameStatePill({ status }: { status: GameStatus }) {
  if (status !== GAME_STATUS.IN_PROGRESS) return null;
  return (
    // `data-status` carries the status itself, so a test can assert which state
    // a row is in without binding to the words in it.
    <StatusPill tone="strong" data-testid="game-status" data-status={status}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      In progress
    </StatusPill>
  );
}
