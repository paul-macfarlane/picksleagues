# 0023. Game Mode 2 is named Survivor, not Elimination

- **Status:** Accepted
- **Date:** 2026-08-07
- **Related:** [0024](0024-survivor-settings-carry-a-resolved-range.md) (the settings
  decision shipping alongside this rename), [0016](0016-per-mode-result-and-standings-tables.md)
  (mode-scoped naming repo-wide), [0007](0007-game-data-ingestion-model.md)
  (regular-season only); `docs/mvp-spec.md` §Game Mode 2; `docs/architecture.md`
  §Domain Model, §Settlement & Scoring, §API Surface; backlog ELM-1
  (`backlog/06-survivor.md`)

## Context

The locked v0.3 documents call the second NFL game mode "Elimination", and the
shipped surfaces followed: `LEAGUE_MODE.ELIMINATION = "elimination"`,
`EliminationSettingsSchema`, `ELIMINATION_PUSH_TIE_RESOLUTION`,
`EliminationSettingsFields`, and the arch sketch's `elimination_picks` /
`elimination_state` / `PUT /leagues/:id/elimination/weeks/:weekId/pick`.

That is not what the format is called. **"Survivor pool" is the industry-standard
term** — the name a member arriving from any other product already holds. ESPN's
"Eliminator" and the UK's "Last Man Standing" are minority synonyms, and the legacy
"suicide pool" name is deliberately avoided as needlessly grim. The spec itself
gives the game away: §Game Mode 2's own first sentence is "A survivor pool", and its
standings view is "a survivor board". The mode was documented under one name and
described under another from the start.

A product-facing name is worth getting right before members read it, but the reason
to act **now** rather than at any other moment is cost. The mode's pick,
settlement, and board layer has not been written yet: what exists today is the
settings schema, the create/settings forms, the mode label, and the `LEAGUE_MODE`
value. The stored data is a single `text` column (`leagues.mode`) with no enum type
to alter. Every later week adds pick tables, a scoring module, a settlement writer,
routes, web modules, query keys, and tests — all of which the naming rule (ADR-0016)
requires to carry the mode prefix. **This is the cheapest the rename will ever be,
and it gets more expensive monotonically.** Deferring it means either shipping the
wrong name to members or paying a multiple of this diff later.

## Decision

**The mode ships as Survivor.** `LEAGUE_MODE.SURVIVOR = "survivor"`, and every
mode-specific surface is named `survivor*` under the ADR-0016 naming rule —
tables (`survivor_picks`, `survivor_state`, `survivor_pick_results`), Zod schemas
and their OpenAPI components (`SurvivorSettingsSchema`, …), services, HTTP paths
(`/leagues/{id}/survivor/…`), web data modules, query keys, and components. The
locked spec and architecture documents are reworded to match, along with the
backlog, the engineering rules, and the repository policy documents.

Existing `leagues.mode` rows reading `"elimination"` are rewritten to `"survivor"`
by a data migration shipping in the same work package (ELM-1). Without it the
stored value stops parsing against `LEAGUE_MODE` and every existing dev league
becomes unreadable rather than merely mislabelled.

## Consequences

**ELM ticket IDs do not change, and never will.** `docs/agents/issue-tracker.md`
makes IDs stable for the life of the tracker: commits, ADRs, plan files, and PR
titles all cite them, and an ID that gets rewritten turns every one of those
references into a dead pointer. So the epic file is renamed
`backlog/06-elimination.md` → `backlog/06-survivor.md` and its prose is reworded,
but the tickets stay `ELM-1` … `ELM-6`. A reader meeting an `ELM-` prefix in a
Survivor commit is looking at the intended, permanent state, not a missed rename.

**Member-state vocabulary is unchanged.** "Alive", "eliminated", and "revived" are
standard survivor-pool terms — a survivor pool is precisely a format in which
members get eliminated. Renaming them would replace correct domain language with
invented language to satisfy a find-and-replace. So `member_eliminated`,
`eliminated_week_id`, the `all-eliminated` sim scenario slug, and every
alive/eliminated/revived label keep their names, in code and in prose. The rule is:
**the mode is Survivor; what happens to a member inside it is still elimination.**

**ADRs 0006–0022 are historical records and are deliberately not reworded.** An ADR
is immutable once merged (`docs/adr/README.md`) — it records what was decided, in
the words it was decided in. ADR-0007's regular-season ruling, ADR-0016's table
fork, and ADR-0020's scope note all say "Elimination" and will continue to. **A
reader who meets "Elimination" in an ADR numbered below 0023 is reading about this
mode, under its former name, and should land here.** That sentence is the whole
reason this consequence is written down rather than left implicit: without it, the
surviving occurrences look like an incomplete sweep, and the next person to notice
them "finishes the job" by editing records that are supposed to be frozen.

**Two names circulate for a while, and that is the accepted cost.** Git history,
merged PR titles, and the earlier ADRs carry "Elimination" permanently; the code,
the docs, and everything shipped from ELM-1 forward carry "Survivor". The
alternative — leaving the product name wrong because the history mentions it — is
worse, and the mapping is one sentence long.

**Revisit if** the name turns out to collide with something member-facing that
matters (a trademark concern, or a second survivor-shaped mode needing to be
distinguished from this one), at which point the same argument applies again and
the rename is more expensive than it is today.
