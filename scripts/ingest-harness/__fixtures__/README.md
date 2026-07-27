# Ingest harness fixtures

These fixture trees are test data for `scripts/ingest-harness/check.test.mjs`. They are **not**
skill text: nothing under this directory lives inside `src/cli/slash-command/bs/`, which is the
only tree `install-claude-command.ts` recursively copies into a designer's installed
`~/.claude/skills/bs-shared/`. No designer will ever receive these files as instructions.

**A fixture is never hand-edited to make a failing test pass.** If the checker's expectations
change (a new check id, a changed regex, a relaxed heuristic), the fixture is re-derived from
its source of truth — the `nonconforming/` tree from the real 2026-07-27 proof-run output
(`170-PROOF-INDEX.md` / `170-PROOF-SLICE.md`), the `conforming/` tree by hand against the
contract in `check.mjs` — not patched line-by-line until green.
