import { useSyncExternalStore } from "react";

/**
 * The SPA's half of the injected `Clock` (arch D13).
 *
 * Everything time-derived in this product — locking, deadlines, settlement — is
 * computed against the server's clock, and under the simulator that clock sits
 * at a different instant than the browser's, sometimes by months. Any label the
 * SPA phrases relative to "now" has to ask the same clock, or it will cheerfully
 * report that a game the API has already locked kicks off tomorrow.
 *
 * Modelled as an external store rather than React state because that is what it
 * is: a mutable value learned from the network, read during render. The two
 * alternatives are both worse — a clock read inline in render is impure (two
 * components in one pass can straddle a boundary and disagree), and deriving it
 * through an effect means a `setState` in an effect for a value no render
 * caused.
 */

const MINUTE_MS = 60_000;

// What is kept is the **offset**, not the instant: the server reports its
// reading once per response, and holding the difference lets time keep moving
// between them instead of freezing at the last one. Zero until the session
// bootstraps, which makes the app clock the browser clock — correct wherever no
// simulator exists, and the only honest answer before the server has spoken.
let offsetMs = 0;
const listeners = new Set<() => void>();

/**
 * Records the server's clock from a response carrying it (`GET`/`PATCH /me`).
 *
 * Called from the query layer rather than a component because that is the one
 * moment the browser's clock is a valid reference for the server's instant —
 * the response has just landed, so the two readings describe the same moment to
 * within the render that follows.
 */
export function syncAppClock(serverNowIso: string): void {
  const next = Date.parse(serverNowIso) - Date.now();
  if (Number.isNaN(next) || next === offsetMs) return;
  offsetMs = next;
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Ticking is what keeps a page left open across midnight from insisting on
  // yesterday's answer.
  const interval = setInterval(onChange, MINUTE_MS);
  return () => {
    listeners.delete(onChange);
    clearInterval(interval);
  };
}

// Truncated to the minute so the snapshot is `===`-stable within one — the
// contract `useSyncExternalStore` requires, and the reason returning a raw
// timestamp here would re-render forever. Minute resolution is all the labels
// reading this carry anyway.
function currentMinute(): number {
  return Math.floor((Date.now() + offsetMs) / MINUTE_MS);
}

/** The application's current time — the clock every rendered label must use. */
export function useAppNow(): Date {
  // The server snapshot is the same reading: the prerender (ADR-0039) has no
  // session to learn an offset from, so its clock is the build machine's, and
  // without a server snapshot React refuses to render the store at all —
  // which surfaced as a public route prerendering to an empty error boundary.
  return new Date(useSyncExternalStore(subscribe, currentMinute, currentMinute) * MINUTE_MS);
}
