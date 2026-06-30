---
phase: 81-theatre-state-engine
plan: 02
subsystem: engine
tags: [theatre-state, animation, game-class, snapshot, serialization, acknowledgment]

# Dependency graph
requires:
  - phase: 81-theatre-state-engine-01
    provides: Pure mutation applicator functions (applyMutations, findElementById, etc.)
  - phase: 80-mutation-capture
    provides: CapturedMutation types, game.animate() scoped callback with mutation capture
provides:
  - Game._theatreSnapshot lazy init in animate()
  - Game.acknowledgeAnimationEvents() applies mutations to theatre snapshot
  - Game.theatreState getter for downstream consumers
  - Serialization round-trip (toJSON/restoreGame) for theatre snapshot
  - Barrel exports for theatre-state.ts functions
affects: [82 (session integration uses theatreState getter), 83 (UI composables render from theatreState)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy snapshot initialization (zero overhead for games without animate)"
    - "Theatre state getter returns snapshot or falls through to toJSON()"

key-files:
  created: []
  modified:
    - src/engine/element/game.ts
    - src/engine/element/theatre-state.test.ts
    - src/engine/element/index.ts
    - src/engine/index.ts

key-decisions:
  - "Theatre snapshot lazy-init before first animate() callback, not on Game construction"
  - "Snapshot cleared (null) when all events acknowledged -- zero overhead when in sync"
  - "Theatre snapshot serialized explicitly in toJSON, excluded from unserializableAttributes/generic attribute walk"

patterns-established:
  - "Lazy snapshot: only allocated when animate() is called, cleared when fully acknowledged"
  - "Theatre state getter: returns snapshot if present, falls through to toJSON() if not"

# Metrics
duration: 4min
completed: 2026-02-07
---

# Phase 81 Plan 02: Theatre State Engine Wired into Game Class Summary

**Lazy theatre snapshot in Game.animate(), per-event mutation advancement in acknowledgeAnimationEvents(), theatreState getter, and serialization round-trip with 17 integration tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-07T05:39:42Z
- **Completed:** 2026-02-07T05:44:38Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Game class maintains _theatreSnapshot: lazy-init before first animate() callback, cleared when all events acknowledged
- acknowledgeAnimationEvents() applies captured mutations to theatre snapshot in event-ID order before removing events from buffer
- theatreState getter provides clean API for downstream consumers (session, UI layers)
- toJSON()/restoreGame() round-trip preserves theatre snapshot and pending events
- Barrel exports for theatre-state.ts functions from element/index.ts and engine/index.ts
- 17 integration tests covering all 4 roadmap success criteria

## Task Commits

Each task was committed atomically:

1. **Task 1: Add theatre state lifecycle to Game class** - `f0e8be9` (feat)
2. **Task 2: Write integration tests for theatre state in Game class** - `67cb526` (test)

## Files Created/Modified
- `src/engine/element/game.ts` - _theatreSnapshot field, lazy init in animate(), mutation advancement in acknowledgeAnimationEvents(), theatreState getter, toJSON/restoreGame serialization
- `src/engine/element/theatre-state.test.ts` - 17 integration tests (lifecycle, per-event ack, multiple animate, serialization, edge cases)
- `src/engine/element/index.ts` - Barrel export for applyMutation, applyMutations, findElementById, removeElementFromParent
- `src/engine/index.ts` - Re-export theatre-state functions from element barrel

## Decisions Made
- Theatre snapshot lazy-init in animate() (not on Game construction) -- zero overhead for games that never call animate()
- Snapshot cleared to null when all events acknowledged -- theatreState getter falls through to toJSON() for in-sync state
- _theatreSnapshot added to both _safeProperties (no HMR warnings) and unserializableAttributes (not serialized as generic attribute)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 81 complete: all 3 requirements (ENG-04, ENG-05, ENG-06) implemented and tested
- Game.theatreState getter ready for Phase 82 (session integration: buildPlayerState() default view)
- 40 total tests (23 unit + 17 integration) covering mutation applicators and Game class wiring
- No blockers or concerns

---
*Phase: 81-theatre-state-engine*
*Completed: 2026-02-07*
