---
phase: 41-test-colocation
plan: 01
subsystem: testing
tags: [vitest, test-colocation, pit-of-success, monorepo]

# Dependency graph
requires:
  - phase: 40-source-collapse
    provides: Unified src/ structure for library code
provides:
  - 14 library test files colocated in src/ next to source
  - 1 test helper file moved with tests
  - vitest.config.ts with src/**/*.test.ts pattern
  - Alias resolution for workspace packages in tests
affects: [42-build-unification, 43-barrel-cleanup, 44-game-test-colocation]

# Tech tracking
tech-stack:
  added: [vue@3.4.0 (root devDep for UI tests)]
  patterns: [colocated-tests, resolve-aliases]

key-files:
  created:
    - src/engine/element/game-element.test.ts
    - src/engine/action/action.test.ts
    - src/engine/flow/engine.test.ts
    - src/engine/utils/dev-state.test.ts
    - src/engine/utils/serializer.test.ts
    - src/engine/utils/snapshot.test.ts
    - src/engine/command/undo.test.ts
    - src/runtime/runner.test.ts
    - src/ai/mcts-bot.test.ts
    - src/ai/mcts-cache.test.ts
    - src/ai/cribbage-bot.test.ts
    - src/ai-trainer/evolution.test.ts
    - src/ai-trainer/parallel-simulator.test.ts
    - src/ui/composables/useActionController.test.ts
    - src/ui/composables/useActionController.selections.test.ts
    - src/ui/composables/useActionController.helpers.ts
    - src/session/checkpoint-manager.test.ts
  modified:
    - vitest.config.ts
    - package.json

key-decisions:
  - "Added resolve.alias in vitest.config.ts for workspace package resolution"
  - "Installed vue as root devDependency for UI composable tests"
  - "Preserved game tests in packages/games/ (deferred to Phase 44)"

patterns-established:
  - "Colocated tests: *.test.ts files live next to their source files"
  - "Test import pattern: use relative paths ./file.js or ../index.js"

# Metrics
duration: 8min
completed: 2026-01-18
---

# Phase 41 Plan 01: Library Test Colocation Summary

**Moved 14 library tests + 1 helper from packages/*/tests/ to colocated src/ positions with vitest alias config**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-18T18:42:44Z
- **Completed:** 2026-01-18T18:50:00Z
- **Tasks:** 3
- **Files modified:** 20

## Accomplishments
- All 14 library test files moved to src/ as direct siblings of source files
- vitest.config.ts updated with src/**/*.test.ts pattern and alias resolution
- All 406 library tests pass (1 skipped)
- Empty packages/*/tests/ directories cleaned up
- Requirement SRC-13 (tests next to code) satisfied

## Task Commits

Each task was committed atomically:

1. **Task 1: Update vitest config** - `a6097f9` (chore)
2. **Task 2: Move tests and update imports** - `9ad9b2e` (refactor)
3. **Task 3: Clean up empty directories** - No separate commit (directories auto-removed with git mv)

## Files Created/Modified

**Tests moved (14 + 1 helper):**
- `src/engine/element/game-element.test.ts` - Element tree, queries, serialization
- `src/engine/action/action.test.ts` - Action builder, executor
- `src/engine/flow/engine.test.ts` - Flow builders, engine, TurnOrder
- `src/engine/utils/dev-state.test.ts` - HMR state capture/restore
- `src/engine/command/undo.test.ts` - Command undo functionality
- `src/engine/utils/serializer.test.ts` - Value/action serialization
- `src/engine/utils/snapshot.test.ts` - Game state snapshots
- `src/runtime/runner.test.ts` - GameRunner creation, flow, replay
- `src/ai/mcts-bot.test.ts` - MCTS bot performance
- `src/ai/mcts-cache.test.ts` - MCTS caching, transposition table
- `src/ai/cribbage-bot.test.ts` - Cribbage simultaneous discard
- `src/ai-trainer/evolution.test.ts` - Genetic algorithm evolution
- `src/ai-trainer/parallel-simulator.test.ts` - Parallel simulation determinism
- `src/ui/composables/useActionController.test.ts` - Action controller composable
- `src/ui/composables/useActionController.selections.test.ts` - Selection handling
- `src/ui/composables/useActionController.helpers.ts` - Test helper utilities
- `src/session/checkpoint-manager.test.ts` - Checkpoint management

**Config changes:**
- `vitest.config.ts` - Added src/**/*.test.ts pattern, resolve.alias for packages
- `package.json` - Added vue as devDependency

## Decisions Made

1. **Added resolve.alias in vitest.config.ts** - Workspace package imports like `@boardsmith/engine` needed resolution when tests moved to src/. Added aliases pointing to src/*/index.ts and packages/games/*/rules/src/index.ts for game dependencies.

2. **Installed vue as root devDependency** - UI composable tests import vue, which was only in packages/ui/node_modules. Rather than complex alias resolution, installed vue@^3.4.0 at root for simpler test execution.

3. **Renamed some test files** - element.test.ts -> game-element.test.ts, flow.test.ts -> engine.test.ts, command-undo.test.ts -> undo.test.ts to better match their source file names.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest alias resolution for workspace packages**
- **Found during:** Task 2 (after moving tests)
- **Issue:** Tests imported `@boardsmith/checkers-rules`, `@boardsmith/cribbage-rules`, `@boardsmith/engine` which worked in packages/ but not in src/
- **Fix:** Added resolve.alias configuration to vitest.config.ts mapping @boardsmith/* to src/ and packages/games/ paths
- **Files modified:** vitest.config.ts
- **Verification:** All tests pass
- **Committed in:** 9ad9b2e (Task 2 commit)

**2. [Rule 3 - Blocking] Missing vue dependency for UI tests**
- **Found during:** Task 2 (after moving UI tests)
- **Issue:** UI composable tests import `vue` which was only in packages/ui/node_modules symlink
- **Fix:** Installed vue@^3.4.0 as root devDependency
- **Files modified:** package.json, package-lock.json
- **Verification:** UI tests pass
- **Committed in:** 9ad9b2e (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking issues)
**Impact on plan:** Both auto-fixes necessary for test execution in new locations. No scope creep.

## Issues Encountered
- Pre-existing e2e test failures (ECONNREFUSED port 8787) in game packages - not related to this plan, require running server

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Library tests now colocated, ready for Phase 42 (build unification)
- Game tests remain in packages/games/ for Phase 44
- vitest configuration established as pattern for future test organization

---
*Phase: 41-test-colocation*
*Completed: 2026-01-18*
