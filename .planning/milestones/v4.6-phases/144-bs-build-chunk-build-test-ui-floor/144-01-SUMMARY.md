---
phase: 144-bs-build-chunk-build-test-ui-floor
plan: 01
subsystem: testing
tags: [vitest, drift-pin, bs-skills, structural-test]

# Dependency graph
requires:
  - phase: 143-bs-build-chunk-investigate-redteam-ask
    provides: build-chunk.test.ts scaffolding (read() helper, describe-per-requirement pattern, REFERENCED_PATHS/FORWARD_REFERENCE_MARKERS constants)
provides:
  - Five new RED drift-pin describe blocks (BUILD-05, BUILD-06, UIQ-01, UIQ-02, UIQ-03) in build-chunk.test.ts
  - Updated REFERENCED_PATHS array (adds build/build.md, build/test.md, build/design-ask.md)
  - Updated FORWARD_REFERENCE_MARKERS array (drops 'authored in Phase 144', keeps 145/146)
  - Updated exclusion-list test (no longer excludes build/build.md, build/test.md)
affects: [144-02, 144-03, 144-04]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/build-chunk.test.ts

key-decisions:
  - "Followed 144-PATTERNS.md verbatim for constant-array edits and describe-block shape"

patterns-established:
  - "Wave-0 drift-pin scaffolding: test assertions authored before the markdown they pin exists, RED until downstream plans author the files"

requirements-completed: [BUILD-05, BUILD-06, UIQ-01, UIQ-02, UIQ-03]

# Metrics
duration: 12min
completed: 2026-07-04
---

# Phase 144 Plan 01: Wave-0 Drift-Pin Scaffold for Build/Test/UI-Ask Summary

**Extended `build-chunk.test.ts` with five RED describe blocks (BUILD-05, BUILD-06, UIQ-01, UIQ-02, UIQ-03) and updated constant arrays so downstream markdown plans have a real `-t "<REQ>"` verify command before the prose exists.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-04T22:34:00Z
- **Completed:** 2026-07-04T22:46:00Z
- **Tasks:** 2 completed
- **Files modified:** 1

## Accomplishments
- `REFERENCED_PATHS` now includes `build/build.md`, `build/test.md`, `build/design-ask.md`
- `FORWARD_REFERENCE_MARKERS` now only carries the 145/146 markers (144 marker removed)
- Exclusion-list test no longer treats `build/build.md`/`build/test.md` as excluded (only 145/146 step files remain excluded)
- Five new describe blocks (`BUILD-05`, `BUILD-06`, `UIQ-01`, `UIQ-02`, `UIQ-03`) pin the exact strings Plans 03/04 must author into `build/build.md`, `build/test.md`, `build/design-ask.md`, and the `build/ask.md` pre-check hook
- Suite collects all 58 tests without a collection-phase crash; the 16 new/dependent assertions are RED (expected — files don't exist yet), the pre-existing BUILD-01..04/12 blocks (42 tests) remain green

## Task Commits

Each task was committed atomically:

1. **Task 1: Update the path + marker constant arrays and the exclusion-list test** - `afb4813c` (test)
2. **Task 2: Add BUILD-05, BUILD-06, UIQ-01, UIQ-02, UIQ-03 describe blocks** - `89c38b75` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/cli/slash-command/bs/build-chunk.test.ts` - Extended with 5 new describe blocks + updated constant arrays + updated exclusion-list test

## Decisions Made
None - followed 144-PATTERNS.md's verbatim before/after guidance for the constant arrays, exclusion list, and describe-block shape.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Verified via `npx tsc --noEmit` (0 errors in this file) and `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` (16 new/dependent tests RED as intended, 42 pre-existing tests green, no collection crash). Confirmed `git status --short package.json package-lock.json` shows no diff (no installs performed in this plan).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 02 (scaffold-template axe-core work) and Plans 03/04 (authoring `build/build.md`, `build/test.md`, `build/design-ask.md`, and the `build/ask.md` hook edit) now have exact `npx vitest run ... -t "<REQ>"` verify commands to turn each block GREEN.
- No blockers.

---
*Phase: 144-bs-build-chunk-build-test-ui-floor*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/build-chunk.test.ts
- FOUND: .planning/phases/144-bs-build-chunk-build-test-ui-floor/144-01-SUMMARY.md
- FOUND commit: afb4813c
- FOUND commit: 89c38b75
