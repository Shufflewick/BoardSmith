---
phase: 133-engine-flow-action-validation
plan: 02
subsystem: engine
tags: [flow-engine, eachPlayer, turn-order, regression-test]

# Dependency graph
requires:
  - phase: 133-01
    provides: "PROC-01 findings verification gate — F4/ENG-02 confirmed LEGITIMATE with exact file:line evidence"
provides:
  - "executeEachPlayer eligibleSeats wrap-around construction (unconditional, no opt-out)"
  - "Corrected TurnOrder preset JSDoc (module note, CONTINUE, START_FROM) matching wrapped behavior"
  - "Red-first regression test for ENG-02 startingPlayer wrap-around"
affects: [133-03, 133-04, 133-05, 139-docx-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "eachPlayer eligibleSeats built via [...slice(startIndex), ...slice(0, startIndex)] — unconditional wrap, no startIndex===0 special case (degenerate case handled naturally by empty second slice)"

key-files:
  created: []
  modified:
    - src/engine/flow/engine.ts
    - src/engine/flow/engine.test.ts
    - src/engine/flow/turn-order.ts

key-decisions:
  - "Wrap is unconditionally on with no wrap:false opt-out, per locked v4.5 decision — truncation was never a sane board-game semantic"
  - "No startIndex === 0 branch added; slice(0) + slice(0,0) already degenerates to the full original list"
  - "docs/common-patterns.md dealer-rotation pattern required no edits — it never contained a 'does not wrap' caveat, only the turn-order.ts JSDoc did"

patterns-established:
  - "Red-first regression test pattern for flow-engine bugs: build a multi-player TestGame inline in the test (not the shared beforeEach game) when the bug only manifests at player counts >= 4"

requirements-completed: [ENG-02, PROC-02]

duration: 3min
completed: 2026-07-03
---

# Phase 133 Plan 02: eachPlayer startingPlayer Wrap-Around Fix Summary

**Fixed `executeEachPlayer` to wrap the full player list when `startingPlayer` is set, so every player gets a turn in the round instead of silently dropping seats before the starting index.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-03T14:15:04Z
- **Completed:** 2026-07-03T14:17:48Z
- **Tasks:** 2
- **Files modified:** 3 (engine.ts, engine.test.ts, turn-order.ts)

## Accomplishments
- `eligibleSeats` construction in `executeEachPlayer` changed from `players.slice(startIndex)` (truncating) to `[...players.slice(startIndex), ...players.slice(0, startIndex)]` (wrapping) — a single-expression fix at the one chokepoint every `eachPlayer` caller (including all `TurnOrder` presets) shares
- Red-first regression test: 4-player game with `startingPlayer` at seat 3 asserts visited order `[3, 4, 1, 2]` (wrapped), with a no-startingPlayer control asserting `[1, 2, 3, 4]` is unchanged
- Stale "does NOT wrap around" / "manually structure your flow" JSDoc removed from `turn-order.ts` (module note, `CONTINUE`, `START_FROM`); `LEFT_OF_DEALER`'s unrelated `nextAfter` dealer-advance example left intact
- `docs/common-patterns.md` dealer-rotation pattern verified — it never contained a "does not wrap" caveat, so no edit was needed there

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — regression test for eachPlayer startingPlayer wrap-around** - `9365460` (test)
2. **Task 2: GREEN — eligibleSeats wrap fix + preset/pattern doc corrections** - `ab0ac93` (fix)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/engine/flow/engine.ts` - `executeEachPlayer`'s `eligibleSeats` now wraps around the full player list
- `src/engine/flow/engine.test.ts` - new `ENG-02 startingPlayer wrap-around` describe block (2 tests); updated 2 pre-existing `Turn Order Presets` tests (`START_FROM`, `CONTINUE`) that asserted the old truncating behavior
- `src/engine/flow/turn-order.ts` - corrected module-level, `CONTINUE`, and `START_FROM` JSDoc to state wrap-around behavior instead of the stale "does NOT wrap around" claim

## Decisions Made
- Wrap is unconditional, no `wrap: false` opt-out (matches the locked v4.5 roadmap decision) — a dealer-relative round must visit everyone
- No `startIndex === 0` special case added; the concat expression naturally degenerates to the original array when `startIndex` is 0

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated two pre-existing Turn Order Presets tests that asserted the old truncating behavior**
- **Found during:** Task 2 (running `npx vitest run src/engine/flow/engine.test.ts src/engine/action/action.test.ts` after the fix)
- **Issue:** `should use START_FROM with position (no wrap-around)` and `should use CONTINUE from current player` asserted the truncated seat lists (`[2, 3]` and `[3]` respectively) that the fix intentionally changes to wrapped lists
- **Fix:** Updated both tests' expected output to the correct wrapped order (`[2, 3, 1]` and `[3, 1, 2]`), renamed the first test to `(wraps around)` and the second to `(wraps around)` to match, and updated their inline comments
- **Files modified:** src/engine/flow/engine.test.ts
- **Verification:** `npx vitest run src/engine/flow/engine.test.ts src/engine/action/action.test.ts` green (214/214); full suite `npm test` green (168 files / 2150 tests)
- **Committed in:** ab0ac93 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — pre-existing tests asserting the now-fixed truncation bug as expected behavior)
**Impact on plan:** Necessary correctness fix; these tests were locking in the exact defect ENG-02 fixes. No scope creep — same file already listed in the plan's `files_modified`.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ENG-02 (F4, critical) fully resolved: `eachPlayer`/`TurnOrder` presets now wrap correctly for every caller, with regression coverage
- Full suite baseline confirmed unchanged at wave close: 168 files / 2150 tests green
- Plans 133-03 (ENG-03 simultaneousActionStep actionError), 133-04 (ENG-04 choice multiSelect), 133-05 (ENG-07 switchOn) are unblocked and independent of this fix

---
*Phase: 133-engine-flow-action-validation*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: commit 9365460 (Task 1 RED test)
- FOUND: commit ab0ac93 (Task 2 GREEN fix)
- FOUND: 133-02-SUMMARY.md
- FOUND: `slice(0, startIndex)` in src/engine/flow/engine.ts:1127
