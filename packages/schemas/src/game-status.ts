import { z } from "@hono/zod-openapi";

/**
 * Domain game status (arch §Domain Model). Provider ingestion writes all five.
 * A real provider week move is handled by a hand SQL edit to `cancelled`
 * (ADR-0019, amended by ADR-0046), which is the rule members already
 * understand, rather than by a sixth status only settlement knew how to read.
 */
export const GAME_STATUS = {
  SCHEDULED: "scheduled",
  IN_PROGRESS: "in_progress",
  FINAL: "final",
  POSTPONED: "postponed",
  CANCELLED: "cancelled",
} as const;

export type GameStatus = (typeof GAME_STATUS)[keyof typeof GAME_STATUS];

export const GameStatusSchema = z.enum(GAME_STATUS).openapi("GameStatus");

/**
 * Statuses meaning the game will never be played in this week — the spec's
 * cancellation rule (spec §Cancellations & Postponements).
 *
 * Still a set rather than a bare comparison, because two rules key off it and
 * they must agree: such a game is not *pickable* (offering it would mint free
 * push points), and an existing pick on one *resolves as a push*. `postponed`
 * is deliberately absent — a postponement inside the week is played later and
 * resolves normally.
 */
const UNPLAYED_GAME_STATUSES: readonly GameStatus[] = [GAME_STATUS.CANCELLED];

export function isUnplayedStatus(status: GameStatus): boolean {
  return UNPLAYED_GAME_STATUSES.includes(status);
}

/**
 * Statuses meaning the game has already been played, in whole or in part —
 * a different question from `isUnplayedStatus` (which is "will never be played
 * in this week"), and not its inverse: `scheduled` and `postponed` are neither,
 * because such a game is still ahead of us and picks on it are legitimate.
 *
 * A game in one of these must never be left unlocked (arch D11), or every
 * member could pick against an outcome the same page is already showing them.
 * The anomaly detector pairs this with a score check rather than folding "has
 * a score" in here — `postponed` carrying a score is knowable without ever
 * having started, and this constant means what it says.
 *
 * Exported as the list *as well as* behind `isStartedStatus`, unlike
 * `UNPLAYED_GAME_STATUSES`: the admin anomaly query expresses the predicate in
 * SQL over every game in the database, and a SQL `inArray` cannot push a
 * predicate down.
 */
export const STARTED_GAME_STATUSES: readonly GameStatus[] = [
  GAME_STATUS.IN_PROGRESS,
  GAME_STATUS.FINAL,
];

export function isStartedStatus(status: GameStatus): boolean {
  return STARTED_GAME_STATUSES.includes(status);
}

/**
 * Statuses meaning the game is still ahead of us — neither started nor
 * abandoned — so a pick on it is legitimate and it still needs a current
 * spread. Exactly the complement of `isStartedStatus` ∪ `isUnplayedStatus`,
 * which is why it is declared as one rather than as a third hand-listed set:
 * every status belongs to exactly one of the three, and a new member of
 * `GAME_STATUS` lands here by default, where it is visible, rather than
 * silently dropping out of the odds sync.
 *
 * `postponed` being here is the whole point. It is announced ahead of time and
 * played later, so members may pick it — but the odds sync used to key on
 * `scheduled` alone, so a postponed game got no snapshot, and with no number to
 * accept an ATS league refused every pick on it forever.
 *
 * Exported as the list rather than behind an `isUnstartedStatus` predicate like
 * its two siblings: the caller is a SQL `inArray`, and a predicate no query can
 * push down would only be a second way to ask the same question.
 */
export const UNSTARTED_GAME_STATUSES: readonly GameStatus[] = Object.values(GAME_STATUS).filter(
  (status) => !isStartedStatus(status) && !isUnplayedStatus(status),
);
