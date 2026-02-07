---
phase: 85-theatre-erasure
plan: 01
subsystem: engine
tags: [theatre, mutation-capture, animation-events, cleanup]

# Dependency graph
requires: []
provides:
  - "Engine layer stripped of all theatre/mutation-capture code"
  - "Clean export chains for downstream modules to reference"
  - "Animation event buffer infrastructure preserved without mutation fields"
affects: [85-02, 85-03, 85-04, 86]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - "src/engine/element/game.ts"
    - "src/engine/element/game-element.ts"
    - "src/engine/element/piece.ts"
    - "src/engine/element/index.ts"
    - "src/engine/index.ts"

key-decisions:
  - "acknowledgeAnimationEvents() simplified to pure buffer clearing (no mutation application)"
  - "AnimationEvent interface kept without mutations field"

patterns-established: []

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 85 Plan 01: Engine Core Erasure Summary

**Deleted theatre-state.ts, mutation-capture.ts, and 3 test files; stripped Game class of all theatre/mutation capture machinery while preserving animation event buffer**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T23:51:58Z
- **Completed:** 2026-02-07T23:55:46Z
- **Tasks:** 2
- **Files modified:** 5 modified, 5 deleted

## Accomplishments
- Deleted theatre-state.ts (159 lines) and mutation-capture.ts (79 lines)
- Stripped Game class of all theatre properties, methods, and imports (~450 lines removed)
- Removed _captureContext hooks from game-element.ts create() and piece.ts putInto()
- Cleaned export chains in element/index.ts and engine/index.ts
- Deleted 3 test files totaling ~1825 lines (theatre-state, mutation-capture, animation-events)
- Preserved animation event buffer infrastructure (_animationEvents, pendingAnimationEvents, acknowledgeAnimationEvents)

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete theatre files and strip Game class** - `d804062` (feat)
2. **Task 2: Clean export chains and delete engine tests** - `91c6ee1` (feat)

## Files Created/Modified
- `src/engine/element/theatre-state.ts` - DELETED (mutation applicators and JSON tree helpers)
- `src/engine/element/mutation-capture.ts` - DELETED (CapturedMutation types, MutationCaptureContext)
- `src/engine/element/theatre-state.test.ts` - DELETED (1057 lines of theatre state tests)
- `src/engine/element/mutation-capture.test.ts` - DELETED (569 lines of mutation capture tests)
- `src/engine/element/animation-events.test.ts` - DELETED (199 lines of animation tests using removed animate())
- `src/engine/element/game.ts` - Stripped animate(), theatreState, theatreStateForPlayer, snapshot/diff methods, capture context
- `src/engine/element/game-element.ts` - Removed _captureContext block from create()
- `src/engine/element/piece.ts` - Removed _captureContext block from putInto()
- `src/engine/element/index.ts` - Removed mutation-capture and theatre-state re-exports
- `src/engine/index.ts` - Removed CapturedMutation types and applyMutation function re-exports

## Decisions Made
- acknowledgeAnimationEvents() simplified to pure buffer clearing only (no theatre snapshot mutation application, no null reset) -- this matches the v3.0 design where playback is 100% client-owned
- AnimationEvent interface preserved without mutations field -- Phase 86 will rebuild the animate() API as a pure data emitter

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Engine layer is fully clean of theatre code (zero grep matches)
- Engine compiles with zero engine-specific TypeScript errors
- Downstream modules (session, server, client, UI) will have compile errors from removed APIs -- these are expected and will be fixed in plans 85-02 and 85-03
- Ready for 85-02-PLAN.md (session + server erasure)

---
*Phase: 85-theatre-erasure*
*Completed: 2026-02-07*
