---
phase: 133-engine-flow-action-validation
plan: 05
subsystem: engine
tags: [flow-engine, switchOn, error-handling, tdd]

# Dependency graph
requires:
  - phase: 133-01
    provides: PROC-01 verification gate confirming F27/ENG-07 as LEGITIMATE with file:line evidence
  - phase: 133-03
    provides: sibling resumeSimultaneousAction throw precedent (plain Error, no local try/catch) reused as propagation-path proof
provides:
  - executeSwitch throws an actionable error when a switchOn value matches no case and no default is configured
  - Red-first regression test covering the unmatched-throw path plus matched-case and default-fallback controls
affects: [engine flow control, runtime error propagation, any future switchOn-based game flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Silent flow no-ops converted to actionable thrown errors, matching the loop maxIterations precedent (plain `new Error`, no local try/catch, propagates to runner.ts's existing catch -> {success:false, errorCode: ENGINE_ERROR})"

key-files:
  created: []
  modified:
    - src/engine/flow/engine.ts
    - src/engine/flow/engine.test.ts

key-decisions:
  - "Used the generalized error message form as baseline ('switchOn got \"<value>\" — no matching case (<keys>) and no default'), with an optional name prefix (`switchOn \"<name>\"`) when config.name is present, matching the loop maxIterations precedent without requiring callers to set name"
  - "No new try/catch added inside executeSwitch — the plain thrown Error propagates through the flow dispatch loop up to runner.ts performAction's existing catch, exactly like resumeSimultaneousAction's existing throws (133-03 precedent)"

patterns-established:
  - "Pattern: unmatched flow-control dispatch (switch/case-style) throws rather than silently completing the frame — same shape as the loop maxIterations guard from v4.3 Phase 120"

requirements-completed: [ENG-07, PROC-02]

# Metrics
duration: 6min
completed: 2026-07-03
---

# Phase 133 Plan 05: switchOn Unmatched-Case Throw (ENG-07) Summary

**executeSwitch now throws an actionable error naming the offending value and available case keys instead of silently completing the flow frame when a switchOn value matches no case and no default is configured.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-03T14:25:00Z
- **Completed:** 2026-07-03T14:31:45Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- Red-first regression test added (Conditionals describe block) proving the current silent no-op: unmatched `switchOn` value with no default previously marked the frame `completed` and continued execution with zero signal.
- `executeSwitch`'s `if (!branch) { frame.completed = true; return {...} }` silent no-op replaced with a plain `throw new Error(...)` naming the JSON-stringified offending value and the joined case keys.
- Matched-case and default-fallback controls (Tests B and C) confirm zero regression to existing switchOn behavior.
- Full test suite (168 files, 2163 tests) green at phase close, satisfying the wave's phase-close full-suite gate.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — regression test for switchOn unmatched value + no default** - `39d7254c` (test)
2. **Task 2: GREEN — throw on unmatched switchOn with no default** - `bbfc1c4a` (feat)

**Plan metadata:** (pending — this commit)

## RED Output (Task 1, PROC-02 record)

Captured before the Task 2 fix, confirming the silent-no-op defect:

```
 ❯ src/engine/flow/engine.test.ts (93 tests | 1 failed | 87 skipped) 9ms
   × FlowEngine > Conditionals > should throw an actionable error when switchOn has no matching case and no default 6ms
     → expected [Function] to throw an error

AssertionError: expected [Function] to throw an error

- Expected:
null

+ Received:
undefined

 ❯ src/engine/flow/engine.test.ts:706:36
      const engine = new FlowEngine(game, flow);

      expect(() => engine.start()).toThrow(/no matching case/);
                                   ^
```

Test Files: 1 failed (1) — 1 test failed | 5 passed | 87 skipped (93). Confirms `engine.start()` did NOT throw prior to the fix — the flow silently completed instead.

## GREEN Output (Task 2)

```
✓ src/engine/flow/engine.test.ts (93 tests) 22ms
✓ src/engine/action/action.test.ts (133 tests) 31ms

Test Files  2 passed (2)
     Tests  226 passed (226)
```

## Files Created/Modified
- `src/engine/flow/engine.ts` - `executeSwitch`'s unmatched-branch handling replaced with a thrown `Error` (`switchOn got "<value>" — no matching case (<keys>) and no default`, with optional `config.name` prefix)
- `src/engine/flow/engine.test.ts` - Three new tests in the `Conditionals` describe block: unmatched-throw regression, matched-case control, default-fallback control

## Deviations from Plan

None - plan executed exactly as written.

## Threat Flags

None - the fix stays within the existing `executeSwitch` mitigation scope defined in the plan's threat_model (T-133-05); no new surface introduced.

## Self-Check: PASSED

- FOUND: src/engine/flow/engine.ts (modified, executeSwitch throw present)
- FOUND: src/engine/flow/engine.test.ts (modified, 3 new tests present)
- FOUND: commit 39d7254c (RED test commit)
- FOUND: commit bbfc1c4a (GREEN fix commit)
