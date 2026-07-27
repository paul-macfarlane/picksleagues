import { GAME_STATUS, WEEK_TYPE, type GameStatus, type WeekType } from "@picksleagues/schemas";

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
