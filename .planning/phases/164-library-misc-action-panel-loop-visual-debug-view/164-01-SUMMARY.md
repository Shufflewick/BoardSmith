---
phase: 164-library-misc-action-panel-loop-visual-debug-view
plan: 01
subsystem: engine
tags: [flow-engine, loop, safety-tripwire, tdd]

requires:
  - phase: 164-CONTEXT
    provides: locked LIBX-02 decision (unbounded: true opt-in, keep bounded cap-hit throw, retain global tripwire)
provides:
  - "loop({ unbounded: true, ... }) — an explicit, greppable opt-in for genuinely unbounded games, no longer requiring an arbitrary maxIterations lie"
  - "LoopConfig.unbounded field threaded end-to-end (builders.ts construction guard -> node config -> executeLoop's Infinity fallback)"
  - "Improved construction-guard and cap-hit error messages that name both the bounded and unbounded valves"
  - "Five PROC-01 regression tests (construction-time + runtime) proving the valve works and nothing already-safe regressed"
affects: [164-02, 164-03, 164-04, 166-SKILLDEF-03]

tech-stack:
  added: []
  patterns:
    - "Multi-resume iteration driving: to prove a per-loop iteration counter can exceed the run()-level tripwire's threshold, pause the loop each iteration on an actionStep and drive it forward via many engine.resume() calls from the test — each resume() call resets run()'s own local iteration counter while frame.data.iteration (stored on the persisted stack frame) accumulates across calls. This is the only way to exercise >10000 loop iterations without also tripping the independent whole-flow tripwire, which is gated on the identical DEFAULT_MAX_ITERATIONS constant."

key-files:
  created: []
  modified:
    - src/engine/flow/types.ts
    - src/engine/flow/builders.ts
    - src/engine/flow/engine.ts
    - src/engine/flow/builders.test.ts
    - src/engine/flow/engine.test.ts
    - docs/common-pitfalls.md
    - docs/actions-and-flow.md

key-decisions:
  - "unbounded valve threaded as a plain boolean field on LoopConfig, not a separate loop-construction function, matching CONTEXT's locked decision and the existing loop() single-entry-point convention"
  - "Cap-hit throw message left structurally unchanged except for one appended sentence pointing over-provisioners at unbounded: true — the throw itself, its triggers, and its existing test coverage are untouched"
  - "run()'s whole-flow tripwire (DEFAULT_MAX_ITERATIONS = 10000 total flow-step executions) is completely untouched — it was already structurally independent of any single loop's own iteration counter, so unbounded: true correctly does not disable it"
  - "PROC-01 Test C proves the per-loop iteration counter can exceed 10000 by driving the loop across many engine.resume() calls (each resetting run()'s own local counter) rather than a single continuous run() — this was necessary because a single continuous run() call cannot let the per-loop counter exceed ~half of run()'s own tripwire threshold (each loop iteration costs >=2 run()-level ticks: one for the loop-frame dispatch, one for the body-node dispatch), so within one uninterrupted run() call the two counters cannot both stay under/over their respective thresholds as required by the plan's acceptance criteria"

requirements-completed: [LIBX-02, PROC-01]

duration: 35min
completed: 2026-07-21
---

# Phase 164 Plan 01: loop() unbounded valve (LIBX-02) Summary

**Added an explicit `unbounded: true` opt-in on `loop()` that makes `maxIterations` optional for genuinely unbounded games, while keeping the bounded per-loop cap-hit as a loud safety assertion and the whole-flow runaway tripwire fully intact — verified with five new PROC-01 tests, two of which demonstrably failed against the pre-fix source.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3/3 completed
- **Files modified:** 7

## Accomplishments
- `loop()` no longer forces every game to lie with an arbitrary `maxIterations` cap to express a genuinely unbounded game loop (e.g. a resource-drain game with no fixed round count) — `unbounded: true` is the correct, self-documenting valve.
- Proved (not assumed) that the global whole-flow tripwire in `run()` is structurally independent of any single loop's `maxIterations`/`unbounded` configuration — a stuck unbounded loop still fails loud rather than hanging the process.
- Discovered and worked around a real test-design constraint: within a single uninterrupted `run()` call, a loop's own iteration counter can never exceed roughly half of `run()`'s own tripwire threshold (both gated on `DEFAULT_MAX_ITERATIONS = 10000`, and each loop iteration costs at least two `run()`-level dispatch ticks). Solved by driving the unbounded loop across many `engine.resume()` calls instead of one continuous `run()`.

## Task Commits

Each task was committed atomically:

1. **Task 1: PROC-01 failing tests for the unbounded valve (RED)** - `6ce4e9ba` (test)
2. **Task 2: Implement unbounded valve + improved messages (GREEN)** - `8ade1b0f` (feat)
3. **Task 3: Document the unbounded valve + maxIterations semantics** - `7ed5cd92` (docs)

_TDD gate sequence confirmed: `test(...)` commit (RED) precedes `feat(...)` commit (GREEN); no refactor commit was needed._

