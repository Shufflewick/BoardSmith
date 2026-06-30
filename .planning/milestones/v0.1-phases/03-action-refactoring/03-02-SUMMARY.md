---
phase: 03-action-refactoring
plan: 02
subsystem: engine
tags: [refactoring, action, action-builder, fluent-api]

# Dependency graph
requires:
  - phase: 03-01
    provides: ConditionTracer and dev utilities extracted
provides:
  - Action builder class in dedicated module
  - wrapFilterWithHelpfulErrors in helpers.ts
affects: [03-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [builder-pattern-isolation, shared-utility-consolidation]

key-files:
  created: [packages/engine/src/action/action-builder.ts]
  modified: [packages/engine/src/action/action.ts, packages/engine/src/action/helpers.ts, packages/engine/src/action/index.ts]

key-decisions:
  - "Move wrapFilterWithHelpfulErrors to helpers.ts (used by both Action and ActionExecutor)"
  - "Export Action from action-builder.js directly in index.ts"

patterns-established:
  - "Builder classes in dedicated modules"
  - "Shared error-wrapping utilities in helpers.ts"

issues-created: []

# Metrics
duration: 10min
completed: 2026-01-08
---

# Phase 3 Plan 02: Extract Action Builder Class Summary

**Action builder class extracted to action-builder.ts, wrapFilterWithHelpfulErrors moved to helpers.ts, action.ts reduced by 398 lines to 1,361 lines**

## Performance

- **Duration:** 10 min
- **Started:** 2026-01-08T21:49:17Z
- **Completed:** 2026-01-08T21:59:31Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Extracted Action fluent builder class to dedicated `action-builder.ts` module (363 lines)
- Moved wrapFilterWithHelpfulErrors to helpers.ts (shared by Action and ActionExecutor)
- Reduced action.ts from 1,759 to 1,361 lines (398 line reduction, exceeded 340 target)
- All 197 engine tests pass with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract Action builder class** - `4915016` (refactor)
2. **Task 2: Move wrapFilterWithHelpfulErrors to helpers** - `90d9f7d` (refactor)
3. **Task 3: Run full test suite** - No commit (verification only, no changes needed)

**Plan metadata:** Pending (this commit)

## Files Created/Modified

- `packages/engine/src/action/action-builder.ts` - New file containing Action fluent builder class (363 lines)
- `packages/engine/src/action/action.ts` - Removed Action class, now contains only ActionExecutor and related code
- `packages/engine/src/action/helpers.ts` - Added wrapFilterWithHelpfulErrors (+53 lines)
- `packages/engine/src/action/index.ts` - Updated export to reference action-builder.js

## Decisions Made

- Moved wrapFilterWithHelpfulErrors to helpers.ts rather than keeping in action-builder.ts (better location since both Action.chooseElement and ActionExecutor.getChoices need it)
- devWarn import already in helpers.ts, so wrapFilterWithHelpfulErrors fits naturally there

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- action.ts now at 1,361 lines containing only ActionExecutor
- Clean separation of builder API (action-builder.ts) from executor (action.ts)
- Ready for 03-03: verify and document final structure

---
*Phase: 03-action-refactoring*
*Completed: 2026-01-08*
