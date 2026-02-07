---
phase: 84-clean-break-and-migration
plan: 01
subsystem: engine
tags: [animation, api-removal, migration, theatre-view]

# Dependency graph
requires:
  - phase: 83-ui-composables
    provides: "UI composables using game.animate() (new API already adopted in UI layer)"
  - phase: 80-animation-events
    provides: "emitAnimationEvent and animate() coexisting on Game class"
provides:
  - "game.animate() as sole animation API (emitAnimationEvent removed)"
  - "Clean exports without EmitAnimationEventOptions"
  - "All library tests using animate() exclusively"
  - "Optional group parameter on animate() for batched event playback"
affects:
  - 84-02 (game migration -- games can now only use animate())
  - 84-03 (final verification)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "animate() with optional 4th options parameter for group batching"

key-files:
  created: []
  modified:
    - "src/engine/element/game.ts"
    - "src/engine/element/index.ts"
    - "src/engine/index.ts"
    - "src/ui/index.ts"
    - "src/engine/element/animation-events.test.ts"
    - "src/engine/element/mutation-capture.test.ts"
    - "src/engine/element/theatre-state.test.ts"
    - "src/session/animation-events.test.ts"

key-decisions:
  - "Added optional group parameter to animate() -- group batching was only available via deleted emitAnimationEvent, so animate() needed it to preserve functionality"
  - "Deleted emitAnimationEvent compatibility test block entirely rather than rewriting (tests for API interleaving are no longer relevant)"

patterns-established:
  - "game.animate(type, data, callback, options?) is the sole animation API"

# Metrics
duration: 4min
completed: 2026-02-07
---

# Phase 84 Plan 01: Clean Break Summary

**Removed emitAnimationEvent() and EmitAnimationEventOptions entirely, migrated all 4 library test files to game.animate() exclusively with group option support**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-07T17:10:31Z
- **Completed:** 2026-02-07T17:14:40Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Deleted emitAnimationEvent() method, its JSDoc, and EmitAnimationEventOptions interface from Game class
- Cleaned all barrel exports (element/index.ts, engine/index.ts, ui/index.ts) -- zero EmitAnimationEventOptions references remain
- Migrated 4 test files (119 tests across animation-events, mutation-capture, theatre-state, session/animation-events) to use animate() exclusively
- Added optional `{ group }` 4th parameter to animate() to preserve group batching functionality
- Full test suite passes (633 tests, 24 files)

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove emitAnimationEvent API and clean exports** - `046717c` (feat)
2. **Task 2: Migrate all library tests to game.animate()** - `0fd1314` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `src/engine/element/game.ts` - Deleted emitAnimationEvent method, EmitAnimationEventOptions interface, added group option to animate()
- `src/engine/element/index.ts` - Removed EmitAnimationEventOptions from type exports
- `src/engine/index.ts` - Removed EmitAnimationEventOptions from re-exports
- `src/ui/index.ts` - Removed EmitAnimationEventOptions from re-exports
- `src/engine/element/animation-events.test.ts` - Rewrote all tests to use game.animate()
- `src/engine/element/mutation-capture.test.ts` - Deleted compatibility block, converted remaining refs
- `src/engine/element/theatre-state.test.ts` - Converted emitAnimationEvent to animate() with empty callback
- `src/session/animation-events.test.ts` - Converted TestGame actions and direct test calls

## Decisions Made
- **Added group option to animate():** The `group` field on AnimationEvent was only settable via the now-deleted EmitAnimationEventOptions. Rather than removing group batching entirely, added an optional 4th `options` parameter `{ group?: string }` to animate(). This preserves the functionality for games that batch related events.
- **Deleted interleaving tests:** Tests verifying that emitAnimationEvent and animate() shared the same ID counter were deleted rather than rewritten, since they tested cross-API interleaving that no longer exists.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added group option to animate() method**
- **Found during:** Task 2 (test migration)
- **Issue:** Tests for group batching (`{ group: 'turn-1' }`) couldn't compile because animate() had no group parameter -- group was only available via the deleted EmitAnimationEventOptions
- **Fix:** Added optional 4th parameter `options?: { group?: string }` to animate() and spread it into the event object
- **Files modified:** src/engine/element/game.ts
- **Verification:** Group test passes, tsc --noEmit clean
- **Committed in:** 0fd1314 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to preserve group batching functionality that existed in the deleted API. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Library source has zero references to emitAnimationEvent or EmitAnimationEventOptions
- TypeScript will now produce compile errors for any game code still using the old API
- Ready for 84-02 (game migration) -- tsc --noEmit on game repos will identify all call sites

---
*Phase: 84-clean-break-and-migration*
*Completed: 2026-02-07*
