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

/**
 * The one-line summary of where a game actually is, shared by the pick entry
 * grid and the week/pick detail so the two can't drift.
 *
 * A kickoff time only answers the member's question *before* the game starts;
 * once it has, they want the status and the score — including while it is in
 * progress, and including a score an admin has corrected by hand (ADM-2), which
 * arrives here already override-resolved.
 */
export function gameStateLabel(game: {
  status: GameStatus;
  kickoffAt: string;
  awayScore: number | null;
  homeScore: number | null;
}): string {
  if (game.status === GAME_STATUS.SCHEDULED) return `Kickoff ${formatDateTime(game.kickoffAt)}`;
  return `${gameStatusLabel(game.status)}${scoreText(game.awayScore, game.homeScore)}`;
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

export function pickRowState(
  game: { pickable: boolean; locked: boolean },
  hasSelection: boolean,
): PickRowState {
  if (!game.pickable) return "unplayable";
  if (game.locked) return "locked";
  if (hasSelection) return "picked";
  return "open";
}
