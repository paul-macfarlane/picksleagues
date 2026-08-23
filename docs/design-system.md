# Design system

The reference a new screen is built from. The direction and the reasons are
ADR-0043 (the broadcast scoreboard); the rules a review holds a diff to are
`.claude/rules/engineering.md` §Quality (surface tiers, type roles, orange =
action, theme tokens, one page skeleton, `Table`, `QueryState`). This page sits
between them: the named things a screen composes from — tokens, type roles,
surface tiers, the matchup line, the tag — each with when to reach for it,
when not to, and the shipped screen that shows it. A surface that needs a
thing this page doesn't name is either composed from two it does, or it is a
new primitive, which is an ADR-0043 amendment and not a one-off class string.

`VIS-1` landed the tokens, roles, and tag; `VIS-2` the `Band` and `Section`
primitives and the row class, with every surface re-classified onto a tier;
`VIS-3` the matchup line; `VIS-4` the subject band and the league card;
`VIS-5` the boards, the week picker, and the pick-sheet count; `VIS-6` the
public and auth surfaces, with `Figures` as the one home for the numeral slot;
`VIS-7` the admin and simulator hand-pass; `VIS-8` the coherence audit and
its checklist; `VIS-9` this guide.

## Before the first diff

UI work reads this page first — `/task` points here — and answers four
questions before writing a class name:

1. **What is the subject?** It gets the band, and there is at most one.
2. **What are the groupings?** Sections. What are the objects? Panels. What
   are the lines in a list? Rows. A bordered surface never nests in another.
3. **Which numbers are the point?** Each is a display numeral under an
   eyebrow — a `Figures` cell, or a `MatchupSide` if the number belongs to a
   team.
4. **What can the member act on here?** That, and only that, is orange.

