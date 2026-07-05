---
phase: 146-bs-build-chunk-playtest-revise-close-final-acceptance
plan: 04
subsystem: bs-build-chunk skill (orchestrator router)
tags: [bs-skills, build-chunk, forward-reference-retirement, citation-discipline]
dependency-graph:
  requires:
    - src/cli/slash-command/bs/build/playtest.md (146-01/02)
    - src/cli/slash-command/bs/build/revise.md (146-01/02)
    - src/cli/slash-command/bs/build/close.md (146-03)
    - src/cli/slash-command/bs/build/final-acceptance.md (146-03)
    - src/cli/slash-command/bs/state-machine.md (Phase 141)
  provides:
    - "build-chunk.md is a fully live 10-step engine (zero forward-reference markers)"
  affects:
    - src/cli/slash-command/bs/build-chunk.test.ts (inverted marker assertions now green)
tech-stack:
  added: []
  patterns:
    - "citation-not-restatement (cite state-machine.md by section name, never restate the rule text)"
    - "Reference Files list: one bulleted entry per reference file, one-line description"
key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/build-chunk.md
decisions:
  - "Step Groups 2-3 dispatch prose lives in build/build.md, test.md, audit.md, repair.md themselves (each already carries its own 'Referenced by build-chunk.md Step N' framing) rather than being restated in build-chunk.md — only Group 4 needed a live dispatch section authored here, since groups 2-3 never had inline dispatch prose to retire (they were already citation-only, unlike Group 1)."
  - "final-acceptance.md folded into the main Reference Files bulleted list (not a dispatch-table row) since it is dispatched in place of a normal chunk's {playtest, revise, close} group only for the sketch's mandated final-acceptance chunk, matching design-review.md's precedent of being a Reference-Files-only entry."
metrics:
  duration_minutes: 20
  completed: 2026-07-05
---

# Phase 146 Plan 04: Playtest/Revise/Close/Final-Acceptance — Marker Retirement & Skill Completion Summary

Retired all 7 remaining "authored in Phase 146" forward-reference markers in `build-chunk.md`,
registered `build/playtest.md`, `build/revise.md`, `build/close.md`, and
`build/final-acceptance.md` in the Reference Files list, authored a live "Step Group 4 Dispatch"
section (retiring the old "Step Groups 2-4 (forward reference)" stub), and confirmed the
BUILD-13 citation-not-restatement discipline was already correctly applied to the Git Protocol,
Session Handoff Seams, and Step 0 Session Lock sections. This is the closing plan of the
`/bs-build-chunk` skill (Phases 143-146): the 10-step engine — investigate, redteam, ask, build,
test, audit, repair, playtest, revise, close — is now fully live end to end with no pending
authoring markers.

## What Was Built

### Task 1 — Retire all 7 markers, register the 4 files, reconcile Step Group 4 dispatch prose

Edited `src/cli/slash-command/bs/build-chunk.md`:

1. **Dispatch table rows (playtest/revise/close):** dropped the ` — authored in Phase 146` suffix
   so all 10 rows now share the same marker-less shape.
2. **Explanatory paragraph:** replaced the "Steps 8-10 are named here as forward references
   only... When Phase 146 lands..." framing with a plain statement that all 10 steps now have
   live dispatch targets, naming each of the 10 reference files.
3. **Light-path note:** dropped `, authored in Phase 146` and added an explicit citation to
   `build/close.md`'s `## Bookkeeping Sequence` by name, resolving the "playtest performs close's
   bookkeeping for light chunks" promise to a real named section (per 146-PATTERNS.md's Pitfall 2
   reconciliation).
4. **Reference Files list:** deleted the "And, forward-referenced only (not yet authored):"
   sub-list header and its three markered lines; folded `build/playtest.md`, `build/revise.md`,
   `build/close.md`, and `build/final-acceptance.md` into the main bulleted list, each with a
   one-line description matching the style of the existing `build/repair.md` entry.
5. **Step Groups 2-4 section:** retired the `## Step Groups 2–4 (forward reference)` stub and
   replaced it with two sections:
   - `## Step Groups 2–3 (dispatch prose lives in their own reference files)` — explicitly states
     that group 2 (`{build, test}`) and group 3 (`{audit, repair}`) dispatch prose is authored
     inside `build/build.md`, `build/test.md`, `build/audit.md`, and `build/repair.md` themselves,
     not restated in the router.
   - `## Step Group 4 Dispatch — {playtest, one revise round, close}` — a fully live section in
     Step Group 1's shape: per-step persistence discipline, per-step dispatch delegation
     (playtest → revise-if-needed → close), and the end-of-group "print the exact next command +
     confirm the game folder is saved" close.

Verification: `! grep -q "authored in Phase" build-chunk.md` succeeds — zero occurrences.

### Task 2 — Verify BUILD-13 citation discipline and assert the full suite green

Reviewed the Git Protocol section, Session Handoff Seams section, and Step 0 Session Lock section
against `state-machine.md`'s canonical sections. All three were already correctly citation-shaped
from prior phases (143-145):

- **Git Protocol** cites `state-machine.md` "Git Protocol" by name; the `chunk-<slug>/step-<name>`
  format and 24-hour lock staleness numbers appear only as quoted examples adjacent to the
  citation pointer, never as freshly restated rule text.
- **Session Handoff Seams** cites `state-machine.md` "Session Handoff Seams" by name with an
  explicit "do not restate them here."
- **Step 0 Session Lock** implements the three lock outcomes (same-chunk resume, different-live
  warn, stale-confirm-clear) as literal branches, citing `state-machine.md` "Session Lock" for the
  underlying rule rather than re-deriving it.

No changes were needed to these three sections — the BUILD-13 citation discipline was already
clean. No other content was touched, per the task's "make no other content changes" instruction.

**Full suite results:**
- `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` — 100/100 tests passed (the full
  drift suite: BUILD-01..13, UIQ-01..05, cross-file consistency, return-shape blocks).
- `npx vitest run ... -t "BUILD-13"` — 4/4 passed (Git Protocol / Session Lock / Session Handoff
  Seams citation checks).
- `npm test` — 182/182 test files, 2582/2582 tests passed (no sibling drift).

## Deviations from Plan

None — plan executed exactly as written. Task 2's BUILD-13 review found nothing to tighten;
no edits were made beyond Task 1's.

## Skill Completion

This closes the `/bs-build-chunk` skill (spanning Phases 143-146): the router now dispatches all
10 full-ceremony steps and the 3-step light path to fully-authored reference files, with zero
forward-reference markers remaining anywhere in `build-chunk.md`. The skill is ready for
installation (Phase 148: `/bs-generate-ai` rename + `install-claude-command.ts`).

## Self-Check: PASSED

- FOUND: `src/cli/slash-command/bs/build-chunk.md` (modified, verified via grep and vitest)
- FOUND: commit `c33bfea1` (`git log --oneline -1` confirms HEAD)
- Zero "authored in Phase" occurrences confirmed via `grep`
- Full drift suite (100/100) and full repo suite (2582/2582) confirmed green via direct test run
