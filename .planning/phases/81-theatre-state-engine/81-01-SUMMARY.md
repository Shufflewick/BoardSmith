---
phase: 81-theatre-state-engine
plan: 01
subsystem: engine
tags: [theatre-state, mutation-applicators, elementjson, snapshot, animation]

# Dependency graph
requires:
  - phase: 80-mutation-capture
    provides: CapturedMutation types (CREATE, MOVE, SET_ATTRIBUTE, SET_PROPERTY)
provides:
  - Pure mutation applicator functions for ElementJSON snapshots
  - JSON tree helpers (findElementById, removeElementFromParent)
  - applyMutation/applyMutations dispatcher
affects: [81-02 (wire into Game class), 82 (session integration)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-place JSON snapshot mutation via pure functions"
    - "Pile removal pattern: MOVE to non-existent destination removes element"

key-files:
  created:
    - src/engine/element/theatre-state.ts
    - src/engine/element/theatre-state.test.ts
  modified: []

key-decisions:
  - "SET_PROPERTY targets snapshot.attributes (where GameElement.toJSON() puts custom properties)"
  - "MOVE to non-existent destination is treated as removal (pile pattern per research)"

patterns-established:
  - "Mutation applicators are pure functions operating on plain JSON, no Game instances"
  - "All applicators are no-ops when target element/parent not found (graceful degradation)"

# Metrics
duration: 2min
completed: 2026-02-07
---

# Phase 81 Plan 01: Theatre State Mutation Applicators Summary

**Pure mutation applicator functions that apply CapturedMutation records to ElementJSON snapshots, with JSON tree helpers and 23 unit tests**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-07T05:36:23Z
- **Completed:** 2026-02-07T05:38:09Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created 8 exported functions: findElementById, removeElementFromParent, applyMoveMutation, applyCreateMutation, applySetAttributeMutation, applySetPropertyMutation, applyMutation, applyMutations
- All 4 mutation types correctly applied to ElementJSON snapshots in place
- Pile removal pattern: MOVE to non-existent destination removes element entirely from snapshot
- 23 unit tests covering all functions, all mutation types, and edge cases (no-op when not found)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create theatre-state.ts with mutation application functions** - `6e91596` (feat)
2. **Task 2: Write unit tests for mutation applicators** - `aaef580` (test)

## Files Created/Modified
- `src/engine/element/theatre-state.ts` - Pure mutation applicator functions and JSON tree helpers
- `src/engine/element/theatre-state.test.ts` - 23 unit tests for all applicators and edge cases

## Decisions Made
- SET_PROPERTY targets `snapshot.attributes` where GameElement.toJSON() serializes custom game properties (not top-level fields like phase/messages/settings)
- MOVE to non-existent destination treated as removal per research recommendations (pile is not in serialized tree)
- All applicators silently no-op when target element/parent not found (graceful degradation, no throws)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- theatre-state.ts provides all mutation applicators needed by Plan 02
- Plan 02 will wire these functions into Game class (lazy init in animate(), advancement in acknowledgeAnimationEvents(), serialization, theatreState getter)
- No blockers or concerns

---
*Phase: 81-theatre-state-engine*
*Completed: 2026-02-07*
