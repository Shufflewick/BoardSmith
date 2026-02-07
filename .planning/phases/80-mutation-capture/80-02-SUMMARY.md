---
phase: 80-mutation-capture
plan: 02
subsystem: engine
tags: [animation, mutation-capture, element-interception, theatre-view, putInto, create, snapshot-diff]

# Dependency graph
requires:
  - "80-01: CapturedMutation types, Game.animate() method, property snapshot/diff"
provides:
  - "putInto() MOVE mutation capture inside animate() callbacks"
  - "create() CREATE mutation capture inside animate() callbacks"
  - "Element attribute snapshot/diff for SET_ATTRIBUTE mutation detection"
  - "Complete mutation capture system (all 4 mutation types: CREATE, MOVE, SET_ATTRIBUTE, SET_PROPERTY)"
affects: [81-theatre-state, 82-session-integration, 84-clean-break]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Element-level capture context check: operations check game._captureContext before recording"
    - "Element attribute snapshot/diff: structuredClone before, JSON.stringify comparison after, excludes Game root"
    - "Single capture point for remove(): delegates to putInto() so exactly one MOVE mutation recorded"

key-files:
  created: []
  modified:
    - "src/engine/element/piece.ts"
    - "src/engine/element/game-element.ts"
    - "src/engine/element/game.ts"
    - "src/engine/element/mutation-capture.test.ts"

key-decisions:
  - "Game root excluded from element attribute snapshot (its properties tracked via _snapshotCustomProperties)"
  - "remove() not modified -- delegates to putInto() which captures the MOVE, avoiding duplicate mutations"
  - "Created elements not diffed for SET_ATTRIBUTE -- they weren't in the before snapshot, tracked via CREATE instead"

patterns-established:
  - "Element operations check this.game._captureContext to decide whether to record mutations"
  - "Attribute snapshot walks children only, not the Game root, to avoid double-counting with property diff"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 80 Plan 02: Element Mutation Interception and Integration Tests Summary

**Element-level mutation interception for putInto/create/remove/attributes inside animate() callbacks, completing all 4 mutation types with 18 integration tests**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T05:08:56Z
- **Completed:** 2026-02-07T05:12:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added MOVE mutation capture to putInto() -- records elementId, fromParentId, toParentId, position when inside animate()
- Added CREATE mutation capture to create() -- records className, name, parentId, elementId, and serializable attributes
- Added element attribute snapshot/diff to animate() -- detects SET_ATTRIBUTE changes on any element in the tree
- remove() produces exactly one MOVE mutation (delegates to putInto, no double-recording)
- 18 new integration tests covering all 4 mutation types, edge cases, and mixed scenarios
- All 574 tests pass across 22 test files (zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add mutation interception to putInto(), create(), and element attribute snapshot** - `f48ee02` (feat)
2. **Task 2: Write integration tests for element mutation capture** - `d8256e4` (test)

## Files Created/Modified
- `src/engine/element/piece.ts` - putInto() records MOVE mutation when _captureContext active
- `src/engine/element/game-element.ts` - create() records CREATE mutation with serializable attributes
- `src/engine/element/game.ts` - _snapshotElementAttributes(), _diffElementAttributes(), updated animate() method
- `src/engine/element/mutation-capture.test.ts` - 18 new integration tests (39 total in file)

## Decisions Made
- Excluded Game root from element attribute snapshot to avoid double-counting with the property snapshot/diff (game properties tracked by _snapshotCustomProperties, element attributes by _snapshotElementAttributes)
- Did not modify remove() -- it delegates to putInto() which captures the MOVE, ensuring exactly one mutation per removal
- Created elements are excluded from SET_ATTRIBUTE diff since they weren't in the before snapshot; their initial state is tracked via the CREATE mutation's attributes field

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed double-counting of Game properties as element attributes**
- **Found during:** Task 1 (element attribute snapshot implementation)
- **Issue:** _snapshotElementAttributes walked the entire tree including the Game root, causing game-level custom properties (score, round, status) to be detected both as SET_PROPERTY mutations (from _snapshotCustomProperties) and SET_ATTRIBUTE mutations (from _snapshotElementAttributes), doubling mutation counts
- **Fix:** Changed _snapshotElementAttributes to walk only children of the Game root, not the root itself
- **Files modified:** src/engine/element/game.ts
- **Verification:** All 21 Plan 01 tests pass without modification
- **Committed in:** f48ee02 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed TypeScript cast error for element attribute access**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** Casting `element as Record<string, unknown>` failed because GameElement doesn't have an index signature; TypeScript requires intermediate `unknown` cast
- **Fix:** Changed to `element as unknown as Record<string, unknown>`
- **Files modified:** src/engine/element/game.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** f48ee02 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 80 complete: all 4 mutation types captured (CREATE, MOVE, SET_ATTRIBUTE, SET_PROPERTY)
- game.animate() API is fully functional with scoped callback, nested call prevention, and error cleanup
- All Phase 80 success criteria met and verified by tests
- Ready for Phase 81 (Theatre State Engine) to consume mutation data for per-event state advancement

---
*Phase: 80-mutation-capture*
*Completed: 2026-02-07*
