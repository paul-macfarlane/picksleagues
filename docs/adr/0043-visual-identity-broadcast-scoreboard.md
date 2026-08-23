# 0043. Visual identity: the broadcast scoreboard

- **Status:** Accepted
- **Date:** 2026-08-22
- **Related:** `.claude/rules/engineering.md` §Quality (theme tokens, one page skeleton, `Table`, `StatusPill`); backlog `18-visual-identity.md` (`VIS-1`–`VIS-8`); supersedes the look `LNCH-9` delivered, keeps its palette and mark (`LNCH-7`)

## Context

`LNCH-9` gave the app a considered palette — warm stone neutrals, the pigskin
orange as primary, Archivo for headings and Geist for body — and the owner's
verdict after two weeks of real use is that it still reads as a shadcn app.
Looking at the screens, the reason is structural rather than chromatic:

1. **One surface for everything.** 33 files render `Card`. The league header is
   a card; the week is a card; each game row is a card inside it; standings is
   a table inside a card. Same radius, same 1px border, same padding at every
   level, so there is no hierarchy, only nesting.
2. **The type scale is flat.** Archivo is present, but an `h1` at ~24px over a
   14px body never lets the display face be a display face. Nothing on screen
   is *big* — no score, no rank, no record — which is the single most
   sports-app thing missing.
3. **One accent means five things.** Orange is the primary button, the pill
   tint, the active tab underline, the selected pick, and the commissioner
   marker. A color that means everything reads as "the theme color" rather
   than as meaning.
4. **Domain objects wear generic chrome.** A matchup, a standings row, and a
   member row all look like list items from a settings page. Two rivals in a
   game are two identical grey buttons with a logo each.

What is already right and must survive: the mark, the warm neutral palette,
both themes, `StatusPill` / `Table` / `QueryState` / `UserIdentity` /
`TabNav` as single homes, the phone-first shell (`17-mobile-feel`), and the
copy-decoupled E2E suite (`QLTY-2`) that lets a re-layout land without the
merge gate vetoing it. Nothing here changes the API, the data model, or any
testid the journeys bind to.

Directions considered, with the owner: a box-score / stat-sheet look
(hairline rules, dense numerals — quiet, but the "broadsheet" default every
generated design lands on), turf-and-chalk (field green as the second color —
NFL-specific in a way March Madness would fight), a ticket / pennant idiom
(the most character and the most bespoke components to maintain), and the
broadcast scoreboard. The owner chose the scoreboard, a condensed display
face, orange restricted to action/selection, and a sweep of every screen
including admin and the simulator.

## Decision

The app's visual vernacular is the **broadcast scoreboard**: a light page with
a dark "ink" band where the thing being scored is named, condensed numerals
wherever a number is the point, and the orange reserved for what the member
can act on or has chosen. Five commitments, each a token or a primitive so the
look is enforced by the code rather than by review.

### 1. Type roles, not sizes

Three named roles, each a utility in `index.css`; a component reaches for the
role, never for an ad-hoc size + weight + tracking combination.

| Role | Face | Used for |
| --- | --- | --- |
| **display** | Archivo Variable at `font-stretch: 65%`, weight 700–800, uppercase, tight tracking | the league name in its band, page `h1`, and every *big number*: rank, record, points, score, spread, "3 of 3 picked" |
| **heading** | Archivo at normal width, weight 600 | section titles (`h2`/`h3`, `CardTitle`) |
| **eyebrow** | Geist, 11px, uppercase, `tracking-wider`, muted | the label above a thing: `WEEK 1`, `STANDINGS`, `KICKOFF`, table headers |

Body stays Geist. The condensed face is Archivo's own width axis — the import
moves from `@fontsource-variable/archivo` (weight axis only) to
`@fontsource-variable/archivo/wdth.css`, about 55 KB more font and no new
package. Numerals in the display role are always `tabular-nums`.

### 2. Surface tiers, not cards

Four tiers; a screen uses each for what it is, and a bordered surface never
nests inside another bordered surface.