Then build at 390px first, in both themes, and hold the result to the
[coherence checklist](#the-coherence-checklist) before widening the window.
The thing to avoid is not a wrong choice but an *unnamed* one: a hand-built
label that is a pixel off the eyebrow, a card inside a card, a second ink
surface. Each reads as a second kind of thing on a screen that only has the
one, and no test catches it.

## The voice

A light page with one dark "ink" band where the thing being scored is named,
condensed numerals wherever a number is the point, and the orange reserved for
what the member can act on or has chosen. Five commitments, each a token or a
primitive so the look is enforced by the code rather than by review
(ADR-0043 §1–§5):

| Commitment | Enforced by |
| --- | --- |
| type roles, not sizes | `type-display` / `type-heading` / `type-eyebrow` utilities |
| surface tiers, not cards | `Band`, `Section`, `Card`, `rowClassName` |
| orange means "yours to act on" | `--primary` on buttons, selection, the active tab, focus; `StatusPill` has no primary tone |
| the tag is a caps eyebrow | `StatusPill` |
| one shape for a game | `MatchupLine` + `MatchupSide` |

What it is *not*: a box score (hairlines and dense small numerals — quiet,
and the default every generated design lands on), a field (no turf green), a
ticket (no bespoke die-cuts). When a new surface wants a treatment, the
question is which of the five it is an instance of.

## Tokens and themes

All colour goes through the theme tokens in `apps/web/src/index.css`; both
themes define every token, and a new pair must clear WCAG AA (4.5:1 for text)
in both. The pairs, with the roles they play:

| Token | Pairs with | Role |
| --- | --- | --- |
| `background` / `foreground` | page | the light page (dark theme: the dark page) |
| `card` / `card-foreground` | panel | a bordered object |
| `ink` / `ink-foreground`, `ink-muted-foreground`, `ink-muted` | band | the one dark surface on the screen; the subject is named here. `ink-muted` is the tag and hairline surface *on* ink |
| `primary` / `primary-foreground` | action | buttons, the selected pick, the active tab, focus — nothing else |
| `muted` / `muted-foreground` | eyebrow, neutral tag | the quiet label |
| `accent` / `accent-foreground` | `highlight` tag, the sim ticker | a warm lift with no verdict in it |
| `success`, `destructive` | outcome | a correct / incorrect settled pick, and only that |
| `brand` / `brand-foreground` | the mark | the logo's literal hex; never a surface |

`--radius` is 0.375rem; the scale (`rounded-sm` … `rounded-4xl`) derives from
it, so a component never sets a literal radius.

**Both themes, always.** A screen is not done until it has been read in dark
as well as light: ink in dark is a shade *deeper* than the page rather than a
contrasting block, so a band that reads as "the subject" in light can vanish
into a dark page if its content leans on the fill alone — which is why the
band's content is display type and eyebrows, not body copy. Never an
arbitrary colour value in a component (the one carve-out is a third-party
brand-mandated colour on an OAuth button, cited in a comment), because an
arbitrary value is right in exactly one theme. Team logos carry light and
dark variants (`TeamLogo` renders both, toggled by the theme class); a new
image asset does the same or is theme-neutral.

## Type roles

Three utilities in `index.css`; a call site picks the role and a size, never
a weight or tracking of its own. Body copy is the unstyled default (Geist).

| Utility | Face | Reach for it on |
| --- | --- | --- |
| `type-display` | Archivo at 65% width, 700, uppercase, tight, tabular | page `h1` (applied by the base layer), the league name in its band, and every number that is the point: rank, record, points, score, spread, "3 of 3 picked". Floor: 20px (`text-xl`). |
| `type-heading` | Archivo at normal width, 600 | `h2` / `h3` (base layer), `CardTitle`, a section's title |
| `type-eyebrow` | Geist 11px, 500, uppercase, wide, muted | the label above a thing (`WEEK 1`, `STANDINGS`, `KICKOFF`), `TableHead`, `StatusPill`, a stamp ("last updated"). Pair with a `text-*` colour to recolour — a single-property utility beside it wins. |

**Not for:** a display role on a *name* that can be long — a scenario name or
a member's display name in condensed caps wraps badly at 390px, so the
simulator's scenario stays eyebrow-over-body and `UserIdentity` stays body.
An eyebrow is never the only thing that says something: it labels a value
beside or beneath it. And never an ad-hoc `text-[10px] font-medium
tracking-wide uppercase` — each hand-built combination is a pixel off the
last, and two labels a pixel apart read as two kinds of thing.

### Numerals and the slot

A display numeral sits in the slot the thing's *label* points at: eyebrow
above, numeral below, nothing between. The numeral is always tabular
(the utility sets it) so a column of them aligns, and never below 20px — the
floor at which the condensed face stays legible at 390px; a figure that would
have to go smaller to fit is a figure that belongs in body size (the
standings record, below) rather than a smaller display.

`Figures` (`components/figures.tsx`) is that slot as a primitive — a `<dl>` of
eyebrow-over-numeral cells, the numeral at `text-2xl` by default — and every
list of figures composes it: a discovery card's members and spots left, an
invite's roster, the sim Clock panel's readings at `text-xl`, and
`LeagueStanding` (`components/league/league-standing.tsx`), which is the slot
for the viewer's own place in a league — rank and record for Pick'em,
alive-or-out and who is left for Survivor, the roster size before the league
has kicked off — read from the `myPickemStanding` / `mySurvivorStanding`
fields every league DTO carries, so the header and the hub card never
disagree. A numeral that belongs to a *team* is a `MatchupSide` instead (the
matchup line, below); a numeral that is a *row's* rank or points sits in the
board's column under its eyebrow header.

**Illustrated.** The Pick'em standings table (`pickem-standings-table.tsx`)
sets rank and points in the display role at `text-xl` under their eyebrow
headers and marks every rank-1 row with a `strong` `Leader` tag — tied
leaders all carry it, since a shared rank has nothing behind it (ADR-0018) —
while the W-L-P record stays body-size, three joined figures at the 20px
floor not fitting its column at 390px. The All Picks member headers use the
same rank numeral. The Survivor board has no rank (ADR-0016), so its row
numeral is `SURVIVED` over the count of settled weeks the member came through
(`survivorWeeksSurvived`, a push counting — ADR-0033), and no leader mark:
`Winner` is the only verdict it hands out. A board's "last updated" stamp is
an eyebrow. On the pick sheets, the week picker's value is the display role
at `text-2xl` with a screen-reader-only label (`LeagueWeekPicker` composes the
Select directly; `LabeledSelect` keeps its bordered input look for settings
fields), and the Pick'em action bar's count reads `4 OF 4` beside a `PICKS`
eyebrow. The matchup stats sheet sets each stat value in display at `text-xl`
with its section labels and stamps as eyebrows — it was the one screen the
`VIS-8` audit failed on this point, and the tell was a hand-built
`text-xs font-semibold` label.

## Surface tiers

Four tiers, and a bordered surface never nests inside another bordered
surface. Ask "what is this region?" and take the first row that fits.

| Tier | Primitive | Looks like | It is |
| --- | --- | --- | --- |
| band | `Band` | ink fill, display type | the subject of the screen |
| section | `Section` | eyebrow + `h2` + description + action slot, whitespace only | the default grouping |
| panel | `Card` | 1px ring, `card` fill | an object |
| row | `<li className={rowClassName}>` | hairline, optional left rule | a line in a list |

### `Band` — the subject

`components/band.tsx`. The one ink surface on a screen, where the thing being
scored is named: the league header (`LeagueHeader` — name in display caps, a
`MODE · SEASON` eyebrow, the viewer's `LeagueStanding` as display numerals,
the visibility and `Commissioner` tags), a league card's top strip
(`LeagueCardStrip` — the same header at card scale, `rounded-none` so it
sits flush in the card), and the welcome hero, which is the only band with no
league in it. At most one per *subject*: a league page has one, and a list of
league cards has one per card because each card is its own subject.

Inside a `Band` the theme tokens are re-pointed (`foreground` and
`muted-foreground` to the ink pair; `muted`, `accent`, and `border` to
`ink-muted`), so a `StatusPill`, an eyebrow, `Figures`, or
`text-muted-foreground` renders on ink with no band-specific variant. Compose
from those; never reach for `text-ink-foreground` inside one.

**Not for:** a warning (the sim-clock strip is `accent`), a grouping's header
(that is a `Section` eyebrow), a second subject on the same screen — if two
genuinely different subjects share a screen, the screen is probably two
screens (ADR-0043 §Revisit if).

### `Section` — the grouping

`components/section.tsx`. Eyebrow, a real `h2`, a description, and an action
slot, separated from its neighbours by whitespace alone. This is the default
container: standings, the week's games, members, a settings group, every
admin panel (`Games`, `Teams`, `Data integrity`, `NFL data sync`,
`Audit log`), the Survivor sheet's outcome notices (`You made it`, `You're
out`). The page's `h1` is its band's subject or its page title, so a section's
title is an `h2` and the sections are the screen's outline; a section with no
title renders no header. The `action` slot is where a section-scoped control
belongs (a sync button on an admin panel, a filter on a list) rather than a
button floating in the body; no shipped section uses it yet, so the first
one sets the pattern.

**Not for:** a thing that is an object in a list (a panel), and not as a
wrapper around a single panel to give it a heading — a panel carries its own
`CardTitle`.

### `Card` — the panel

`components/ui/card.tsx`. The 1px ring and `card` fill say "this is an
object": a league on the hub or in discovery (its strip is the band, its body
holds the numerals — the viewer's standing on the hub, members and spots left
in discovery), the create-league / sign-in / claim-username / join /
not-found / no-leagues cards (a dialog-like form, centred in the column), the
renew-season notices, the install card, the profile identity form, the
welcome page's three mode cards, and the simulator's control cards (each a
thing the operator acts on). Deliberately narrow content is a centred card
*inside* the page column, never a narrower page.

**Not for:** a grouping (that is a `Section`), a row (a card per game is what
ADR-0043 was written against), anything inside another card or inside a band.
A `Card` holds rows and text, never another `Card`.

### The row

`components/row.tsx` — a class string, not a component, because a row is a
list item with a hairline below it and nothing else. `rowClassName` carries
the hairline and the vertical rhythm; its list parent is a gapless
`flex flex-col`, and the row composes its own layout classes beside it. A
game, a standings line, a member, an audit entry, a fixture, a sim scenario's
games are all rows. A row's state lives on its *left edge*, `rowRuleClassName`
(3px, the narrowest that stays visible beside the hairline at 390px):
`pickOutcomeAccentClassName` once a pick is graded, `border-l-primary` for the
one the member has selected, `destructive` on an integrity-list anomaly, and
transparent otherwise so content stays aligned with its neighbours'. A row's
detail block is a stack of `LabeledValue` lines (eyebrow beside the value;
`ResolvedField` adds the provider's value when an override masks it), and
`RowEditor` is the disclosure every inline editor opens from.

**Not for:** a box. A row never draws its own border or fill — that is the
nesting the tiers exist to remove.

## The matchup line

`MatchupLine` (`components/league/matchup-line.tsx`) is the one shape a game
takes anywhere it is shown (ADR-0043 §5): two `MatchupSide` cells facing each
other across an eyebrow centre column.

```
 🐬 MIA  +3   │ Wed 12:27 PM │   −3  BUF 🦬
 ▌(the row's left rule carries the state)
```

The cell is logo, abbreviation and a numeral in the display role at `text-xl`;
the numeral slot holds the line before kickoff and the score after it
(`matchupNumerals` in `lib/game.ts` — "before kickoff" is the game's status,
not the lock), and the centre holds the kickoff, the period and clock, or the
status word (`gameStateLead`). The row's shape never changes across
pre-pick → picked → locked → live → final; only what the slot holds and what
the left rule says. The line is layout only — a pick sheet puts its
`MatchupSide` inside the side control, a read-only surface renders it bare —
and the tags (`Picked`, `Locked`, `In progress`, the grade) and the Stats
trigger sit on the line beneath.

**Reach for it** on every surface that shows a game: both pick sheets
(`pickem-game-row`, `survivor-game-row`), the All Picks breakdown
(`pickem-week-detail` — the taken side is ink via `emphasis`, the other muted,
never orange, since another member's choice isn't the viewer's to act on), the
slate preview (no line; a score once there is one), and every operator
view — the admin games browser (override-resolved values), the integrity
list, the stat context browser, the sim fixtures — with the kickoff in the
centre where the row is about *which* slate rather than a game's state.

**Not for:** two things that aren't rivals. A bracket slot in March Madness is
a row with a numeral (seed and score) and not a matchup line until two teams
face each other in it; a member-versus-member comparison is two `Figures`.

## Tags

`StatusPill` (`components/status-pill.tsx`) is a caps tag in the eyebrow
role with five tones: `neutral` (visibility, `Locked`, `No line yet`),
`highlight` (an opportunity — `New season available`, a survivor still
alive), `strong` (ink-tinted: a game in progress with its pulsing dot, the
`Commissioner` marker, the member's own pick, the standings `Leader`),
`success` / `danger` (a settled pick's grade, always with its glyph, via
`PickOutcomeBadge`; `OverriddenTag` is the one danger tag on a corrected admin
row). A tone never carries the meaning alone — every caller pairs it with a
word, and a verdict adds a glyph. There is no primary tone on purpose: a tag
is never something the member acts on, so a caller wanting one gets a compile
error. The E2E gate binds to a pill's `data-testid` and machine value, never
its word, so the word is the owner's to change.

**Not for:** a new tone styled by hand, a button that looks like a tag, a
count (that is a display numeral).

## Orange

`--primary` is the member's cue that something is theirs to do or have done:
a button, the pick they selected (the side control's held state and the
row's left rule), the tab they are on (`TabNav`'s underline, the bottom
`AppTabBar`'s icon), the focus ring. Every other emphasis is ink, a muted
tone, or an outcome colour. A live game pulses in `strong`; an edge marker in
the stats sheet is `foreground`; the welcome page's step numerals sit on ink;
the commissioner is a `strong` tag; the sim-clock strip is `accent`. The
check is mechanical: a grep for `primary` outside `components/ui` should hit
the active tab, the selected pick's rule and control, and nothing else.

## The 390px-first check

Every layout is designed and verified at 390px before any wider width,
because that is the width nearly every pick is made at. What the width
forces, and what the shipped screens did about it:

- **A display numeral that doesn't fit goes to body size, not a smaller
  display** — the standings record; the Survivor board's `SURVIVED` count
  holds its column because it is one figure.
- **A condensed name wraps badly** — the scenario name stays eyebrow-over-body.
- **The matchup line's centre column takes the room the word would** — the
  centre is `Wed 12:27 PM`, not `Kickoff Wed 12:27 PM`.
- **A five-column grid is unreadable**, whichever component renders it — the
  admin browsers are `<ul>` card-lists, and the only `Table` that must not
  scroll (the standings board) is `table-fixed` with a `<colgroup>`.
- **The left rule is 3px**, the narrowest that survives beside the hairline.
- **Touch targets are 44pt** (`touch-hit`, MOB-1) and the pick-sheet action
  bar stacks above the bottom tab bar (MOB-2); the Pick'em journey runs its
  joiner on `devices["iPhone 13"]`, so anything that must hold at phone width
  belongs on that member.

Then both themes, then 1024px. The capture in `docs/runbooks/verification.md`
(`VIS_CAPTURE=1 pnpm test:e2e --grep capture`) shoots every route at both
widths in both themes into `docs/evidence/test-results/vis-8/`; re-run it
after a visual change and read the new screen's frames first.

## The coherence checklist

What `VIS-8` held every screen to, and what a new screen is reviewed against
before it ships — read each screen at 390px first, in both themes:

- **One band at most.** The subject is named once; a second ink surface is a
  second screen.
- **No bordered surface inside another.** A `Card` holds rows and sections,
  never another `Card`; a row's state is its left rule, not a box.
- **Every number in a role.** A figure is `type-display` (20px floor) under its
  eyebrow; a stamp ("last updated", "updated 8/23") and the label above a
  thing are `type-eyebrow`. Ad-hoc `text-[10px]` or `text-xs font-semibold`
  labels are the tell.
- **The pill vocabulary is unchanged.** `StatusPill` tones only; no new tag
  styled by hand.
- **Orange only on action and selection.** The `primary` grep above hits the
  active tab, the selected pick's rule and control, and nothing else.
- **Both themes read.** Ink is the subject in dark too; no arbitrary colour.

## Composing a new screen

Two surfaces the epic was built for, walked through the four questions.

**A March Madness pool.** The subject is the league — `LeagueHeader` is
already the band, and `LeagueStanding` grows a March Madness branch (points
and bracket rank as `Figures`) read from a `myMarchMadnessStanding` field the
league DTO carries, so hub card and header agree. The bracket is a `Section`
per region with a `REGION` eyebrow; each slot is a row — seed as a display
numeral at the floor, team as `MatchupSide`-shaped logo and abbreviation, and
once two teams meet in a slot it is a `MatchupLine` with the score in the
numeral slot and the left rule carrying the graded outcome. The member's
current selection in an open slot is `border-l-primary` and the held side
control is primary, exactly as on the Pick'em sheet; the `4 OF 63` progress
count is the display role beside a `PICKS` eyebrow in the action bar. The
pool leaderboard is the standings board: rank and points in display under
eyebrow headers, `Leader` in `strong`, "last updated" an eyebrow. Nothing on
the screen is new except the settings schema and the scoring module.

**The next admin panel.** No band — the admin area's subject is the operator,
not a league, and the route's `h1` is its page title. The panel is a
`Section` with a title and an `action` slot for its sync or refresh button;
its list is a `<ul>` of rows, each a `MatchupLine` if it is a game or a
`LabeledValue` stack if it is a record, with `OverriddenTag` on a corrected
row and `RowEditor` as the disclosure any inline edit opens from. A count the
operator reads at a glance (rows synced, anomalies open) is `Figures` at
`text-xl`. The danger colour marks an anomaly's left rule; the only orange is
the button.