## Files Created/Modified
- `src/engine/flow/types.ts` - `LoopConfig.unbounded?: boolean` field with JSDoc noting the global tripwire still applies
- `src/engine/flow/builders.ts` - `loop()` construction guard only throws when `maxIterations === undefined && !unbounded`; message names both the bounded and unbounded forms; threads `unbounded` into the returned node config
- `src/engine/flow/engine.ts` - `executeLoop`'s `maxIterations` falls back to `Infinity` when `unbounded` is set (was unconditionally `DEFAULT_MAX_ITERATIONS`); cap-hit throw message gained one line pointing over-provisioners at `unbounded: true`
- `src/engine/flow/builders.test.ts` - Two new tests: construction does not throw with `unbounded: true`; construction still throws (naming both valves) when neither `maxIterations` nor `unbounded` is provided
- `src/engine/flow/engine.test.ts` - Three new tests: unbounded loop runs past 10000 per-loop iterations via multi-resume driving and exits cleanly on while-false; bounded loop still throws its cap-hit error (no regression); the whole-flow `run()` tripwire still fires for a genuinely stuck unbounded loop within a single continuous `run()` call
- `docs/common-pitfalls.md` - §6 rewritten to document `unbounded: true`, reframe `maxIterations` explicitly as a safety assertion (not a terminator), and describe the global tripwire's independence
- `docs/actions-and-flow.md` - New `unbounded` example alongside the existing `maxIterations` example, cross-referencing Common Pitfalls #6

## Decisions Made
See `key-decisions` in frontmatter above. The most significant is the test-construction technique for Test C (multi-resume driving) — this was not specified verbatim in the plan and was derived from first-principles analysis of `run()`'s and `executeLoop`'s counting mechanics (Prove Before Fix): a single continuous `run()` call cannot let a loop's own iteration counter exceed roughly half of `run()`'s own 10000-tick tripwire, since each loop iteration requires at least two `run()`-level dispatch ticks (one for the loop-frame check+push, one for the body-node dispatch+pop). Resuming via `actionStep` resets `run()`'s local counter each call while `frame.data.iteration` persists on the engine's in-memory stack across calls, letting the loop's cumulative iteration count exceed 10000 without ever tripping the (separately re-armed) whole-flow tripwire — exactly the deconfliction the plan's Test C vs Test E split was asking for.

## Deviations from Plan

None — plan executed exactly as written. Task 1's RED tests required the additional design work described above (multi-resume driving for Test C) to make the literal acceptance criteria achievable, but this falls within the task's own instruction to "distinguish per-loop cap-hit throw never fires" from "the flow can still run past 10000 total steps" — the plan anticipated the distinction; this summary documents how it was operationalized.

## Verification

```
npx vitest run src/engine/flow/builders.test.ts src/engine/flow/engine.test.ts
```
Result: 2 files, 108 tests, all passed.

Acceptance-criteria greps:
- `grep -n "unbounded" src/engine/flow/types.ts src/engine/flow/builders.ts src/engine/flow/engine.ts` — field, guard, threaded config, and doc mentions all present.
- `grep -c "Infinity" src/engine/flow/engine.ts` — 1 (the `executeLoop` fallback line).
- Cap-hit throw block (`engine.ts` ~1287-1304) and `run()`'s whole-flow tripwire (`engine.ts` ~1149-1170) confirmed structurally unchanged (only one added sentence in the cap-hit message; `run()` untouched).

PROC-01 requirement satisfied: Tests A and C independently confirmed to throw against the pre-fix source (construction-time throw and per-loop cap-hit fallback respectively) before the fix landed; all five tests (A-E) pass after the fix, with Tests B/D serving as explicit no-regression guards and Test E proving the global tripwire is not defeated by `unbounded: true`.

Full-suite run deferred to the phase/wave gate per this plan's `<verification>` section (baseline ~2923 tests, not re-run per-plan to avoid redundant full-suite cost).

## Known Stubs

None.

## Threat Flags

None — this plan touches only engine-internal flow control (no new trust boundary), consistent with the plan's own threat model (`(none new)` boundary, `mitigate`/`accept` dispositions already satisfied by the retained global tripwire and the no-regression tests).

## Self-Check: PASSED

- FOUND: src/engine/flow/types.ts (unbounded field present)
- FOUND: src/engine/flow/builders.ts (unbounded guard + threading present)
- FOUND: src/engine/flow/engine.ts (Infinity fallback present)
- FOUND: src/engine/flow/builders.test.ts (Tests A/B present)
- FOUND: src/engine/flow/engine.test.ts (Tests C/D/E present)
- FOUND: docs/common-pitfalls.md (unbounded section present)
- FOUND: docs/actions-and-flow.md (unbounded example present)
- FOUND commit 6ce4e9ba (test)
- FOUND commit 8ade1b0f (feat)
- FOUND commit 7ed5cd92 (docs)
