/**
 * The public routes prerendered at build (LNCH-13) and the head tags each
 * document carries. Also the source for `/sitemap.xml`, so a page added here
 * becomes crawlable and listed in one edit.
 *
 * `/` is deliberately absent (owner, 2026-08-11): `/welcome` is the URL
 * registered with Google, and serving marketing markup at `/` would flash it
 * at signed-in members before React swaps in their dashboard. Every other
 * route stays the generic SPA shell — they need a session to mean anything,
 * and `/join/*` is a private link the API unfurls instead (ADR-0038).
 */

export const SITE_ORIGIN = "https://www.picksleagues.com";

export interface PrerenderRoute {
  path: string;
  title: string;
  description: string;
}

export const PRERENDER_ROUTES: readonly PrerenderRoute[] = [
  {
    path: "/welcome",
    title: "Picks Leagues — Season-long sports leagues with friends",
    description:
      "Picks Leagues is a free web app for running season-long sports leagues with friends — NFL pick'em and survivor today, March Madness brackets to come. Create a league, invite your crew with a link, make weekly picks, and follow the standings all season.",
  },
  {
    path: "/rules/pickem",
    title: "NFL Pick'em rules · Picks Leagues",
    description:
      "How a Picks Leagues NFL Pick'em league works: weekly picks straight up or against the spread, when picks lock, how pushes score, and how the weekly and season standings are built.",
  },
  {
    path: "/rules/survivor",
    title: "NFL Survivor rules · Picks Leagues",
    description:
      "How a Picks Leagues NFL Survivor pool works: one team a week, never the same team twice, elimination on a loss, and how the last member standing is decided.",
  },
  {
    path: "/rules/simulator",
    title: "How the simulator works · Picks Leagues",
    description:
      "What simulated time means when you're testing Picks Leagues: replayed seasons, a clock an organizer can move, and how a whole season plays out in an afternoon.",
  },
  {
    path: "/privacy",
    title: "Privacy Policy · Picks Leagues",
    description:
      "What Picks Leagues stores, what it doesn't, and what happens to your data when you delete your account.",
  },
  {
    path: "/terms",
    title: "Terms of Service · Picks Leagues",
    description:
      "The terms for using Picks Leagues, a free web app for season-long sports leagues with friends.",
  },
] as const;
