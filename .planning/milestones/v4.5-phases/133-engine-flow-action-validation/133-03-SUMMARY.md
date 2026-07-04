---
phase: 133-engine-flow-action-validation
plan: 03
subsystem: engine
tags: [flow-engine, simultaneous-action-step, action-validation, actionError, vitest]

# Dependency graph
requires:
  - phase: 133-01
    provides: PROC-01 independent re-verification confirming F5/ENG-03 as LEGITIMATE with exact file:line evidence
  - phase: 133-02
    provides: eachPlayer startingPlayer wrap-around fix (sibling ENG finding, same phase, no shared code path)
provides:
  - resumeSimultaneousAction now mirrors resume()'s actionError set-on-failure / clear-on-success behavior
  - Failed actions inside a simultaneousActionStep surface {success:false} through GameRunner.performAction and are excluded from actionHistory
  - Red-first engine-level and runner-level regression tests for ENG-03
affects: [133-05, session, runtime]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "actionError set-on-failure / clear-on-success mirror between resume() and resumeSimultaneousAction()"

key-files:
  created: []
  modified:
    - src/engine/flow/engine.ts
    - src/engine/flow/engine.test.ts
    - src/runtime/runner.test.ts

key-decisions:
  - "resumeSimultaneousAction's allDone-gated awaitingInput/awaitingPlayers clearing logic left untouched -- only the actionError set/clear mirror was added, matching the locked decision not to move awaitingInput=false into the failure/success branch"
  - "runner.ts was not modified -- it already reads flowState.actionError as the sole failure signal; the fix flows through unchanged"

patterns-established:
  - "Failure-signaling parity between sibling resume paths (resume() vs resumeSimultaneousAction()) verified by mirroring test coverage at both the engine level (FlowState.actionError) and the runtime level (GameRunner.actionHistory gating)"

requirements-completed: [ENG-03, PROC-02]

# Metrics
duration: 12min
completed: 2026-07-03
---

# Phase 133 Plan 03: Simultaneous Action Failure Signaling (ENG-03) Summary

**Fixed `resumeSimultaneousAction` to set/clear `FlowState.actionError` on failure/success, so a failed action inside a `simultaneousActionStep` now correctly returns `{success:false}` through `GameRunner.performAction` and is excluded from `actionHistory`, instead of silently looking like a success.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-03T14:15:00Z
- **Completed:** 2026-07-03T14:27:00Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- Added red-first engine-level tests proving `resumeSimultaneousAction`'s failure branch never set `actionError` (bug confirmed exactly as F5/ENG-03 described in `133-FINDINGS-VERIFICATION.md`)
- Added a red-first runner-level test proving a failed simultaneous action was silently pushed to `actionHistory` through `GameRunner.performAction`
- Fixed `resumeSimultaneousAction` to mirror `resume()`'s exact set-on-failure/clear-on-success placement, without touching the separate allDone-gated `awaitingInput`/`awaitingPlayers` clearing logic
- Confirmed `runner.ts` required zero changes -- it already gates `actionHistory.push` on `flowState.actionError` as designed
- Full test suite (168 files, 2160 tests) green after the fix

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — engine + runner regression tests for failed simultaneous action** - `93cefe2b` (test)
2. **Task 2: GREEN — actionError set-on-failure / clear-on-success in resumeSimultaneousAction** - `c56bf44c` (fix)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/engine/flow/engine.ts` - `resumeSimultaneousAction` now sets `this.actionError = result.error` on failure (before `return this.getState()`) and `this.actionError = undefined` on success (before the `playerDone`/`allDone` re-evaluation), mirroring `resume()`'s placement exactly
- `src/engine/flow/engine.test.ts` - New `describe('ENG-03 simultaneous action failure signaling')` block: Test A (failure sets `actionError`, leaves `awaitingPlayers`/`awaitingInput` untouched), Test B (fail-then-succeed clears the stale `actionError`)
- `src/runtime/runner.test.ts` - New `SimultaneousTestGame` fixture (single `simultaneousActionStep` with a validated `chooseFrom` action) and Test C asserting a failing simultaneous action returns `{success:false}` and leaves `runner.actionHistory` at length 0

## RED Output (Task 1, captured per PROC-02)

Engine tests, run against unpatched `resumeSimultaneousAction`:
```
FAIL src/engine/flow/engine.test.ts > ENG-03 simultaneous action failure signaling > sets actionError when a simultaneous action fails validation...
  AssertionError: expected undefined to be defined
    expect(state.actionError).toBeDefined();

FAIL src/engine/flow/engine.test.ts > ENG-03 simultaneous action failure signaling > clears actionError once a later action in the same step succeeds (fail-then-succeed)
  AssertionError: expected undefined to be defined
    expect(failState.actionError).toBeDefined();
```

Runner test, run against unpatched `resumeSimultaneousAction`:
```
FAIL src/runtime/runner.test.ts > GameRunner > game flow > ENG-03: a failing simultaneous action returns {success:false} and is NOT recorded in actionHistory
  AssertionError: expected true to be false
    expect(result.success).toBe(false);
```
(The failing action's `result.success` was `true` and `actionHistory` would have grown to length 1 -- confirming the runner-level symptom from `133-FINDINGS-VERIFICATION.md`: a failed simultaneous action silently "succeeds" and pollutes `actionHistory`.)

All three tests pass GREEN after the Task 2 fix; full suite (`npm test`) confirmed green (168 files, 2160 tests).

## Decisions Made
- Kept the allDone-gated `awaitingInput = false` / `awaitingPlayers = []` clearing logic entirely separate from the new actionError mirror, per the plan's explicit instruction -- `resumeSimultaneousAction`'s completion semantics are structurally different from `resume()`'s single-player completion and must not be conflated
- Left `runner.ts` unmodified -- confirmed via `git diff --name-only` that it does not appear in the diff; it was already the correct, sole consumer of `flowState.actionError`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

ENG-03 fully resolved and regression-tested at both the engine and runtime layers. Plan 133-05 (F27/ENG-07, `switchOn` silent-completion fix) is unblocked and does not share any code path with this fix.

---
*Phase: 133-engine-flow-action-validation*
*Completed: 2026-07-03*

## Self-Check: PASSED
