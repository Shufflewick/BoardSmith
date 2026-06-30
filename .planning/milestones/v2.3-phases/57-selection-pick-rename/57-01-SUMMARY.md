---
phase: 57-selection-pick-rename
plan: 01
subsystem: api
tags: [types, nomenclature, refactoring, backward-compatibility]

# Dependency graph
requires:
  - phase: 56-position-seat-rename
    provides: seat terminology standardization pattern
provides:
  - Renamed engine types: PickTrace, PickDebugInfo
  - Renamed session types: PickMetadata, PickFilter, PickChoicesResponse, PickStepResult
  - Renamed handler: PickHandler with getPickChoices method
  - Deprecation aliases for all renamed types
affects: [phase-57-02, documentation, public-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Deprecation alias pattern for backward compatibility
    - git mv for preserving file history across renames

key-files:
  created: []
  modified:
    - src/engine/action/types.ts
    - src/engine/action/index.ts
    - src/engine/index.ts
    - src/session/types.ts
    - src/session/pick-handler.ts
    - src/session/pending-action-manager.ts
    - src/session/game-session.ts
    - src/session/index.ts

key-decisions:
  - "Keep selectionName parameter names for API stability"
  - "Deprecation aliases ensure 100% backward compatibility"
  - "git mv preserves full file history for pick-handler.ts"
  - "Internal Selection types unchanged (implementation detail)"

patterns-established:
  - "Pick = choice player must make (action argument)"

# Metrics
duration: 7min
completed: 2026-01-22
---

# Phase 57 Plan 01: Selection-to-Pick Types Rename Summary

**Renamed Selection* types to Pick* terminology with deprecation aliases for 100% backward compatibility**

## Performance

- **Duration:** 7 min
- **Started:** 2026-01-22T18:33:13Z
- **Completed:** 2026-01-22T18:40:13Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Renamed engine types (PickTrace, PickDebugInfo) with deprecation aliases
- Renamed session types (PickMetadata, PickFilter, PickChoicesResponse, PickStepResult)
- Renamed SelectionHandler to PickHandler with getPickChoices method
- Added INVALID_PICK and PICK_NOT_FOUND error codes
- All existing code continues to work via type aliases

## Task Commits

Each task was committed atomically:

1. **Task 1: Rename engine action types** - `4f0011f` (refactor)
2. **Task 2: Rename session types and handler** - `39f38a8` (refactor)
3. **Task 3: Verify downstream consumers** - No commit needed (verification only)

## Files Created/Modified

- `src/engine/action/types.ts` - Renamed PickTrace, PickDebugInfo with deprecation aliases
- `src/engine/action/index.ts` - Updated exports for new and deprecated names
- `src/engine/index.ts` - Updated re-exports
- `src/session/types.ts` - Renamed PickMetadata, PickFilter, PickChoicesResponse with deprecation aliases
- `src/session/pick-handler.ts` - Renamed from selection-handler.ts, class PickHandler with getPickChoices
- `src/session/pending-action-manager.ts` - Renamed PickStepResult with deprecation alias
- `src/session/game-session.ts` - Updated to use PickHandler, added deprecated getSelectionChoices wrapper
- `src/session/index.ts` - Added new exports and deprecation alias exports

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Keep selectionName parameter names | API stability - same pattern as Phase 56's playerPosition |
| Deprecation aliases for all renamed types | 100% backward compatibility with existing code |
| git mv for file rename | Preserves full file history across the rename |
| Internal Selection types unchanged | These are implementation details (SelectionType enum, ChoiceSelection, etc.) |

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Types layer complete with pick terminology
- Ready for Phase 57-02 to update downstream consumers (if choosing to migrate them)
- All tests pass (456/456 in src/, pre-existing failures in packages/games/go-fish unrelated)

---
*Phase: 57-selection-pick-rename*
*Completed: 2026-01-22*
