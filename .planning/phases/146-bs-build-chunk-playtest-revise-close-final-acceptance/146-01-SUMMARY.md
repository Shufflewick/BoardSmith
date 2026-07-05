---
phase: 146
plan: 01
subsystem: bs-skills-drift-tests
tags: [bs-build-chunk, drift-test, wave-0, tdd-scaffold]
requires: []
provides:
  - BUILD-09/10/11/13 + UIQ-05 structural drift contract in build-chunk.test.ts
  - REFERENCED_PATHS extended with the four Phase 146 step files
  - Inverted forward-reference-marker assertions (now demand absence, not presence)
affects:
  - src/cli/slash-command/bs/build-chunk.test.ts
tech-stack:
  added: []
  patterns:
    - "Wave-0-first RED scaffold (143-01 precedent): drift assertions land before content, turn GREEN plan-by-plan"
    - "Proximity-based citation assertion (assertCitedNearby): scans every occurrence of a section name and checks 'cite `state-machine.md`' within 250 chars either direction, rather than a single fixed-offset slice"
key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/build-chunk.test.ts
decisions:
  - "assertCitedNearby scans ALL occurrences of an anchor phrase (not just the first) and checks both directions for the cite phrase, since a section name legitimately appears twice (once as a '## Heading', once inside the citing sentence) — a single-direction/first-occurrence check produced false negatives against already-correct citations (Git Protocol, Session Handoff Seams)"
  - "Header doc-comment update (announcing the BUILD-09/10/11/13 + UIQ-05 Wave-0 additions) grouped with the constant/describe-block changes rather than split further — it documents the whole extension, not one task"
metrics:
  duration_minutes: 35
  completed: 2026-07-05
---

# Phase 146 Plan 01: Extend build-chunk.test.ts drift suite Summary

Added the RED Wave-0 drift-test scaffold for `/bs-build-chunk`'s final step group (playtest,
revise, close, git-protocol citation, final-acceptance) so Plans 02-04 author content against a
fixed, already-pinned contract — mirroring the 143-01 precedent.

## What Was Built

**Task 1** (commit `b512325a`): Added four new `describe` blocks —
`BUILD-09 — playtest`, `BUILD-10 — revise`, `BUILD-11 — close`, `UIQ-05 — final-acceptance` —
each reading its target file (`build/playtest.md`, `build/revise.md`, `build/close.md`,
`build/final-acceptance.md`) inside individual `it()` bodies per the established convention.
Extended `REFERENCED_PATHS` with all four new paths.

**Task 2** (commit `e533f8e8`): Added `describe('BUILD-13 — git protocol / handoff / lock
citation, no restatement', ...)` asserting `build-chunk.md` cites (never restates)
`state-machine.md`'s "Git Protocol", "Session Lock", and "Session Handoff Seams" sections, plus
the `chunk-<slug>/step-<name>` commit-convention example. Inverted the two existing
forward-reference-marker assertions:
- `carries ZERO "authored in Phase 146" forward-reference markers (skill complete)` — now asserts
  ABSENCE via `.not.toContain(marker)`.
- `REFERENCED_PATHS now includes the four Phase 146 step files` — now asserts INCLUSION.

Retitled the stale "Steps 4-10 forward-reference stubs" describe block to
"...now retired (skill complete)".

## Verification

`npx vitest run src/cli/slash-command/bs/build-chunk.test.ts`: 100 tests total, 76 passed, 24
failed. The 24 failures are exactly the intended Wave-0 RED set:
- 4 file-existence checks for the not-yet-authored `build/playtest.md`, `build/revise.md`,
  `build/close.md`, `build/final-acceptance.md`
- 18 content assertions inside the new BUILD-09/10/11/UIQ-05 describe blocks (against those same
  not-yet-existing files)
- 1 marker-absence assertion (`build-chunk.md` still contains "authored in Phase 146" — not yet
  edited; that's Plan 04's job)
- 1 `REFERENCED_PATHS` citation-in-build-chunk.md assertion (fails transitively because
  build-chunk.md doesn't yet cite the four new paths)

BUILD-13's three citation assertions (Git Protocol, Session Lock, Session Handoff Seams) and the
commit-convention assertion all PASS already — `build-chunk.md`'s existing Phase 143-145 content
already correctly cites two of the three sections via "cite `state-machine.md` ..." phrasing; the
proximity-scanning helper (`assertCitedNearby`) confirmed this rather than requiring a rewrite.

`npx tsc --noEmit -p .`: no errors in the modified file.

`npx vitest run src/cli/slash-command/bs/`: sibling suites (`ingest.test.ts`, `templates.test.ts`)
unaffected — 160 passed, 0 regressions; only `build-chunk.test.ts` shows the intended 24 RED.

## Deviations from Plan

None — plan executed as written. Two clarifications made at Claude's discretion (both flagged as
open in RESEARCH.md/CONTEXT.md as "Claude's discretion" areas the plan explicitly delegated):

1. **`assertCitedNearby` proximity-scan design** (not specified by the plan beyond "assert the
   phrase `cite \`state-machine.md\`` appears near each"): implemented as an all-occurrences,
   both-directions scan rather than a single first-occurrence/one-direction check, after the
   naive version produced false-negative failures against `build-chunk.md`'s Git Protocol and
   Session Handoff Seams sections (which are already correctly cited — the heading text and the
   citing sentence both contain the section name, and the citing phrase can precede or follow the
   heading occurrence).
2. **Split commit reconstruction**: the plan's two tasks were originally authored as overlapping
   edits in one pass; reconstructed a clean Task 1 / Task 2 commit boundary by diffing against a
   hand-built intermediate file state so each commit's diff matches its task's described scope.

## Self-Check

- `src/cli/slash-command/bs/build-chunk.test.ts` — FOUND
- Commit `b512325a` — FOUND (`git log --oneline --all | grep b512325a`)
- Commit `e533f8e8` — FOUND (`git log --oneline --all | grep e533f8e8`)

## Self-Check: PASSED
