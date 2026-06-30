---
phase: 14-condition-api-refactor
plan: 01
subsystem: action
tags: [conditions, types, typescript, api-design]

# Dependency graph
requires:
  - phase: 13-player-access-docs
    provides: Player as GameElement, documented access patterns
provides:
  - ConditionPredicate type alias for condition functions
  - ObjectCondition type for labeled conditions
  - ConditionConfig union type for both formats
  - Action.condition() accepting both formats
affects: [14-02, 15-game-migrations, 16-docs-migration-guide]

# Tech tracking
tech-stack:
  added: []
  patterns: [object-based-conditions, labeled-predicates]

key-files:
  created: []
  modified:
    - packages/engine/src/action/types.ts
    - packages/engine/src/action/action-builder.ts
    - packages/engine/src/action/action.ts

key-decisions:
  - "Object conditions use Record<string, predicate> - keys are labels, values are predicates"
  - "Added evaluateCondition helper for backward compatibility during transition"

patterns-established:
  - "Object format: { 'label': (ctx) => boolean } for auto-traced conditions"

issues-created: []

# Metrics
duration: 8 min
completed: 2026-01-10
---

# Phase 14 Plan 01: Condition API Types Summary

**Added ConditionPredicate, ObjectCondition, and ConditionConfig types; Action.condition() now accepts both function and object formats with full JSDoc documentation**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-10T12:00:00Z
- **Completed:** 2026-01-10T12:08:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added three new condition types to types.ts (ConditionPredicate, ObjectCondition, ConditionConfig)
- Updated ActionDefinition.condition to accept the new ConditionConfig union type
- Updated Action.condition() builder method with comprehensive JSDoc and examples
- Added evaluateCondition() helper in action.ts for backward compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Add object-based condition types** - `74ff2fd` (feat)
2. **Task 2: Update Action.condition() to support both formats** - `2d69131` (feat)

## Files Created/Modified

- `packages/engine/src/action/types.ts` - Added ConditionPredicate, ObjectCondition, ConditionConfig types; updated ActionDefinition.condition
- `packages/engine/src/action/action-builder.ts` - Updated condition() method signature and JSDoc
- `packages/engine/src/action/action.ts` - Added evaluateCondition helper for backward compatibility

## Decisions Made

- Used `Record<string, ConditionPredicate>` for ObjectCondition where keys are human-readable labels
- Added evaluateCondition() helper to ActionExecutor to handle both formats during transition (Plan 02 will expand this with auto-tracing)
- Removed ConditionTracer import from types.ts (tracer will be removed entirely in Plan 02)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added evaluateCondition helper to action.ts**
- **Found during:** Task 1 (type changes caused ActionExecutor build failure)
- **Issue:** ActionExecutor called condition as function directly, but ConditionConfig can now be an object
- **Fix:** Added evaluateCondition() helper that handles both formats, updated all call sites
- **Files modified:** packages/engine/src/action/action.ts
- **Verification:** Build passes with full type checking
- **Committed in:** 74ff2fd (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (blocking issue)
**Impact on plan:** Required minimal ActionExecutor change to maintain build during transition. Plan 02 will expand this helper with auto-tracing support.

## Issues Encountered

None - plan executed with one blocking fix required.

## Next Step

Ready for 14-02-PLAN.md (ActionExecutor auto-tracing + ConditionTracer removal)

---
*Phase: 14-condition-api-refactor*
*Completed: 2026-01-10*
