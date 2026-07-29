import { GAME_STATUS, WEEK_TYPE, type GameStatus, type WeekType } from "@picksleagues/schemas";
import { formatDateTime } from "@/lib/format";

// One home for the sports-data display labels (engineering rule on derived
// display values), alongside lib/league.ts's mode/role maps. The admin
// browsers are the first consumer; the pick and standings surfaces render the
// same statuses.
const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  [GAME_STATUS.SCHEDULED]: "Scheduled",
  [GAME_STATUS.IN_PROGRESS]: "In progress",
  [GAME_STATUS.FINAL]: "Final",
  [GAME_STATUS.POSTPONED]: "Postponed",
  [GAME_STATUS.CANCELLED]: "Cancelled",
  [GAME_STATUS.MOVED]: "Moved",
};

export function gameStatusLabel(status: GameStatus): string {
  return GAME_STATUS_LABELS[status];
}

const WEEK_TYPE_LABELS: Record<WeekType, string> = {
  [WEEK_TYPE.REGULAR]: "Regular season",
  [WEEK_TYPE.POSTSEASON]: "Postseason",
};

export function weekTypeLabel(weekType: WeekType): string {
  return WEEK_TYPE_LABELS[weekType];
}

// Empty (not a placeholder dash) when unscored: this renders after the status
// word, and "Scheduled –" reads as a truncated line rather than "no score yet".
export function scoreText(away: number | null, home: number | null): string {
  return away === null || home === null ? "" : ` ${away}–${home}`;
}

// Period 1-4 are regulation quarters; 5+ is overtime (DATA-8's bound allows up
// to 10, the longest NFL game on record having reached the 6th). The first
// overtime reads bare ("OT"), matching how a broadcast reads it — only the
// second and later gets a number, so this can't be a flat `period - 4`.
export function periodLabel(period: number): string {
  if (period <= 4) return `Q${period}`;
  if (period === 5) return "OT";
  return `OT${period - 4}`;
}

// `m:ss`: no leading zero on minutes (a period never reaches double-digit
// minutes in practice, and the admin override form's m:ss input round-trips
// through this same function), always two digits on seconds.
export function clockLabel(clockSeconds: number): string {
  const minutes = Math.floor(clockSeconds / 60);
  const seconds = clockSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The one-line summary of where a game actually is, shared by the pick entry
 * grid and the week/pick detail so the two can't drift.
 *
 * A kickoff time only answers the member's question *before* the game starts;
 * once it has, they want the status and the score — including while it is in
 * progress, and including a score an admin has corrected by hand (ADM-2), which
 * arrives here already override-resolved.
 *
 * `period`/`clockSeconds` (DATA-8) are independently nullable, and only ever
 * both present together (the provider populates them as a pair) — but this
 * degrades defensively rather than trusting that: either alone ("Q3" with no
 * time, or a bare clock with no period) is less legible than the plain status
 * line it would replace, so anything short of both present falls back to it.
 */
export function gameStateLabel(game: {
  status: GameStatus;
  kickoffAt: string;
  awayScore: number | null;
  homeScore: number | null;
  period?: number | null;
  clockSeconds?: number | null;
}): string {
  if (game.status === GAME_STATUS.SCHEDULED) return `Kickoff ${formatDateTime(game.kickoffAt)}`;
  if (game.status === GAME_STATUS.IN_PROGRESS && game.period != null && game.clockSeconds != null) {
    const score = scoreText(game.awayScore, game.homeScore).trim();
    return `${periodLabel(game.period)} ${clockLabel(game.clockSeconds)}${score ? ` · ${score}` : ""}`;
  }
  return `${gameStatusLabel(game.status)}${scoreText(game.awayScore, game.homeScore)}`;
}

/**
 * The "as of" qualifier next to a live clock (DATA-8): scores sync every ~5
 * minutes, so a game clock read from a stored snapshot can be minutes stale —
 * unlike a final score, which is settled, or a kickoff time, which hasn't
 * happened yet, so it's shown only while the game is in progress (spec §UI
 * conventions: never claim real-time freshness). Phrased as a qualifier
 * ("as of …"), never "Live", so it can't be misread as a live feed.
 */
export function gameStateAsOfLabel(game: { status: GameStatus; stateAsOf: string }): string | null {
  if (game.status !== GAME_STATUS.IN_PROGRESS) return null;
  return `as of ${formatDateTime(game.stateAsOf)}`;
}

// Home-relative spread, flipped for the away side (spec §ATS) — the sign a
// member reads next to the team they'd be picking, not the raw stored number.
// Shared by the pick entry grid, the substitute-pick dialog, and the week/pick
// detail view so the three surfaces never drift on how a spread reads.
export function spreadLabel(spread: number | null, side: "home" | "away"): string | null {
  if (spread === null) return null;
  const value = side === "home" ? spread : -spread;
  return value > 0 ? `+${value}` : `${value}`;
}

// A pick row's visual state (PKM UX feedback: "make submitted state obvious
// inline"). One function drives the row's border/badge styling so the new
// "picked" highlight and the pre-existing locked/unplayable badges — which
// must stay visually distinct from it — can never drift out of sync with
// each other. `locked`/`unplayable` take priority over `hasSelection`: a
// retained pick on a locked or pushed game is still rendered via its own
// "Your pick" copy, not the freshly-picked highlight.
export type PickRowState = "unplayable" | "locked" | "picked" | "open";

/**
 * ADR-0015's retention boundary in one place: once a game has kicked off or
 * stopped being playable, any pick on it is retained server-side and the pick
 * editor can no longer change it.
 *
 * The pick screen asks this three ways that must agree — which rows render
 * read-only, which selections still belong in the editable map, and whether the
 * save bar has anything left to do. Restating it at each site is what let them
 * drift: the selection map was filtered by this rule only at mount, so a game
 * that locked while the screen was open stayed in it *and* joined the retained
 * map, counting one pick twice ("8 of 5 picks") and queueing a submission the
 * write path's lock guard must 409.
 */
export function isClosedToPicks(game: { locked: boolean; pickable: boolean }): boolean {
  return game.locked || !game.pickable;
}

export function pickRowState(
  game: { pickable: boolean; locked: boolean },
  hasSelection: boolean,
): PickRowState {
  if (!game.pickable) return "unplayable";
  if (game.locked) return "locked";
  if (hasSelection) return "picked";
  return "open";
}
