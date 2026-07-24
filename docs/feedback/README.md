# Feedback log

Human review feedback and how each item was resolved — one file per epic, named
after the epic's backlog file (`03-leagues.md` ↔ `backlog/03-leagues.md`). One
section per round inside each file, newest last. Kept terse on purpose — commits
and `.claude/rules/engineering.md` hold the detail; this is the index for "didn't
we already decide this?" moments.

`/feedback` appends each round's item→resolution table to the file for the epic
the round's work belongs to (creating the file when an epic gets its first
round). Cross-epic rounds go in the file of the dominant epic with a one-line
pointer from the others.

- [03-leagues.md](03-leagues.md) — Leagues epic (rounds 1–5)
