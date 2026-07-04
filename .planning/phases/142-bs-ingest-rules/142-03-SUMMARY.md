---
phase: 142-bs-ingest-rules
plan: 03
subsystem: cli/slash-command (bs- skills)
tags: [ingest, scaffold, sketch, chunking, cli]
dependency graph:
  requires: [142-01]
  provides: [ingest/scaffold.md, ingest/sketch-derivation.md]
  affects: [143-146 (bs-build-chunk consumes SKETCH.md shape this phase produces), 149 (dry-run validation)]
tech-stack:
  added: []
  patterns:
    - "Citation-not-restatement: cite state-machine.md/templates/*.template.md sections by name, never restate their rules inline"
    - "Structural content-assertion tests (readFileSync + string/regex assertions, no markdown parser)"
key-files:
  created:
    - src/cli/slash-command/bs/ingest/scaffold.md
    - src/cli/slash-command/bs/ingest/sketch-derivation.md
  modified: []
decisions:
  - "scaffold.md corrects the old skill's stale directory-choice framing: boardsmith init always creates a new subdirectory and errors if it exists — no in-place mode"
  - "scaffold.md's verify sequence is ONE numbered block (compile -> serve-check -> kill), with kill as an explicit numbered step, never a footnote"
  - "sketch-derivation.md uses the byte-identical tail marker 'Status: proposed (sketch-level — no CHUNK.md yet)' matching SKETCH.template.md and the ingest.test.ts drift constant"
metrics:
  duration: "~25 minutes"
  completed: 2026-07-04
---

# Phase 142 Plan 03: Scaffold + Sketch Derivation Summary

Authored the two remaining `/bs-ingest-rules` reference files — `ingest/scaffold.md` (project
scaffold + compile/serve verification, INGEST-04) and `ingest/sketch-derivation.md` (the chunking
heuristic that fills `SKETCH.template.md`, INGEST-05) — completing Phase 142 and turning the
cross-file consistency gate green.

## What Was Built

**`src/cli/slash-command/bs/ingest/scaffold.md`** (114 lines): Extracts the old `/design-game`
skill's Phase 1B name-derivation rules verbatim (Display Name / Project Name kebab-case / Class
Name PascalCase, plus the lowercase/hyphenate/strip/PascalCase algorithm), while explicitly
correcting the old skill's stale directory-choice framing — `npx boardsmith init <name>` always
creates a new `<cwd>/<name>` subdirectory and errors (`Error: Directory "<name>" already exists`,
`init.ts:19`) if it exists; there is no "use current directory if empty" mode. The file then
specifies a single numbered verification sequence: (1) `cd <name> && npx tsc --noEmit` compile
gate with an iterate-until-clean loop; (2) `npx boardsmith dev --no-open`, waiting for the exact
ready-state line `Ready! Press Ctrl+C to stop.` (confirmed via direct grep of `dev.ts:791`) plus a
curl confirmation; (3) an explicit kill step in the same sequence, never a footnote, satisfying
both the repo's CLAUDE.md hard rule and the plan's "any server the skill starts is killed before
returning" requirement.

**`src/cli/slash-command/bs/ingest/sketch-derivation.md`** (85 lines): The chunk-carving
heuristic. States, citing `SKETCH.template.md`'s "## Mandated Chunks" section by name rather than
restating it: (1) the first chunk is always the core event loop; (2) the sketch must contain a
game-end/scoring/winner chunk and a final-acceptance chunk (full playthrough + coverage check +
design-QA/a11y audit); (3) every chunk carries a `ui: none | touches | major` tag; (4) test
scripts state outcomes, not gestures; (5) a hard cap — only the next 2-3 chunks get full detail,
everything else uses the byte-identical tail marker `Status: proposed (sketch-level — no CHUNK.md
yet)` with no `chunks/<slug>/` directory created; (6) variants are tagged out-of-scope-by-default
under "Variants (deferred)"; (7) negotiation posture — user ordering wins unless a named hard
dependency is violated.

## Verification

- `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "INGEST-04"` — 2 passed
- `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "INGEST-05"` — 4 passed
- `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "consistency"` — 8 passed
- `npx vitest run src/cli/slash-command/bs/ingest.test.ts` (full file) — 28/28 passed
- `npm test` (full repo suite) — 180 files / 2458 tests passed, zero regressions

## Deviations from Plan

None — plan executed exactly as written. Both tasks matched their `<done>` criteria on first
implementation; no auto-fixes, no architectural questions, no auth gates.

## Known Stubs

None — both files are complete reference documents with no placeholder content.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary surface introduced. The one
threat register item for this plan (T-142-04, leaked dev-server process) is mitigated by
scaffold.md's mandatory numbered kill step as designed; T-142-05 (tail-marker drift) is mitigated
by the byte-identical marker string, verified against the `ingest.test.ts` `SKETCH_LEVEL_MARKER`
constant.

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/ingest/scaffold.md
- FOUND: src/cli/slash-command/bs/ingest/sketch-derivation.md
- FOUND commit 7f4dcfc3 (Task 1)
- FOUND commit cca59d6b (Task 2)
