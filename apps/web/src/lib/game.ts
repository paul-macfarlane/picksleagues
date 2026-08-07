import {
  GAME_SIDE,
  GAME_STATUS,
  PICK_TYPE,
  WEEK_TYPE,
  type GameSide,
  type GameStatus,
  type PickemPickSide,
  type PickOutcome,
  type PickType,
  type WeekType,
} from "@picksleagues/schemas";
import { pickMargin } from "@picksleagues/scoring";
import { formatDateTime, formatKickoff } from "@/lib/format";

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

/**
 * Empty (not a placeholder dash) when unscored: this renders after the status
 * word, and "Scheduled –" reads as a truncated line rather than "no score yet".
 */
export function scoreText(away: number | null, home: number | null): string {
  return away === null || home === null ? "" : ` ${away}–${home}`;
}

/**
 * Period 1-4 are regulation quarters; 5+ is overtime (DATA-8's bound allows up
 * to 10, the longest NFL game on record having reached the 6th). The first
 * overtime reads bare ("OT"), matching how a broadcast reads it — only the
 * second and later gets a number, so this can't be a flat `period - 4`.
 */
export function periodLabel(period: number): string {
  if (period <= 4) return `Q${period}`;
  if (period === 5) return "OT";
  return `OT${period - 4}`;
}

/**
 * `m:ss`: no leading zero on minutes (a period never reaches double-digit
 * minutes in practice, and the admin override form's m:ss input round-trips
 * through this same function), always two digits on seconds.
 */
