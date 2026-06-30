---
phase: 117-action-space-introspection
plan: 03
subsystem: engine
tags: [arg-builder, serialization, action-introspection, wire-format, vitest]

# Dependency graph
requires:
  - phase: 117-action-space-introspection
    provides: serializeValue in engine utils, game.getAction public API

provides:
  - "buildActionArgs(actionName, selectionValues, game, seat, options?) — validated in-process and wire arg builder"
  - "BuildActionArgsOptions type exported from engine barrel"

affects:
  - "117-04 (enumerateLegalMoves — uses arg-builder pattern)"
  - "agent/headless callers that submit actions to runner.performAction"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Arg-builder validates selection names against ActionDefinition.selections before producing output"
    - "In-process format returns element objects as-is (runner.performAction handles them directly)"
    - "Wire format delegates to serializeValue(value, game, { useBranchPaths: false }) for { __elementId } refs"

key-files:
  created:
    - src/engine/utils/arg-builder.ts
    - src/engine/utils/arg-builder.test.ts
  modified:
    - src/engine/utils/index.ts
    - src/engine/index.ts

key-decisions:
  - "Default format is 'in-process' (D-02): element objects pass through unchanged, no serialisation overhead"
  - "wire format delegates entirely to serializeValue — no hand-rolled _t.id access"
  - "Validation rejects unknown selection names with an actionable error naming both the action and the bad key"
  - "_seat parameter reserved for future per-seat validation; currently unused in implementation"

patterns-established:
  - "Arg-builder pattern: validate action name → validate selection names → map values per format"

requirements-completed: [INTRO-03]

# Metrics
duration: 8min
completed: 2026-06-30
---

# Phase 117 Plan 03: Arg Builder Summary

**`buildActionArgs` utility with in-process element passthrough (D-02 default) and wire-format `{ __elementId }` serialisation via `serializeValue`, validated against `ActionDefinition.selections`**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-30T16:46:00Z
- **Completed:** 2026-06-30T16:54:00Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments

- New `src/engine/utils/arg-builder.ts` implementing `buildActionArgs` per INTRO-03 design
- Validates action existence and every supplied key against `ActionDefinition.selections` before producing args
- In-process format (default): shallow copy; element objects reach `runner.performAction` unchanged
- Wire format: each value mapped through `serializeValue(value, game, { useBranchPaths: false })` producing JSON-safe `{ __elementId }` / `{ __playerRef }` references
- Exported `buildActionArgs` and `BuildActionArgsOptions` from `src/engine/utils/index.ts` and `src/engine/index.ts`
- 12 tests green; 536 engine tests pass; no new TypeScript errors

## Task Commits

1. **Task 1: RED test (in-process, wire, validation)** - `5986081` (test)
2. **Task 2: Implement buildActionArgs + barrel export** - `ae9474c` (feat)

## Files Created/Modified

- `src/engine/utils/arg-builder.ts` — `buildActionArgs` implementation + `BuildActionArgsOptions` type
- `src/engine/utils/arg-builder.test.ts` — 12 tests covering all four scenarios
- `src/engine/utils/index.ts` — added `buildActionArgs` + `BuildActionArgsOptions` export
- `src/engine/index.ts` — re-exports `buildActionArgs` + `BuildActionArgsOptions` from engine barrel

## Decisions Made

- `_seat` parameter kept in signature for API stability (future per-seat validation) but unused — no per-seat filtering needed today, validation is pure action-level
- Wire format uses `useBranchPaths: false` (ID refs) per INTRO-03 spec; callers needing stable branch paths can call `serializeValue` directly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed runner integration test construction**
- **Found during:** Task 1 / 2 (test runner.performAction integration)
- **Issue:** Test used `new GameRunner({ game })` — GameRunner always constructs its own Game instance from a `GameClass` + `gameOptions`, not an existing instance. The constructor accesses `options.gameOptions.seed` unconditionally.
- **Fix:** Rewrote the integration test to use `new GameRunner({ GameClass, gameType, gameOptions })` + `runner.start()`, then retrieves the token from `runner.game`
- **Files modified:** `src/engine/utils/arg-builder.test.ts`
- **Verification:** All 12 tests pass, including the runner.performAction end-to-end test
- **Committed in:** `ae9474c` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test setup)
**Impact on plan:** Necessary for the runner integration test to exercise the correct code path. No scope creep.

## Issues Encountered

None beyond the runner construction bug above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `buildActionArgs` is exported from the engine barrel and ready for use by headless/agent callers
- Wire format (`{ format: 'wire' }`) produces JSON-safe args for cross-process transmission
- INTRO-04 (`enumerateLegalMoves`) can reference this utility for building per-move arg records if needed

---
*Phase: 117-action-space-introspection*
*Completed: 2026-06-30*
