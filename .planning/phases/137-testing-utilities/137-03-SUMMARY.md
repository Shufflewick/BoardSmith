---
phase: 137-testing-utilities
plan: 03
subsystem: testing
tags: [testing, test-game, determinism, seed, vitest, tdd]

# Dependency graph
requires:
  - phase: 137-02
    provides: "TestGame.doAction throws ActionExecutionError by default; the throw message had a placeholder comment marking where testGame.seed would be appended"
provides:
  - "TestGame default seed is a fixed literal ('test-seed'), never Date.now()/Math.random — seedless TestGame.create() calls are deterministic by default"
  - "readonly testGame.seed field exposing the resolved seed (fixed default or caller-supplied)"
  - "Seed surfaced in doAction's ActionExecutionError message, assertActionAvailable's throw, and all four playUntilComplete GameStuckError messages"
affects: [138-games-migration, 139-docx-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixed literal seed defaults ('test-seed') mirror playUntilComplete's existing 'playUntilComplete-default' house style — no wall-clock/random fallback anywhere in the testing module"
    - "Failure messages append a trailing 'Seed: <seed>' line after the existing 'Flow position:' line, giving every diagnosable testing-module error a one-copy-paste deterministic repro"

key-files:
  created: []
  modified:
    - src/testing/test-game.ts
    - src/testing/test-game.test.ts
    - src/testing/assertions.ts
    - src/testing/simulate-action.ts
    - docs/api/testing.md

key-decisions:
  - "Fixed literal chosen as 'test-seed' (Claude's discretion per plan), matching the naming brevity of 'playUntilComplete-default'"
  - "seed threaded into the TestGame constructor as a second private-constructor parameter (alongside the existing GameRunner) rather than re-reading it off runner/game internals — keeps the field's provenance obvious at the call site in TestGame.create()"
  - "RED test 1 (seedless-shuffle-determinism) coincidentally passed even before the fix, because Date.now() collided within the same test-run millisecond for both TestGame.create() calls — RED was still confirmed via the two testGame.seed accessor tests failing (field did not exist)"

requirements-completed: [TST-02, PROC-02]

# Metrics
duration: 18min
completed: 2026-07-04
---

# Phase 137 Plan 03: Deterministic default seed + testGame.seed accessor Summary

**Replaced `TestGame`'s nondeterministic `` `test-${Date.now()}` `` default seed with a fixed literal (`'test-seed'`), added a `readonly testGame.seed` accessor, and threaded the seed into every testing-module failure message (`doAction`'s `ActionExecutionError`, `assertActionAvailable`'s throw, and all four `playUntilComplete` `GameStuckError` messages) for one-copy-paste deterministic repro.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-04T00:00:00Z (approx)
- **Completed:** 2026-07-04
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- `TestGame.create()`'s default seed is now the fixed literal `'test-seed'` — never `Date.now()`, never `Math.random` — so two seedless `TestGame.create()`/`createTestGame()` calls at any two moments in time produce identical shuffles and command history.
- `TestGame` gained a `readonly seed: string` field, exposed as `testGame.seed`, returning the resolved seed (fixed default or the caller-supplied `seed` option).
- The seed is now surfaced in every testing-module failure path that previously ended with a `Flow position:` diagnostic line: `doAction`'s `ActionExecutionError` message, `assertActionAvailable`'s thrown `Error`, and all four `GameStuckError` messages `playUntilComplete` can throw (engine-state-inconsistency dead-end, all-moves-failed dead-end, no-enumerable-moves dead-end, and the `maxMoves` cap).
- `docs/api/testing.md` updated to document the fixed default seed and `testGame.seed` under the `TestGameOptions` type description.
- Full suite green: 175 files / 2364 tests (baseline 175/2361 from Plan 02 — the 3 new TST-02 tests account for the delta; no shuffle-dependent test broke from the seed-default change).

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — failing tests for seedless determinism + testGame.seed accessor** - `d87dd708` (test)
2. **Task 2: GREEN — fixed default seed, testGame.seed accessor, seed in failure messages** - `e5631577` (feat)

## TDD Gate Compliance

RED gate confirmed: `test(137-03): add failing tests...` (`d87dd708`) landed before the GREEN commit. Both `testGame.seed` accessor tests failed against pre-fix source (`expected undefined to be type of 'string'` / `expected undefined to be 'my-explicit-seed'`) — a genuine RED, not a passing test masquerading as one. The seedless-shuffle-determinism test happened to pass even pre-fix (Date.now() collision within the same test-run millisecond), which is documented as a known-benign RED-gate nuance in Decisions above, not a masked GREEN.
GREEN gate confirmed: `feat(137-03): fixed default seed...` (`e5631577`) makes all three new tests pass and the full suite remains green.
No separate REFACTOR commit was needed — Task 2's implementation was clean on first pass.

## Files Created/Modified

- `src/testing/test-game.ts` - Fixed literal default seed (`'test-seed'`, replacing `` `test-${Date.now()}` ``); new `readonly seed: string` field threaded through the private constructor; `doAction`'s `ActionExecutionError` message now appends `Seed: ${this.seed}` on both the plain-message and rich-debug-trace paths; stale "future plan" JSDoc comment corrected
- `src/testing/test-game.test.ts` - New `deterministic default seed (TST-02)` describe block (3 tests) with a dedicated `SeedFixtureGame`/`SeedToken` fixture that shuffles a 10-item deck in its constructor, enabling seedless-shuffle comparison
- `src/testing/assertions.ts` - `assertActionAvailable`'s "seat is not active" throw and its "action not available" throw both append `Seed: ${testGame.seed}` after the existing `Flow position:` line
- `src/testing/simulate-action.ts` - All four `GameStuckError` message sites in `playUntilComplete` (engine-inconsistency dead-end, all-moves-failed dead-end, no-enumerable-moves dead-end, maxMoves cap) append `Seed: ${testGame.seed}`
- `docs/api/testing.md` - `TestGameOptions` type description now documents the fixed default seed and `testGame.seed`

## Decisions Made

- Fixed literal chosen as `'test-seed'` per the plan's suggested naming, matching `playUntilComplete-default`'s house style (a stable, self-describing string, never derived from wall-clock time or randomness).
- `seed` threaded as a second parameter into `TestGame`'s existing private constructor (alongside `runner`) rather than derived from runner/game internals after construction — keeps the field's provenance obvious at the single call site in `TestGame.create()`.
- The seedless-shuffle-determinism RED test passed even before the fix (Date.now() collision within the same millisecond during a fast test run) — RED was still genuinely confirmed via the two `testGame.seed` accessor tests, which failed because the field did not exist pre-fix. Documented rather than treated as a blocker, since the plan's acceptance criteria only required RED confirmation for the suite as a whole, which was satisfied.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- TST-02 (F37) fully resolved: default seed is a fixed literal, `testGame.seed` is exposed, and every testing-module failure path (doAction, assertActionAvailable, playUntilComplete) surfaces it for deterministic repro.
- Phase 137 (Testing Utilities) is now complete — both F36 (TST-01, Plan 02) and F37 (TST-02, Plan 03) are resolved with full-suite verification at each step.
- Full suite green (175/2364) — ready for Phase 138 (cross-repo games migration), which depends on all API-changing phases (131-137) being stable.

---
*Phase: 137-testing-utilities*
*Completed: 2026-07-04*

## Self-Check: PASSED

All 5 modified files verified present on disk; both task commits (d87dd708, e5631577) verified in git log.