export function clockLabel(clockSeconds: number): string {
  const minutes = Math.floor(clockSeconds / 60);
  const seconds = clockSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type GameStateInput = {
  status: GameStatus;
  kickoffAt: string;
  awayScore: number | null;
  homeScore: number | null;
  awayTeam: { abbreviation: string };
  homeTeam: { abbreviation: string };
  period?: number | null;
  clockSeconds?: number | null;
};

/**
 * A score with each number attached to the team that owns it.
 *
 * A bare "19–21" is away-first by convention, which a member has to know *and*
 * combine with remembering which side they took before the number means
 * anything — the reported "it isn't clear who has what score". Naming both sides
 * is the whole fix, and it costs one line's width on the only surfaces that show
 * a pick beside a score. The raw form stays in `scoreText` for the admin tables,
 * where the teams already have their own columns.
 */
function labelledScore(game: GameStateInput): string | null {
  if (game.awayScore === null || game.homeScore === null) return null;
  return `${game.awayTeam.abbreviation} ${game.awayScore} – ${game.homeTeam.abbreviation} ${game.homeScore}`;
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
 * `now` is threaded in rather than read here because the scheduled branch
 * phrases the kickoff relative to it — see `formatKickoff`.
 *
 * `period`/`clockSeconds` (DATA-8) are independently nullable, and only ever
 * both present together (the provider populates them as a pair) — but this
 * degrades defensively rather than trusting that: either alone ("Q3" with no
 * time, or a bare clock with no period) is less legible than the plain status
 * line it would replace, so anything short of both present falls back to it.
 */
export function gameStateLabel(game: GameStateInput, now: Date): string {
  if (game.status === GAME_STATUS.SCHEDULED) return `Kickoff ${formatKickoff(game.kickoffAt, now)}`;
  const score = labelledScore(game);
  const lead =
    game.status === GAME_STATUS.IN_PROGRESS && game.period != null && game.clockSeconds != null
      ? `${periodLabel(game.period)} ${clockLabel(game.clockSeconds)}`
      : gameStatusLabel(game.status);
  return score ? `${lead} · ${score}` : lead;
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

/**
 * Where a pick stands, in the one phrasing its moment allows — the single home
 * for the rule that a *reading* and a *grade* are different claims.
 *
 * Both surfaces that show a pick beside a score (the entry grid's rows and the
 * week/pick detail) previously restated the status check, the null-score guard
 * and the `pickMargin` call inline, which is exactly how the two would come to
 * disagree about when a number may appear.
 *
 * Two moments say something, and they never overlap:
 *
 * - **In progress** → a provisional reading (see `provisionalMarginLabel`).
 * - **Graded** → the settled reading (see `settledMarginLabel`). Keyed on the
 *   grade's existence rather than on `FINAL`, so the window between a game
 *   ending and the settlement sweep landing shows nothing: a reading with no
 *   badge beside it to confirm it is worse than silence.
 *
 * Null when there is nothing honest to say: no scores yet, an ATS pick with no
 * spread to measure against, or a push — which has no margin to state whether it
 * landed exactly on the number or the game was cancelled out from under it.
 */
export function pickStandingLabel(
  game: { status: GameStatus; awayScore: number | null; homeScore: number | null },
  pick: { side: PickemPickSide; spreadAtPick: number | null; outcome: PickOutcome | null },
  pickType: PickType,
): string | null {
  if (game.awayScore === null || game.homeScore === null) return null;

  const graded = pick.outcome !== null;
  if (!graded && game.status !== GAME_STATUS.IN_PROGRESS) return null;

  const margin = pickMargin(pick, game.homeScore, game.awayScore, pickType);
  if (margin === null) return null;

  if (graded) return settledMarginLabel(margin, pickType);
  return provisionalMarginLabel(margin, pickType);
}

/**
 * How a graded pick's margin reads: the past tense of the reading the row
 * carried while its game was still running.
 *
 * This began as the bare magnitude ("by 10"), on the theory that the outcome
 * badge beside it owns the verdict and repeating it would only crowd the badge.
 * Wrong in practice: a lone number doesn't say what it measures, and what it
 * measures genuinely differs by pick type — 7.5 against the spread is points
 * relative to a number the member accepted, while 10 straight-up is points on
 * the scoreboard. Naming it costs one word and removes the guess.
 *
 * Tense is what keeps it from becoming a second verdict beside the badge:
 * "covering by 7.5" becomes "covered by 7.5", so a member watching a game
 * settle sees one sentence resolve rather than a new vocabulary appear.
 *
 * It describes this one pick and nothing else. Nothing aggregates it — ADR-0018
 * decision 4 removed the standings differential it used to feed — and it
 * survives on its own merits, as that ADR says.
 *
 * Null on a push, which is not an oversight: the ambiguity above is a property
 * of *numbers* without units, and a push has no number to qualify — so "pushed"
 * next to a badge already reading "Push" would be the one case where the words
 * really are pure duplication.
 */
export function settledMarginLabel(margin: number, pickType: PickType): string | null {
  if (margin === 0) return null;
  const magnitude = Math.abs(margin);
  if (pickType === PICK_TYPE.AGAINST_THE_SPREAD) {
    return margin > 0 ? `covered by ${magnitude}` : `short by ${magnitude}`;
  }
  return margin > 0 ? `won by ${magnitude}` : `lost by ${magnitude}`;
}

/**
 * Where an unfinished pick currently stands, phrased as a *reading* rather than
 * a verdict (spec §Data Freshness).
 *
 * Three deliberate constraints, because this sits one sync behind reality and
 * beside a settled grade that is final:
 *
 * 1. **A number, never a verdict word.** "Covering by 7.5" is self-evidently a
 *    snapshot; "Winning" reads as a fact, and a fact five minutes stale is
 *    simply wrong. The number also does the work a member can't do in their
 *    head: applying a home-relative spread to an away-first score.
 * 2. **No colour and no glyph** at the call sites — `PICK_OUTCOME`'s green
 *    check and red cross mean "this graded", and a provisional badge borrowing
 *    them would erase that distinction in exactly the moment it matters.
 * 3. **Attached to the pick, not the game**, and rendered only while the game is
 *    in progress: before kickoff there is nothing to read, and afterwards the
 *    real grade has arrived and this must get out of its way.
 *
 * The margin itself comes from `packages/scoring`'s `pickMargin` — the same
 * arithmetic settlement grades on, so this can never contradict the outcome that
 * follows it.
 */
export function provisionalMarginLabel(margin: number, pickType: PickType): string {
  const magnitude = Math.abs(margin);
  if (pickType === PICK_TYPE.AGAINST_THE_SPREAD) {
    if (margin > 0) return `covering by ${magnitude}`;
    if (margin < 0) return `short by ${magnitude}`;
    // The app's own word for landing exactly on the number, matching what the
    // grade will say if it holds (`PICK_OUTCOME.PUSH` → "Push").
    return "pushing";
  }
  if (margin > 0) return `up ${magnitude}`;
  if (margin < 0) return `down ${magnitude}`;
  return "tied";
}

/**
 * Home-relative spread, flipped for the away side (spec §ATS) — the sign a
 * member reads next to the team they'd be picking, not the raw stored number.
 * Shared by the pick entry grid and the week/pick detail view so the two
 * surfaces never drift on how a spread reads.
 */
export function spreadLabel(spread: number | null, side: GameSide): string | null {
  if (spread === null) return null;
  const value = side === GAME_SIDE.HOME ? spread : -spread;
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * A pick row's visual state (PKM UX feedback: "make submitted state obvious
 * inline"). One function drives the row's border/badge styling so the new
 * "picked" highlight and the pre-existing locked/unplayable badges — which
 * must stay visually distinct from it — can never drift out of sync with
 * each other. `locked`/`unplayable` take priority over `hasSelection`: a
 * submitted pick on a locked or pushed game is still rendered via its own
 * "Your pick" copy, not the freshly-picked highlight.
 */
export type PickRowState = "unplayable" | "locked" | "picked" | "open";

/**
 * Whether a game can still take a pick: kicked off, or no longer playable.
 *
 * One definition, because the unsubmitted sheet asks it in more than one place
 * that must agree — which rows render read-only, and how large the required set
 * is. Restating it per site is what let them drift before: a game that locked
 * while the screen was open stayed in the selection map, so the sheet counted a
 * pick it could no longer make and queued a submission the write path's lock
 * guard had to 409. Under submit-once (ADR-0018) that refusal costs the whole
 * week rather than one pick, which is why this stays a single function.
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
