# Design system

Which named thing to reach for when building a screen. The direction and the
reasons are ADR-0043 (the broadcast scoreboard); the rules that reviews hold
a diff to are `.claude/rules/engineering.md` §Quality. This page is the quick
reference: tokens, type roles, surface tiers, and what the orange may touch.
`VIS-1` landed the tokens, roles, and tag; `VIS-2` the `Band` and `Section`
primitives and the row class, with every surface re-classified onto a tier;
`VIS-3` the matchup line; `VIS-4` the subject band and the league card;
`VIS-5` the boards, the week picker, and the pick-sheet count; `VIS-6` the
public and auth surfaces, with `Figures` as the one home for the numeral slot;
`VIS-7` the admin and simulator hand-pass.

## Tokens

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
| `accent` / `accent-foreground` | `highlight` tag | a warm lift with no verdict in it |
| `success`, `destructive` | outcome | a correct / incorrect settled pick, and only that |
| `brand` / `brand-foreground` | the mark | the logo's literal hex; never a surface |

`--radius` is 0.375rem; the scale (`rounded-sm` … `rounded-4xl`) derives from
it, so a component never sets a literal radius.

## Type roles

Three utilities in `index.css`; a call site picks the role and a size, never
a weight or tracking of its own. Body copy is the unstyled default (Geist).

| Utility | Face | Reach for it on |
| --- | --- | --- |
| `type-display` | Archivo at 65% width, 700, uppercase, tight, tabular | page `h1` (applied by the base layer), the league name in its band, and every number that is the point: rank, record, points, score, spread, "3 of 3 picked". Floor: 20px. |
| `type-heading` | Archivo at normal width, 600 | `h2` / `h3` (base layer), `CardTitle`, a section's title |
| `type-eyebrow` | Geist 11px, 500, uppercase, wide, muted | the label above a thing (`WEEK 1`, `STANDINGS`, `KICKOFF`), `TableHead`, `StatusPill`. Pair with a `text-*` colour to recolour — a single-property utility beside it wins. |

A display numeral sits in the slot the thing's *label* points at: eyebrow
above, numeral below, nothing between. `Figures` (`components/figures.tsx`)
is that slot as a primitive — a `<dl>` of eyebrow-over-numeral cells, the
numeral at `text-2xl` by default — and every list of figures composes it: a
discovery card's members and spots left, an invite's roster, and
`LeagueStanding` (`components/league/league-standing.tsx`), which is the slot
for the viewer's own place in a league — rank and record for Pick'em, alive-or-out and who is
left for Survivor, the roster size before the league has kicked off — read
from the `myPickemStanding` / `mySurvivorStanding` fields every league DTO
carries, so the header and the hub card never disagree.

The boards put the same slot on every row. The Pick'em standings table
(`pickem-standings-table.tsx`) sets rank and points in the display role at
`text-xl` under their eyebrow headers and marks every rank-1 row with a
`strong` `Leader` tag — tied leaders all carry it, since a shared rank has
nothing behind it (ADR-0018) — while the W-L-P record stays body-size, three
joined figures at the 20px floor not fitting its column at 390px. The All
Picks member headers use the same rank numeral. The Survivor board has no
rank (ADR-0016), so its row numeral is `SURVIVED` over the count of settled
weeks the member came through (`survivorWeeksSurvived`, a push counting —
ADR-0033), and no leader mark: `Winner` is the only verdict it hands out. A
board's "last updated" stamp is an eyebrow. On the pick sheets, the week
picker's value is the display role at `text-2xl` with a screen-reader-only
label (`LeagueWeekPicker` composes the Select directly; `LabeledSelect` keeps
its bordered input look for settings fields), and the Pick'em action bar's
count reads `4 OF 4` beside a `PICKS` eyebrow.

