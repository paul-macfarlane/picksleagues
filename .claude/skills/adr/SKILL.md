---
description: Scaffold a new Architecture Decision Record
argument-hint: <short title of the decision>
---

Create a new ADR for: **$ARGUMENTS**

1. Find the next number: the highest `NNNN-*.md` in `docs/adr/` + 1, zero-padded to 4 digits.
2. Copy `docs/adr/template.md` to `docs/adr/NNNN-<kebab-title>.md`.
3. Fill it in from the current conversation context: the real context/forces, the decision made, and its consequences. Status `Accepted` unless the user says it's still proposed. Date it today. Link related `docs/mvp-spec.md` sections, `docs/architecture.md` sections/decision-log entries (D1–D15), and backlog task IDs.
4. Add a row to the index table in `docs/adr/README.md`.
5. If this decision changes the baseline in `docs/architecture.md` (or the rules in `docs/mvp-spec.md`), update that doc too and note it in the ADR's Related line — the two docs must stay reconciled.
6. Report the path created and a one-line summary of the decision.

Keep it tight — an ADR is a few sentences per section, not an essay.
