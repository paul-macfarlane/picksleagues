import { z } from "@hono/zod-openapi";
import { GameStatusSchema } from "./game-status";
import { WeekTypeSchema } from "./week-type";

/**
 * A week's game slate — mode-agnostic: every mode that picks NFL games picks
 * against this same set of games.
 *
 * One rule shapes these types and is worth stating once here: **lock state is
 * derived, never stored** (arch D11). `locked` is serialized per game from
 * `effective kickoff <= clock.now()`; there is no column behind it and clients
 * must not cache it across a session.
 */

export const SlateTeamSchema = z
  .object({
    id: z.string(),
    abbreviation: z.string(),
    name: z.string(),
    location: z.string().nullable(),
    logoLightUrl: z.string().nullable(),
    logoDarkUrl: z.string().nullable(),
  })
  .openapi("SlateTeam");

export type SlateTeam = z.infer<typeof SlateTeamSchema>;

export const SlateGameSchema = z
  .object({
    id: z.string(),
    homeTeam: SlateTeamSchema,
    awayTeam: SlateTeamSchema,
    // Every field below is override-resolved (`override_* ?? provider_*`,
    // arch D15) — the client never sees the provider/override split.
    kickoffAt: z.iso.datetime(),
    status: GameStatusSchema,
    homeScore: z.number().int().nullable(),
    awayScore: z.number().int().nullable(),
    // Home-relative; negative = home favored. Null until the odds sync prices the
    // game, and in straight-up leagues it is simply unused.
    spread: z.number().nullable(),
    /**
     * Live in-game state (DATA-8): the 1-based period a game in progress is in
     * (5+ in overtime) and the whole seconds left in it. Both null unless the
     * game is in progress. Normalized, never a provider display string — the
     * client formats them ("Q3 12:34").
     *
     * `stateAsOf` is when that reading was last observed to be true, from the
     * game row's last change. Score sync polls every 5 minutes and writes only
     * when something moved, so a clock served without this stamp would read as
     * live when it can be minutes old — the UI must show the two together
     * (spec §UI conventions: never claim real-time freshness). Present for
     * every game, so a client can also date a score; on a game nothing has ever
     * happened to it is simply the row's ingestion time.
     */
    period: z.number().int().nullable(),
    clockSeconds: z.number().int().nullable(),
    stateAsOf: z.iso.datetime(),
    // Derived per request from the injected Clock — not stored (arch D11).
    locked: z.boolean(),
    /**
     * Whether a new pick may be placed here. False for cancelled and moved
     * games: they still appear on the slate (so a member can see why a pick
     * pushed) but settle as a push, so accepting a fresh pick would mint free
     * points. Such games are also excluded from `picksAllowed`.
     */
    pickable: z.boolean(),
  })
  .openapi("SlateGame");

export type SlateGame = z.infer<typeof SlateGameSchema>;

export const WeekSlateResponseSchema = z
  .object({
    weekId: z.string(),
    weekType: WeekTypeSchema,
    weekNumber: z.number().int(),
    label: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    games: z.array(SlateGameSchema),
  })
  .openapi("WeekSlateResponse");

export type WeekSlateResponse = z.infer<typeof WeekSlateResponseSchema>;
