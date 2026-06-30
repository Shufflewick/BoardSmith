---
phase: 118-test-ergonomics
plan: "04"
subsystem: testing
tags: [ActionBuilder, multi-step, dependent-selection, getSelectionChoices, fluent-api]

# Dependency graph
requires:
  - phase: 118-test-ergonomics
    provides: "118-01 (test-game.ts getPlayerView annotation), 118-02 (playUntilComplete/GameStuckError barrel)"

provides:
  - "ActionBuilder class — fluent multi-step/dependent-selection builder (src/testing/action-builder.ts)"
  - "testGame.action(name, seat) factory returning ActionBuilder"
  - "ActionBuilder barrel export from src/testing/index.ts"
  - "13 tests covering enabled-only choices, dependent selection, execute, buildArgs, factory"

affects:
  - 118-test-ergonomics
  - "Phase 122 (docs): getChoices() return-type divergence from design doc (see Deviations)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ActionBuilder fluent builder pattern for test action authoring"
    - "import type (type-only) for circular-safe cross-file TestGame reference"

key-files:
  created:
    - src/testing/action-builder.ts
    - src/testing/action-builder.test.ts
  modified:
    - src/testing/test-game.ts
    - src/testing/index.ts

key-decisions:
  - "getChoices() returns enabled choice VALUES (not AnnotatedChoice wrappers) — more ergonomic for test authors; diverges from design-doc signature which declares AnnotatedChoice[] return type"
  - "Import cycle prevention: action-builder.ts uses 'import type { TestGame }' making it a type-level edge at runtime"
  - "ActionBuilder is a new file (not added to simulate-action.ts) per plan and research doc recommendation"

patterns-established:
  - "Pattern: type-only import of TestGame in ActionBuilder prevents runtime circular dependency while maintaining full type safety"
  - "Pattern: filter c.disabled === false before mapping to values (Pit of Success — disabled choices never exposed)"

requirements-completed: [TEST-05]

# Metrics
duration: 3min
completed: 2026-06-30
---

# Phase 118 Plan 04: ActionBuilder (TEST-05) Summary

**Fluent ActionBuilder class for test multi-step/dependent-selection authoring via game.getSelectionChoices() with disabled-choices filter and descriptive execute() errors**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-30T23:13:27Z
- **Completed:** 2026-06-30T23:16:XX Z
- **Tasks:** 2 (TDD: RED commit + GREEN commit)
- **Files modified:** 4

## Accomplishments

- `ActionBuilder` class in `src/testing/action-builder.ts` — delegates to `game.getSelectionChoices()` for in-process choice resolution, filters `disabled === false`, maps to values, accumulates args via `select()`, throws descriptive error on `execute()` failure
- `testGame.action(actionName, seat)` factory on `TestGame` returning a new `ActionBuilder`
- `ActionBuilder` exported from `src/testing/index.ts` barrel
- 13 tests covering all TEST-05 contract points (enabled-only choices, dependent-selection cross-layer integration, execute success/failure, buildArgs, factory)

## Task Commits

1. **Task 1: Write failing TEST-05 tests (RED)** - `fe2a9bc` (test)
2. **Task 2: Implement ActionBuilder + action() factory + barrel (GREEN)** - `43e65fb` (feat)

**Plan metadata:** (final docs commit — see below)

## Files Created/Modified

- `src/testing/action-builder.ts` — ActionBuilder class with getChoices/select/execute/buildArgs
- `src/testing/action-builder.test.ts` — 13 TEST-05 integration + unit tests
- `src/testing/test-game.ts` — added `action(actionName, seat): ActionBuilder` factory + import
- `src/testing/index.ts` — added `ActionBuilder` barrel export

## Decisions Made

- **getChoices() returns VALUES not AnnotatedChoice wrappers** — the design doc (`v4.3-API-DESIGN.md`) declares `getChoices(): AnnotatedChoice[]`, but the research doc and plan spec a more ergonomic return of enabled choice values directly. Implemented the ergonomic version (values only). Phase 122 (docs) should update the design doc to reflect `getChoices(): unknown[]`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected no-prior-select test assertion**
- **Found during:** Task 2 (GREEN — running tests)
- **Issue:** Test asserted `getChoices('item')` with no category selected returns `[]`. The choices function is `ctx.args.category === 'A' ? [10,20,30] : [40,50]` — with `category` undefined, it takes the else branch and returns `[40,50]`, not `[]`.
- **Fix:** Updated the test to assert `[40,50]` for no-prior-select, then verify the value changes to `[10,20,30]` after `select('category','A')`. This still demonstrates the dependent-selection cross-layer integration (the change in choices proves accumulated args flow through).
- **Files modified:** `src/testing/action-builder.test.ts`
- **Committed in:** `43e65fb` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - test assertion bug)
**Impact on plan:** No scope change. Test still fully covers the dependent-selection cross-layer contract.

## Issues Encountered

None beyond the test assertion bug above.

## Known Stubs

None.

## Threat Flags

None. ActionBuilder is an in-process test utility with no network surface, no auth paths, and no file access.

## Next Phase Readiness

- TEST-05 complete. All five Phase 118 TEST requirements now have implementations (118-01 through 118-04).
- `src/testing/` full suite: 76 tests, all green.
- Ready for Phase 119 (devtools/browser driving) or Phase 122 (docs — update getChoices return-type in design doc).

---
*Phase: 118-test-ergonomics*
*Completed: 2026-06-30*
