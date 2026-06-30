---
phase: 80-mutation-capture
plan: 01
subsystem: engine
tags: [animation, mutation-capture, theatre-view, game-api]

# Dependency graph
requires: []
provides:
  - "CapturedMutation union type and all 4 mutation interfaces"
  - "MutationCaptureContext interface"
  - "Game.animate() method with scoped callback capture"
  - "Property snapshot/diff for detecting custom game property changes"
  - "AnimationEvent.mutations optional field (backward compatible)"
affects: [80-02, 81-theatre-state, 82-session-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capture context pattern: nullable context on Game, set during scoped callback, cleared in finally"
    - "Property snapshot/diff: structuredClone before, JSON.stringify comparison after"

key-files:
  created:
    - "src/engine/element/mutation-capture.ts"
    - "src/engine/element/mutation-capture.test.ts"
  modified:
    - "src/engine/element/game.ts"
    - "src/engine/element/index.ts"
    - "src/engine/index.ts"

key-decisions:
  - "mutations field is optional on AnimationEvent (not required) to maintain backward compatibility with emitAnimationEvent()"
  - "Simpler try/finally pattern using local ctx variable that survives past the finally block"
  - "Property diff uses JSON.stringify for deep comparison (game properties are JSON-serializable by design)"

patterns-established:
  - "Capture context pattern: _captureContext is null outside animate(), set during callback"
  - "Element operations check game._captureContext to decide whether to record mutations"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 80 Plan 01: Mutation Capture Types and Game.animate() Summary

**CapturedMutation type system with Game.animate() scoped callback API capturing custom property changes via snapshot/diff**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T05:04:06Z
- **Completed:** 2026-02-07T05:07:04Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created mutation type system with CapturedMutation union (CREATE, MOVE, SET_ATTRIBUTE, SET_PROPERTY) and MutationCaptureContext interface
- Implemented Game.animate() method with synchronous callback execution, nested call prevention, and try/finally cleanup
- Property snapshot/diff via structuredClone + JSON.stringify comparison detects custom game property changes
- AnimationEvent interface extended with optional mutations field (backward compatible with emitAnimationEvent)
- 21 new test cases covering all animate() behaviors, plus all 18 existing tests unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Create mutation capture types and Game.animate() method** - `e2044bf` (feat)
2. **Task 2: Update barrel exports and add animate() unit tests** - `8804070` (test)

## Files Created/Modified
- `src/engine/element/mutation-capture.ts` - CapturedMutation union, 4 mutation interfaces, MutationCaptureContext
- `src/engine/element/mutation-capture.test.ts` - 21 test cases for animate() method
- `src/engine/element/game.ts` - animate(), _snapshotCustomProperties(), _diffCustomProperties(), _captureContext
- `src/engine/element/index.ts` - Re-export mutation capture types
- `src/engine/index.ts` - Re-export mutation capture types from engine barrel

## Decisions Made
- Made mutations optional on AnimationEvent interface (not required) so emitAnimationEvent() needs no modification and all existing code constructing AnimationEvent objects remains valid
- Used the simpler try/finally pattern with a local ctx variable that survives past the finally block, avoiding the complex mutations! assertion pattern
- Property diff uses JSON.stringify for deep comparison since game properties are JSON-serializable by design

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Game.animate() is ready for Plan 02 to add element interception (putInto, create, attribute snapshot/diff)
- _captureContext is public (underscore-prefixed) so element classes in Plan 02 can record mutations
- All types exported from both barrel files for downstream consumption

---
*Phase: 80-mutation-capture*
*Completed: 2026-02-07*
