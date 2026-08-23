import {
  GAME_STATUS,
  GAME_SIDE,
  WEEK_TYPE,
  type GameSide,
  type GameStatus,
  type WeekType,
} from "@picksleagues/schemas";
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
  const lead = gameStateLead(game, now);
  return score ? `${lead} · ${score}` : lead;
}

/**
 * `gameStateLabel` without the score, for the matchup line's centre column
 * (ADR-0043 §5): there the score sits in the team cells' numeral slots, so the
 * centre carries only *when* or *where* the game is — the kickoff while it is
 * ahead, the period and clock while it runs, the status word otherwise. The
 * "Kickoff" prefix goes too: between two team cells the time is self-evidently
 * a kickoff, and the word would take the room the time needs at 390px.
 */
export function gameStateLead(game: GameStateInput, now: Date): string {
  if (game.status === GAME_STATUS.SCHEDULED) return formatKickoff(game.kickoffAt, now);
  return game.status === GAME_STATUS.IN_PROGRESS && game.period != null && game.clockSeconds != null
    ? `${periodLabel(game.period)} ${clockLabel(game.clockSeconds)}`
    : gameStatusLabel(game.status);
}

/**
 * What each team cell's numeral slot holds on a matchup line (ADR-0043 §5):
 * the line before kickoff and the score after it, in the same slot, so a row's
 * shape never changes across pre-pick → picked → locked → live → final.
 *
 * "Before kickoff" is the game's *status*, not the lock: a locked game the
 * score sync hasn't reached yet is still `scheduled`, and it keeps showing the
 * line rather than an empty slot — there is no score to show, and the line is
 * still the number the member's pick is bought at. Once the game has left
 * `scheduled` the line is no longer the point, so a postponed or cancelled game
 * with no score shows nothing.
 *
 * `spread` is whatever number the caller wants read as the line — the game's
 * current spread on the open sheet, `spread_at_pick` on a submitted pick, null
 * for a straight-up league or a surface with no line to show.
 */
export function matchupNumerals(
  game: { status: GameStatus; awayScore: number | null; homeScore: number | null },
  spread: number | null,
): { away: string | null; home: string | null } {
  if (game.status === GAME_STATUS.SCHEDULED) {
    return {
      away: spreadLabel(spread, GAME_SIDE.AWAY),
      home: spreadLabel(spread, GAME_SIDE.HOME),
    };
  }
  if (game.awayScore === null || game.homeScore === null) return { away: null, home: null };
  return { away: String(game.awayScore), home: String(game.homeScore) };
}

/**
 * The "as of" qualifier next to a live clock (DATA-8): scores sync every ~15
 * minutes (ADR-0044), so a game clock read from a stored snapshot can be well stale —
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
 * Home-relative spread, flipped for the away side (spec §ATS) — the sign a
 * member reads next to the side they'd be picking, not the raw stored number.
 * Read by `matchupNumerals`, so every matchup line — Pick'em rows, the Survivor
 * slate, the admin browser — shows the same sign for the same side; Survivor
 * grades straight-up (ADR-0026) but still shows the line.
 */
export function spreadLabel(spread: number | null, side: GameSide): string | null {
  if (spread === null) return null;
  const value = side === GAME_SIDE.HOME ? spread : -spread;
  // A pick'em line reads as a word, not a number: "+0"/"-0" (and the bare "0"
  // this used to print) invite a reader to look for a favorite that isn't
  // there. Sportsbooks write "PK" here, which is unusable inside a product
  // whose game mode is named Pick'em — "Even" says the same thing without the
  // collision. Both sides get the same word, since neither is giving points.
  if (value === 0) return "Even";
  return value > 0 ? `+${value}` : `${value}`;
}

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
