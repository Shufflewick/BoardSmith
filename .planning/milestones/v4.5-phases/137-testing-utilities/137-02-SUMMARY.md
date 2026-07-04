---
phase: 137-testing-utilities
plan: 02
subsystem: testing
tags: [testing, test-game, action-builder, vitest, fail-loud, tdd]

# Dependency graph
requires:
  - phase: 137-01
    provides: "PROC-01 verification gate confirming F36/TST-01 LEGITIMATE against post-Phase-136 source, with the six doAction call sites classified (a/b/c) for this plan"
provides:
  - "TestGame.doAction throws ActionExecutionError by default on action failure, carrying a debugActionAvailability trace"
  - "TestGame.tryAction — never-throw escape hatch preserving the old doAction behavior exactly"
  - "ActionBuilder.execute() simplified to delegate the throw to doAction"
  - "Four harness call sites (simulate-tutorial, random-simulation, simulateAction, playUntilComplete internal loop) migrated to tryAction, preserving their failure-as-a-branch control flow"
  - "Class-level, method-level, and createTestGame JSDoc examples + docs/api/testing.md + docs/agent-control.md updated to model the new throw/tryAction semantics"
affects: [137-03, 138-games-migration, 139-docx-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ActionExecutionError mirrors GameStuckError's shape (readonly name literal, structured fields, Object.setPrototypeOf) for consistent vitest error output across the testing module"
    - "doAction builds its rich trace (debugActionAvailability + getFlowDebugInfo) only on the failure path — zero cost on success"

key-files:
  created: []
  modified:
    - src/testing/test-game.ts
    - src/testing/test-game.test.ts
    - src/testing/action-builder.ts
    - src/testing/simulate-tutorial.ts
    - src/testing/random-simulation.ts
    - src/testing/simulate-action.ts
    - docs/api/testing.md
    - docs/agent-control.md

key-decisions:
  - "doAction's throw message is built by calling game.debugActionAvailability + getFlowDebugInfo directly (mirroring assertActionAvailable's failure-path code), wrapped in try/catch so an out-of-range seat (getPlayer throws) falls back to a plain result.error message instead of masking the real failure with a second error"
  - "TST-01's RED test fixture could not reuse the existing FixtureGame: its loop({ while: () => false, ... }) completes on construction before any action is submitted (`isComplete()` is already true at TestGame.create() time), which no prior test had exercised because none of them called doAction. Added a dedicated single-actionStep TST01Game fixture instead of masking the discovery by picking a fixture that happened to still be awaiting input."
  - "playUntilComplete's internal loop and simulateAction() both migrated to tryAction (category b) — a throw-flip on either would have broken multi-seat failure batching (playUntilComplete) or violated simulateAction's documented never-throw contract"

requirements-completed: [TST-01, PROC-02]

# Metrics
duration: 24min
completed: 2026-07-03
---

# Phase 137 Plan 02: TestGame.doAction throws by default Summary

**`TestGame.doAction` now throws `ActionExecutionError` with a `debugActionAvailability` trace on failure instead of silently returning `{success:false}`; `tryAction` is the new documented escape hatch, and the four harness loops that depend on failure-as-a-branch were migrated to it.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-07-03T23:39:43Z
- **Completed:** 2026-07-03T23:47:48Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- `TestGame.doAction` fails loud by default: throws `ActionExecutionError` (mirroring `GameStuckError`'s shape) naming the action/seat, folding in `result.error`/`errorCode`, the `debugActionAvailability` reason + per-selection lines, and the current flow position.
- `TestGame.tryAction` added as the documented never-throw escape hatch, preserving the exact old `doAction` behavior for tests that deliberately exercise the failure path.
- `ActionBuilder.execute()` simplified — deletes its redundant hand-rolled `!result.success` throw and delegates to `doAction`, which is a strict superset (same action/seat context plus the debug trace).
- All four category-(b) harness call sites (simulate-tutorial.ts, random-simulation.ts, simulate-action.ts's `simulateAction` and `playUntilComplete` internal loop) migrated to `tryAction`, keeping their existing failure-handling control flow (custom tutorial error, `consecutiveFailures` retry counter, raw-result contract, multi-seat failure batching) fully intact.
- Class-level `@example`, the `doAction`/`createTestGame` method JSDoc, `docs/api/testing.md`, and `docs/agent-control.md` no longer model checking/ignoring a `doAction` result — they either show the bare throwing call or point at `tryAction`/`simulateAction` for expected-failure cases.
- Full suite green: 175 files / 2361 tests (baseline was 175/2358 — the 3 new TST-01 tests account for the delta; the throw-flip surfaced no previously-silent failures elsewhere in the suite).

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — failing tests for doAction-throws and tryAction-returns** - `ecc2e2e7` (test)
2. **Task 2: GREEN — ActionExecutionError, doAction throws, tryAction escape hatch, ActionBuilder simplified** - `cf5089da` (feat)
3. **Task 3: Migrate the four category-(b) harness call sites to tryAction + fix doc examples** - `32d40ffe` (refactor)

_Note: this was a two-gate TDD plan (RED in Task 1, GREEN in Task 2); Task 3 is a follow-on refactor/docs task, not part of the RED/GREEN pair._

## Files Created/Modified

- `src/testing/test-game.ts` - Added `ActionExecutionError` class; renamed old never-throwing `doAction` body to `tryAction`; rewrote `doAction` to throw on failure with a `debugActionAvailability`+`getFlowDebugInfo` trace; fixed 3 stale JSDoc examples
- `src/testing/test-game.test.ts` - New `doAction throw-on-failure (TST-01)` describe block (3 tests) with a dedicated `TST01Game` fixture
- `src/testing/action-builder.ts` - `execute()` simplified to a single delegating call to `doAction`
- `src/testing/simulate-tutorial.ts` - Scripted-move execution now calls `tryAction`
- `src/testing/random-simulation.ts` - Random-move execution now calls `tryAction`
- `src/testing/simulate-action.ts` - `simulateAction()` and `playUntilComplete`'s internal loop now call `tryAction`
- `docs/api/testing.md` - `TestGame` export summary documents the `doAction`/`tryAction` split
- `docs/agent-control.md` - Headless-loop example no longer checks/ignores the `doAction` result; `TestGame` overview documents both methods

## Decisions Made

- `debugActionAvailability`/`getFlowDebugInfo` trace-building wrapped in try/catch inside `doAction` so an invalid seat (where `getPlayer` itself throws) falls back to a plain `result.error`-based message rather than masking the real failure with an unrelated "Player N not found" error.
- Discovered (not masked) that `FixtureGame`'s existing flow (`loop({ while: () => false, ... })`) completes during `TestGame.create()` before any action can be submitted — no prior test had called `doAction` against it. Added a dedicated `TST01Game` fixture (single `actionStep`) rather than picking around the issue, since fixing/replacing the shared fixture was out of scope for this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TST-01 RED test needed a working fixture, not FixtureGame**
- **Found during:** Task 2 (GREEN)
- **Issue:** The RED test for "doAction does NOT throw for a valid action" used `FixtureGame`'s `pass` action per the plan's read_first note, but `FixtureGame`'s flow completes synchronously during `TestGame.create()` (its `loop` has `while: () => false`), so `doAction` correctly threw `NOT_AWAITING_INPUT` — a true positive on the new throw behavior, not a bug in the fix.
- **Fix:** Added a dedicated `TST01Game` fixture with a plain `actionStep` flow that stays awaiting input, and used it for all three TST-01 tests instead of `FixtureGame`.
- **Files modified:** src/testing/test-game.test.ts
- **Verification:** All 3 TST-01 tests pass; full suite remains green.
- **Committed in:** cf5089da (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test fixture selection)
**Impact on plan:** Zero scope creep — the fix stayed within Task 2's own test file and did not touch any other fixture or source file.

## Issues Encountered

None beyond the fixture issue documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- TST-01 (F36) fully resolved: `doAction` fails loud by default, `tryAction` is the documented escape hatch, all consumers (harness + ActionBuilder + docs) updated.
- Plan 03 (TST-02, F37 — nondeterministic default seed) is next in this phase; the `doAction` throw message already has a code comment marking where `testGame.seed` will be appended once Plan 03 adds the `seed` getter.
- Full suite green (175/2361) with no newly-surfaced silent failures — the throw-flip's repo-wide sanity check passed cleanly.

---
*Phase: 137-testing-utilities*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 8 modified files verified present on disk; all 3 task commits (ecc2e2e7, cf5089da, 32d40ffe) verified in git log.