The public pages speak the same voice. The welcome hero is the one band with
no league in it: the mark, `PICKS LEAGUES` in display at `text-5xl`, the
tagline, the orange sign-in button (the page's only action), and a
`FREE TO PLAY` eyebrow; beneath it the three mode cards stay panels under a
`GAME MODES` section, and the "How it works" steps are bare display numerals
(`01`, `02`, `03`) — never a circle, the one rounded-full shape on a squared
screen. `StaticPage` (rules, terms, privacy) puts an eyebrow *above* its `h1`
(`RULES`, `GUIDE`, or the effective date) rather than a subtitle beneath; the
visitor header's wordmark is display type; the legal footer's links are
eyebrows. The sign-in and claim-username panels keep their shape with the
title in display at `text-3xl`, and the invite card is the hub card's shape —
`LeagueCardStrip` on top, `Figures` and the shared `leagueTimingLine` beneath —
so a member joins the same object they will later see on the hub.

The operator surfaces speak it too. The sim-clock strip in the sticky header
is a ticker: a `SIMULATED TIME` eyebrow, the instant as a display numeral at
the 20px floor, the scenario as a second eyebrow, on the `accent` tint — not
ink, which is the league band's, and not orange, which would claim an action
where there is only a warning. The Clock panel's readings (simulated now, real
now, offset) are `Figures` at `text-xl`; the scenario name stays
eyebrow-over-body, since a name in condensed caps wraps badly at 390px. Every
game an operator sees — the games browser, the integrity list, the stat
context browser, the sim fixtures — is a `MatchupLine`, with the kickoff in
the centre where the row is about *which* slate rather than a game's state.
A row's detail block is a stack of `LabeledValue` lines (eyebrow beside the
value; `ResolvedField` adds the provider's value when an override masks it),
`OverriddenTag` is the one danger tag on a corrected row, and `RowEditor` is
the disclosure every inline editor opens from. The integrity list's rows carry
a destructive left rule instead of a bordered box.

## Surface tiers

Four tiers, and a bordered surface never nests inside another bordered
surface. Ask "what is this region?" and take the first row that fits.

| Tier | Primitive | Looks like | It is |
| --- | --- | --- | --- |
| band | `Band` | ink fill, display type | the subject of the screen — the league header, a league card's top strip (`LeagueCardStrip`). At most one per *subject*: a league page has one, and a list of league cards has one per card because each card is its own subject. The welcome hero is the only band without a league in it. |
| section | `Section` | eyebrow + `h2` + description + action slot, whitespace only | the default grouping: standings, the week's games, members, a settings group, an admin panel |
| panel | `Card` | 1px ring, `card` fill | an object: a league in a list, a dialog-like form, the install card, a sim scenario |
| row | `<li className={rowClassName}>` | hairline, optional left rule | a game, a standings line, a member, an audit entry — the left rule carries state (outcome colour when settled, `primary` when selected) |

Inside a `Band` the theme tokens are re-pointed (`foreground` and
`muted-foreground` to the ink pair; `muted`, `accent`, and `border` to
`ink-muted`), so a `StatusPill`, an eyebrow, or `text-muted-foreground` renders
on ink with no band-specific variant. A `Section`'s `title` is a real `h2` —
the page's `h1` is its band's subject or its page title, and a section with no
title renders no header. The row class (`apps/web/src/components/row.tsx`)
carries the hairline and the vertical rhythm; its list parent is a gapless
`flex flex-col`, and a row composes its own layout classes beside it.

What stays a panel, and why: a league card on the hub or in discovery (an
object in a list — its strip is the league header at card scale, and its body
holds the numerals: the viewer's standing on the hub, members and spots left
in discovery), the create-league / sign-in / claim-username / join /
not-found / no-leagues cards (a dialog-like form, centred in the column), the
renew-season notices, the install card, the profile identity form, the welcome
page's three mode cards, and the simulator's control cards (each a thing the
operator acts on).

## The matchup line

`MatchupLine` (`apps/web/src/components/league/matchup-line.tsx`) is the one
shape a game takes anywhere it is shown (ADR-0043 §5): two `MatchupSide`
cells facing each other across an eyebrow centre column. The cell is logo,
abbreviation and a numeral in the display role at `text-xl`; the numeral slot
holds the line before kickoff and the score after it (`matchupNumerals` in
`lib/game.ts`), and the centre holds the kickoff, the period and clock, or the
status word (`gameStateLead`). The line is layout only — a pick sheet puts its
`MatchupSide` inside the side control, a read-only surface renders it bare —
and a row's state lives on the row's left rule (`rowRuleClassName`): `primary`
for the member's own live selection, the outcome colour once graded,
transparent otherwise. Tags (`Picked`, `Locked`, `In progress`, the grade) and
the Stats trigger sit on the line beneath. Used by both pick sheets, the All
Picks breakdown (where the taken side is ink and the other muted — never
orange, it isn't the viewer's), the slate preview (no line; a score once there
is one) and the admin games browser (override-resolved values).

## Tags

`StatusPill` is a caps tag in the eyebrow role with four tones: `neutral`
(visibility, "Locked", "No line yet"), `highlight` (an opportunity — "New
season available", a survivor still alive), `strong` (ink-tinted: a game in
progress, the commissioner marker, the member's own pick), `success` /
`danger` (a settled pick's grade, always with its glyph). There is no primary
tone on purpose.

## Orange

`--primary` is the member's cue that something is theirs to do or have done:
a button, the pick they selected, the tab they are on, the focus ring. Every
other emphasis is ink, a muted tone, or an outcome colour. A live game pulses
in `strong`; an edge marker in the stats sheet is `foreground`; the welcome
page's step numerals sit on ink.