| Tier | Primitive | Treatment | Reserved for |
| --- | --- | --- | --- |
| **band** | `Band` (new) | ink background (`--ink` / `--ink-foreground`), display type | the subject of the screen: the league header, a hub league card's top strip. **At most one per screen.** |
| **section** | `Section` (new) | eyebrow + heading + optional action slot, separated from neighbours by whitespace only — no border, no fill | the default grouping: standings, the week's games, members, settings groups, admin panels |
| **panel** | `Card` (kept, `--radius` tightened) | 1px border, `--card` fill | a thing that is an *object*: a league in a list, a dialog-like form, the install card, a sim scenario |
| **row** | list + hairline `border-b` | no own border or fill; the row's *left edge* may carry a 3px rule that encodes its state (outcome color on a settled pick, orange on a selected one) | game rows, standings rows, member rows, audit rows |

The ink tokens are new: `--ink` (light: a warm near-black, dark: a shade
deeper than the page) and `--ink-foreground` / `--ink-muted-foreground`.
`--radius` drops from `0.5rem` to `0.375rem` — a scoreboard is squarer than a
settings page — and the change propagates through the existing radius scale.

### 3. Orange means "yours to act on"

`--primary` paints exactly: buttons, the selected pick, the active tab, focus.
Every other current use re-homes:

- commissioner marker → `StatusPill` tone `strong` (ink-tinted)
- league mode / visibility → `neutral`
- "Picked" / progress counts → display numerals, no tint
- a live game → `strong` plus a pulsing dot; never orange (it is not an
  action) and never `destructive` (that is a loss)

`--brand` (the mark's literal hex) stays what it is and stays on the mark.

### 4. `StatusPill` becomes a caps tag

`rounded-sm`, eyebrow type, same six semantic tones. One primitive change that
ripples to every annotation in the app — and the shape now matches the
eyebrows it sits beside instead of being the one rounded-full element on a
squared screen.

### 5. The signature: one `MatchupLine`

The matchup row is the thing members touch most, so it is where the boldness
is spent. One component, used by the Pick'em sheet, the Survivor sheet, the
All Picks breakdown, the slate preview, and the admin games browser:

```
 🐬 MIA  +3   │ Wed 12:27 PM │   −3  BUF 🦬
 ▌(selected side fills primary; the left rule carries the state)
```

Two team cells face each other across a centre column; the abbreviation is
display type, the number beside it is the spread before kickoff and **the score
in the same slot after it**. The row's shape never changes across
pre-pick → picked → locked → live → final — only what the numeral slot holds
and what the left rule says. That is the consistency win: today those five
states are rendered by four different layouts.

### What does not change

The page skeleton (`max-w-5xl` column, `<main>` padding), the app header and
bottom tab bar layout, `TabNav`, `Table`'s role as the one table primitive,
`QueryState`, the toast mechanism, every `data-testid`, and the rule that
design is verified at 390px in both themes before any wider width.

## Consequences

**Easier.** A screen is composed from five named things (band, section, panel,
row, matchup line) and three type roles, so "does this screen match the
others" becomes a checklist rather than a taste call — that checklist is
`VIS-8`'s coherence audit and the three rules `VIS-1` adds to
`engineering.md` (surface tiers, type roles, orange = action). March Madness
arrives into an idiom that already has a home for a bracket slot (a row with a
numeral) and a pool leaderboard (the standings board).

**Harder.** `Card` loses its status as the default container, and 33 call
sites get re-classified by hand (`VIS-2`); most become `Section`, which is
mechanical, but each needs a human eye. The E2E suite must stay green across
the sweep — it binds to roles and testids, not copy or DOM, which is exactly
why `QLTY-2` ran before `LNCH-9` and why this work is safe now. The `wdth`
font file is larger; if the bundle budget objects, the fallback is the
weight-only Archivo at a tighter letter-spacing, losing some but not all of
the condensed voice.

**Revisit if** a second band earns its place on one screen (the one-per-screen
rule exists to keep the band meaningful — if two genuinely different subjects
share a screen, the screen is probably two screens), or if the condensed
numerals fail legibility at 390px for any member — the display role's floor
is 20px for that reason.
