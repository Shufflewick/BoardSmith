---
phase: 143-bs-build-chunk-interpretation-ask-gate
plan: 01
subsystem: testing
tags: [vitest, markdown-drift-test, bs-skills, structural-pin]

# Dependency graph
requires:
  - phase: 141-file-templates-state-machine-authority
    provides: state-machine.md (status enum, step names, session groups, lock protocol), CHUNK.template.md
  - phase: 142-bs-ingest-rules
    provides: ingest.test.ts pattern this suite mirrors verbatim
provides:
  - src/cli/slash-command/bs/build-chunk.test.ts — the executable interface contract for build-chunk.md + build/{investigate,redteam,ask}.md
  - Fixed return-shape field-name contract (INVESTIGATE_RETURN_FIELDS, REDTEAM_REFUTER_FIELDS, REDTEAM_COVERAGE_FIELDS)
affects: [143-02, 143-03, 143-04, 143-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structural drift-protection test (byte-identical constant pins across markdown files, verified via vitest, no runtime parsing)"

key-files:
  created:
    - src/cli/slash-command/bs/build-chunk.test.ts
  modified: []

key-decisions:
  - "Return-shape field names fixed here (Claude's discretion, locked for Plans 02-05): INVESTIGATE_RETURN_FIELDS = ['claimsList', 'visibilityDeclaration', 'newlyDiscoveredCitations']; REDTEAM_REFUTER_FIELDS = ['claimNumber', 'verdict', 'objection']; REDTEAM_COVERAGE_FIELDS = ['missingInteractions', 'ruleDescription', 'citation']"
  - "REFERENCED_PATHS scoped to current-phase files only (build/investigate.md, build/redteam.md, build/ask.md, state-machine.md, templates/{CHUNK,RULINGS,ASSETS}.template.md) — Phase 144-146 step files are asserted only via forward-reference marker strings ('authored in Phase 144/145/146'), never file-existence checks"
  - "BUILD-05..11 are entirely out of scope for this test file — no describe blocks, no forward-looking assertions beyond the marker-string check"

patterns-established:
  - "Per-requirement describe blocks (BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-12), each read() call inside its it() body so a missing markdown file fails only that assertion"
  - "Byte-identical constant pins: FULL_CEREMONY_STEPS, LIGHT_PATH_STEPS, STALE_MARKER (em-dash), STATUS_ENUM_VALUES quoted verbatim from state-machine.md"

requirements-completed: [BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-12]

# Metrics
duration: 12min
completed: 2026-07-04
---

# Phase 143 Plan 01: Scaffold build-chunk.test.ts Summary

**342-line structural drift-protection suite for `/bs-build-chunk` (BUILD-01/02/03/04/12), pinning byte-identical strings from state-machine.md and fixing the investigate/redteam return-shape field-name contract — RED as designed, pending Plans 02-05.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-04T20:57:00Z
- **Completed:** 2026-07-04T21:09:01Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Authored `src/cli/slash-command/bs/build-chunk.test.ts`, mirroring `ingest.test.ts`'s technique verbatim (same `__dirname`/`read()` helper, same per-`it()` read placement, same byte-identical-marker-constant pattern)
- Fixed the return-shape field-name contract (`INVESTIGATE_RETURN_FIELDS`, `REDTEAM_REFUTER_FIELDS`, `REDTEAM_COVERAGE_FIELDS`) that Plans 02-05 must implement verbatim
- Pinned `FULL_CEREMONY_STEPS`, `LIGHT_PATH_STEPS`, `STALE_MARKER` (em-dash), and `STATUS_ENUM_VALUES` byte-identically from `state-machine.md`
- Scoped `REFERENCED_PATHS` to current-phase files only, with a separate forward-reference-marker assertion (no premature existence checks) for Phase 144-146 step files
- Confirmed the suite collects and runs cleanly (no syntax/collection error) and fails RED for the correct reason (missing markdown files), 6/38 tests passing (the tests that only assert internal-constant properties, not file reads)

## Task Commits

1. **Task 1: Scaffold build-chunk.test.ts — full structural drift suite (RED)** - `9ad211d0` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/cli/slash-command/bs/build-chunk.test.ts` - Structural drift suite: 5 per-requirement describe blocks (BUILD-01/02/03/04/12), cross-file consistency checks (status enum, stale marker, forward-reference markers, return-shape field pins, REFERENCED_PATHS existence)

## Decisions Made
- Return-shape field names locked as documented in frontmatter `key-decisions` — Plans 02-05 must use these exact names
- `REFERENCED_PATHS` deliberately excludes `build/{build,test,audit,repair,playtest,revise,close}.md`; a dedicated test explicitly asserts these paths are NOT in the array, guarding against premature existence-checking as those phases land

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 02-05 now have a concrete, executable "done" definition. `build-chunk.md` must be authored first (Plan 02, most likely) followed by `build/investigate.md`, `build/redteam.md`, `build/ask.md` — each landing turns more of this suite's 32 currently-RED assertions GREEN. No blockers.

---
*Phase: 143-bs-build-chunk-interpretation-ask-gate*
*Completed: 2026-07-04*

## Self-Check: PASSED
