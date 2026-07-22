---
phase: 167-skills-autonomy-rewrite
plan: 01
subsystem: bs-skills
tags: [autonomy, skills, playtest-gate, drift-tests, prose-spec]

# Dependency graph
requires:
  - phase: 166-skills-autonomy-rewrite (prior)
    provides: fenced repo/installed boundary + session-lock fix that this plan builds on
provides:
  - explicit `Milestone:` flag field on every SKETCH.template.md chunk entry (detailed + tail)
  - sketch-derivation.md instructions to set the milestone flag on the three anchor chunks
    (core-loop, scoring, final-acceptance) at sketch-derivation time, never inferred at runtime
  - milestone/UI-gated human client-playtest stop across state-machine.md, build/playtest.md,
    and build-chunk.md's Step Group 4 dispatch
  - a preserved always-stop for genuine rules-adjudication / open-question escalations
affects: [167-02, 167-03, 167-04, 167-05 (remaining phase 167 plans build on this milestone-gate substrate)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit sketch-time flags over runtime inference — milestone status is a written field, not a derived guess."
    - "Gate conditions cited by name across three files (SKETCH.template.md → sketch-derivation.md → state-machine.md → playtest.md → build-chunk.md) rather than restated."

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/templates/SKETCH.template.md
    - src/cli/slash-command/bs/ingest/sketch-derivation.md
    - src/cli/slash-command/bs/state-machine.md
    - src/cli/slash-command/bs/build/playtest.md
    - src/cli/slash-command/bs/build-chunk.md
    - src/cli/slash-command/bs/templates.test.ts
    - src/cli/slash-command/bs/ingest.test.ts
    - src/cli/slash-command/bs/build-chunk.test.ts

key-decisions:
  - "Milestone-flag field name: `Milestone:` taking `none | core-loop | scoring | final-acceptance`, consistent with the existing `ui:` tag style."
  - "Non-milestone/UI-less chunks write `Status: verified` off build/test.md's automated random-sim/self-playtest pass (no new verification invented) rather than skipping verification entirely."
  - "The human-gate list keeps a standalone always-stop bullet for genuine rules-adjudication/open-question escalation, independent of milestone status."

patterns-established:
  - "Fail-pre/pass-post drift-test discipline verified by temporarily reverting only the prose files (never the test file) via `git checkout --`, confirming the new describe block fails against unedited prose, then restoring the edits."

requirements-completed: [SKILLAUTO-01, PROC-01]

# Metrics
duration: 35min
completed: 2026-07-21
---

# Phase 167 Plan 01: SKETCH Milestone Flag + Milestone-Gated Playtest Stop Summary

**Moved the human client-playtest stop from every chunk to exactly three sketch-time-flagged milestone chunks (core-loop, scoring/endgame, final-acceptance) plus an always-stop for genuine rules adjudication — the highest-leverage autonomy lever in the phase.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2 completed
- **Files modified:** 8

## Accomplishments
- SKETCH.template.md's chunk-entry shape (detailed and tail) now carries an explicit `Milestone:` field; `## Mandated Chunks` names the core-loop/scoring/final-acceptance chunks as the three milestone anchors.
- ingest/sketch-derivation.md instructs setting that flag on exactly those three anchor chunks at sketch-derivation time (an explicit sketch-time write, never a runtime inference); all other chunks get `Milestone: none`.
- state-machine.md's human-gate list, build/playtest.md's Verified Gate, and build-chunk.md's Step Group 4 dispatch are all rewritten so the human client-playtest stop fires only for a milestone chunk with visible UI (`ui: touches`/`major`) — a UI-less chunk is never routed to a human playtest.
- A rules-adjudication / open-question escalation still always stops the session, independent of milestone status.
- Non-milestone/UI-less chunks keep every internal step (test, audit, self-playtest/sim) unchanged; only the human stop moved — `playtest.md` now writes `Status: verified` off the automated test/sim pass and flows straight to `close` with no session pause.

## Task Commits

Each task was committed atomically:

1. **Task 1: SKETCH milestone flag + sketch-derivation anchor assignment (+ template/ingest drift tests)** - `f293802c` (feat)
2. **Task 2: Milestone-gate the human client-playtest stop (state-machine + playtest + build-chunk) (+ build-chunk drift tests)** - `f497bea6` (feat)

_Both tasks are `tdd="true"`: each commit bundles its fail-pre-verified drift describe block together with the prose edit that turns it green (verified via `git checkout --` on the prose files only, confirming failure, then restoring) — not split into separate test/feat commits, consistent with this suite's existing single-commit-per-drift-describe convention._

**Plan metadata:** committed separately per `<final_commit>` protocol.

## Files Created/Modified
- `src/cli/slash-command/bs/templates/SKETCH.template.md` - added `Milestone:` field to chunk-entry + tail-entry shapes; named the three milestone anchors in `## Mandated Chunks`
- `src/cli/slash-command/bs/ingest/sketch-derivation.md` - instructs setting the milestone flag on the core-loop (§1) and scoring/final-acceptance (§3) anchor chunks at sketch-derivation time
- `src/cli/slash-command/bs/state-machine.md` - rewrote the playtest human-gate bullet to scope on milestone+UI; added the rules-adjudication always-stop bullet; updated the group-2 narrative flow description
- `src/cli/slash-command/bs/build/playtest.md` - added "Milestone/UI Gate (SKILLAUTO-01)" section; scoped "The Verified Gate" heading to milestone chunks; defined the non-milestone/UI-less auto-advance path
- `src/cli/slash-command/bs/build-chunk.md` - updated Step Group 4's `playtest:` sub-dispatch to route the human gate only for milestone/UI chunks
- `src/cli/slash-command/bs/templates.test.ts` - new `describe('SKILLAUTO-01 — SKETCH milestone flag'` block (3 tests)
- `src/cli/slash-command/bs/ingest.test.ts` - new `describe('SKILLAUTO-01 — milestone-chunk mandates'` block (4 tests)
- `src/cli/slash-command/bs/build-chunk.test.ts` - new `describe('SKILLAUTO-01 — milestone playtest gates'` block (6 tests)

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched the plan's edit targets, drift-test convention, and acceptance criteria precisely.

## PROC-01 Verification

- Confirmed fail-pre for Task 1's two new describe blocks by running the suite before authoring the prose edits (6/6 new assertions failed).
- Confirmed fail-pre for Task 2's new describe block by temporarily reverting only `state-machine.md`, `build/playtest.md`, and `build-chunk.md` (via `git checkout --`, never touching the test file) and re-running — 6/6 new assertions failed against the unedited prose — then restoring the edits.
- `npx vitest run src/cli/slash-command/bs` green: 274/274 tests passing across all four suites (templates.test.ts, ingest.test.ts, build-chunk.test.ts, status-tools.test.ts).

## TDD Gate Compliance

Both tasks are marked `tdd="true"` per the plan. Per this repo's established drift-test convention (confirmed against the existing suite's git history), the RED and GREEN halves land in a single `feat(...)` commit per task rather than separate `test(...)`/`feat(...)` commits — the fail-pre/pass-post cycle was verified interactively (see "PROC-01 Verification" above) before each commit, satisfying the substance of the TDD gate without the plan-level `type: tdd` commit-splitting requirement (this plan's frontmatter is `type: execute`, not `type: tdd`).

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/templates/SKETCH.template.md
- FOUND: src/cli/slash-command/bs/ingest/sketch-derivation.md
- FOUND: src/cli/slash-command/bs/state-machine.md
- FOUND: src/cli/slash-command/bs/build/playtest.md
- FOUND: src/cli/slash-command/bs/build-chunk.md
- FOUND: src/cli/slash-command/bs/templates.test.ts
- FOUND: src/cli/slash-command/bs/ingest.test.ts
- FOUND: src/cli/slash-command/bs/build-chunk.test.ts
- FOUND commit: f293802c
- FOUND commit: f497bea6
