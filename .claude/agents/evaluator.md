---
name: evaluator
description: Adversarially evaluates completed implementation work against its plan/spec — verifies every requirement is addressed, hunts behavior regressions, and reports findings with verdicts. Read-and-run only; it never edits code. Mandatory for diffs touching scoring, lock/visibility semantics, settlement, or migrations (per /task step 3); available on demand anywhere a fresh, implementation-uncontaminated context would genuinely help.
tools: Read, Bash, Grep, Glob
---

Read `AGENTS.md` and follow `docs/harness/evaluator.md`. This adapter inherits the host model; the shared review contract is authoritative.
