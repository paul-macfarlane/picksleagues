# Epic: Mobile Feel (MOB)

The SPA is a well-behaved responsive website: hamburger → drawer for primary
nav, a horizontally-scrolling underline `TabNav` for league sections, a
`fixed` bottom action bar on the pick sheets, and (since `LNCH-15`/`LNCH-16`)
an installable standalone PWA. Installed on a phone it still *reads* as a
website — navigation lives at the top under the thumb's reach, the home
indicator overlaps the action bar, taps flash grey and rubber-band the shell,
and route changes cut instead of move. This epic closes that gap without
adding backend, tables, or jobs: every item is `apps/web`, cheap to ship and
cheap to revert (friends-scale bar).

Decisions (owner, 2026-08-22):

- **Global bottom tabs always.** Inside a league the bar stays Leagues /
  Browse / Profile; league sections keep the underline `TabNav`. One nav model.
- **The pick sheets' action bar stacks above the tab bar**, never hides it.
  Navigation that vanishes when picks are dirty confuses more than it frees.
- **Admins get a fifth "More" tab** (Admin / Simulator) instead of keeping
  the drawer; the drawer is gone for everyone. **Home and League merged into
  one "Leagues" tab** that opens the hub at `/` (your leagues + create/browse);
  a league is one tap deeper. The first cut's League tab navigated on the
  first tap and opened a switcher on the second, which nothing on screen
  signalled and which contradicts the re-tap-resets-the-tab convention. The
  desktop header follows the same order (Leagues · Browse · Admin · Simulator)
  and its league switcher is gone with it — one nav model at every width.
  (MOB-2, 2026-08-22.)
- **Order:** MOB-1 → MOB-2 → MOB-3 are the "feels like an app" threshold and
  go first; MOB-4–7 are a second round after living with the tab bar.
- Round two decisions (owner, 2026-08-23): MOB-6 narrowed to destructive
  confirmations — its other two named surfaces no longer exist (MOB-2 removed
  the league switcher; the theme picker became a profile-page Select). MOB-5
  refreshes by invalidating with no key filter — only the current view's
  active queries refetch, and no per-route key registry exists to go stale.
  MOB-3 ships the cross-fade only; the directional slide wasn't worth the
  history bookkeeping. MOB-8 appended: the install card's Android gap.
- **Not in scope:** offline shell / service worker (an offline pick screen is a
  lock-state hazard under the Clock rule — stale "now"); Web Push (its own
  epic if ever; needs a subscription table, VAPID keys, a job); gesture-only
  interactions like swipe-to-pick (fail keyboard/a11y, need a visible fallback
  anyway).

Layering contract every item here inherits (`routes/_authed.tsx`,
`components/app-header.tsx`): header z-40 > `TabNav` z-30 > page-level fixed
bars z-20 > content; overlays portal at z-50. The header publishes
`--app-header-height` for sticky offsets; a bottom bar publishes its own
height the same way so the pick sheets' bottom padding and action bar offset
against it rather than hardcoding.

- [x] **MOB-1** — Standalone-mode polish + touch targets. `viewport-fit=cover`
  on the viewport meta; `env(safe-area-inset-*)` padding on the header, every
  bottom-`fixed` bar (pick sheets), and the toaster's mobile offsets;
  `-webkit-tap-highlight-color: transparent` and `touch-action: manipulation`
  on interactive elements; `overscroll-behavior-y: none` on `html` so
  rubber-banding doesn't drag the shell; `user-select: none` on nav chrome;
  `apple-mobile-web-app-status-bar-style` matched to the theme. Audit every
  tappable control for a 44×44pt hit area (tab links, pick-sheet team buttons,
  avatar trigger, navigating table rows) — enlarge the hit area, not
  necessarily the glyph. Verify at 375px in standalone mode (sim e2e viewport
  plus a real iPhone screenshot in `docs/evidence/test-results/MOB-1/`). Pure
  CSS/markup. _(deps: none)_
- [x] **MOB-2** — Bottom tab bar on phone. Below `sm`, a `fixed` bottom bar
  (z-20 tier, above page content, under `TabNav`) with Home / Browse / League /
  Profile: icon + short label, `aria-current="page"`, 44pt targets, safe-area
  bottom padding. "League" resolves to the member's current league (last
  visited, else first of `useMyLeagues`) and opens the existing switcher when
  they have several; Admin/Simulator stay in the header for admins (the drawer
  goes away for members; decide whether admins keep it or get an overflow
  tab). Publishes `--app-tab-bar-height`; the pick sheets' action bars sit
  directly above it (`bottom: var(--app-tab-bar-height, 0px)`) and their
  clearing padding adds both heights. Desktop header nav unchanged. E2E: the
  phone-width pick journey still reaches Submit with the tab bar present.
  _(deps: MOB-1)_
- [x] **MOB-3** — Route view transitions. TanStack Router's
  `defaultViewTransition` (or a `startViewTransition` wrapper) for a cross-fade
  on navigation, with a directional slide only if it stays under ~20 lines;
  `prefers-reduced-motion` disables it; no library. Skeleton/`QueryState`
  surfaces must not double-animate. _(deps: MOB-2)_
- [x] **MOB-4** — League-section nav fits the phone. The owner ruled out
  horizontal scroll for the member-facing bar (2026-08-22, during MOB-2
  review): `TabNav fit` lays the league sections out as equal columns below
  `sm`, and "League Picks" became "All Picks" so five tabs fit at 375px.
  The admin bar followed (owner, 2026-08-22): the guide became a standalone
  `/guide` route linked from the Admin heading (the seat the simulator's
  "How the simulator works" link uses — not the app's primary nav), and
  the never-used Seasons tab was removed, leaving five fitted tabs. The
  Simulator bar (five) is fitted too. Edge fades stay out until someone
  actually works those panels from a phone. _(deps: MOB-2)_
- [x] **MOB-5** — Pull-to-refresh on query-backed views (standings, games,
  dashboard): a touch-start-at-scrollTop-0 gesture refreshes the current
  view, with a visible spinner affordance. Shipped as one shell-level gesture
  invalidating with no key filter rather than the per-route key wiring first
  sketched here (owner, 2026-08-23 — see round-two decisions above). Makes
  refresh explicit rather than claiming real-time freshness. _(deps: MOB-2)_
- [x] **MOB-6** — Bottom sheets on phone for the dialogs a thumb reaches for:
  destructive confirmations, the league switcher, the theme picker. shadcn
  `Sheet side="bottom"` with safe-area padding; desktop keeps centered
  dialogs. Narrowed to destructive confirmations (owner, 2026-08-23 — see
  round-two decisions above): the shared `AlertDialogContent` renders as a
  bottom sheet below `sm`, covering every confirm call site at once.
  _(deps: MOB-1)_
- [x] **MOB-7** — Haptic on a successful pick save (`navigator.vibrate(10)`,
  no-op where unsupported), fired from the mutation hook's success path so
  every pick surface gets it once. _(deps: none)_
- [x] **MOB-8** — Android install instructions (owner, 2026-08-23). LNCH-16's
  install card knew two paths — Chromium's captured prompt and iOS Share
  steps — so an Android browser holding the event back (Firefox always,
  Chrome until its heuristics pass) showed no affordance at all. An `android`
  install path shows generic menu steps ("⋮ → Add to Home screen / Install"),
  one wording for all Android browsers; the native Install button still wins
  whenever the prompt was captured. _(deps: none)_
