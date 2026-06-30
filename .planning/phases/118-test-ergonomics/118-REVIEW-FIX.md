---
phase: 118-test-ergonomics
fixed_at: 2026-06-30T18:40:00Z
review_path: .planning/phases/118-test-ergonomics/118-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 118: Code Review Fix Report

**Fixed at:** 2026-06-30T18:40:00Z
**Source review:** .planning/phases/118-test-ergonomics/118-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: `assertActionAvailable` throws false error on simultaneous turns

**Files modified:** `src/testing/assertions.ts`
**Commit:** e21f51b
**Applied fix:** Added import for `canSeatAct` and `availableActionsForSeat` from
`../engine/index.js`. Replaced the `flowState?.currentPlayer !== playerSeat` guard
with `!canSeatAct(flowState, playerSeat)`, and replaced `flowState?.availableActions`
with `availableActionsForSeat(flowState, playerSeat)`. The error message now also
reports `awaitingPlayers` state for better diagnostics in simultaneous-turn games.

### CR-02: `assertActionNotAvailable` silently passes (false pass) on simultaneous turns

**Files modified:** `src/testing/assertions.ts`
**Commit:** aa93996
**Applied fix:** Replaced the `flowState?.currentPlayer !== playerSeat` early-return
guard with `!canSeatAct(flowState, playerSeat)`, and replaced `flowState?.availableActions`
with `availableActionsForSeat(flowState, playerSeat)`. Reuses the same imports added
for CR-01.

### CR-03: `assertFlowState` `actions` check reads sequential-only field, fails on simultaneous turns

**Files modified:** `src/testing/assertions.ts`, `src/testing/simulate-action.ts`
**Commit:** b6c1b7b
**Applied fix:** Exported `_collectAvailableActions` from `simulate-action.ts` (it
already existed as a private helper with the correct logic). Imported it in
`assertions.ts` and used it to build `actual.actions` in `assertFlowState`. This
replaces the direct read of `flowState?.availableActions` (sequential-only) with a
function that unions sequential and simultaneous actions. No logic was duplicated.

### WR-01: `playUntilComplete` discards `doAction` result; `anyMoveMade` set on failure

**Files modified:** `src/testing/simulate-action.ts`
**Commit:** 33f45cc
**Applied fix:** Captured the `ActionExecutionResult` from `doAction`. Only set
`anyMoveMade = true` and incremented `movesExecuted` on `result.success`. On failure,
the failure is recorded in `moveFailures`. After the per-seat loop, if `!anyMoveMade`
AND `moveFailures.length > 0`, throw a specific `GameStuckError` immediately naming
which actions failed and why — distinct from and faster than the generic maxMoves cap.

### WR-02: All loop iterations (including no-ops) consume the `maxMoves` cap

**Files modified:** `src/testing/simulate-action.ts`
**Commit:** be6c044
**Applied fix:** Introduced `movesExecuted` counter (increments only on successful
player moves). Changed loop condition from `i < maxMoves` to `i < maxIterations`
(where `maxIterations = maxMoves * 10`). Added a cap check `if (movesExecuted >= maxMoves) break;`
at the top of each outer iteration so auto-advancing flow iterations do not consume
the player-move budget. Updated JSDoc and error message to document both bounds.
Also fixed a pre-existing flaky test (`maxMoves-iter`) that used `Math.random` without
seeding, by adding `strategy:'first'` to make it deterministic.

### WR-03: `awaitingInput=true` with empty `activeSeats` burns all `maxMoves` before throwing

**Files modified:** `src/testing/simulate-action.ts`
**Commit:** b9ba0ab
**Applied fix:** Added an explicit guard after building `activeSeats`: if `!isComplete()`
AND `activeSeats.length === 0`, throw `GameStuckError` immediately with an actionable
message naming `currentPlayer` and `awaitingPlayers` values. This surfaces the
engine-state inconsistency on the first iteration rather than after maxMoves no-op loops.

### WR-04: JSDoc examples use seat 0 (0-indexed) contradicting "(1-indexed)" API docs

**Files modified:** `src/testing/index.ts`, `src/testing/test-game.ts`
**Commit:** 00cc978
**Applied fix:** Updated all three offending JSDoc examples:
- `src/testing/index.ts:23` — `assertActionSucceeds(game, 0, 'draw')` → `(game, 1, 'draw')`
- `src/testing/index.ts:26` — `currentPlayer: 0` → `currentPlayer: 1`
- `src/testing/test-game.ts:60` — `doAction(0, 'ask', { target: 1, rank: 'K' })` → `doAction(1, 'ask', { target: 2, rank: 'K' })`
- `src/testing/test-game.ts:319` — `game.doAction(0, 'ask', ...)` → `game.doAction(1, 'ask', { target: 2, rank: 'K' })`

## New Tests Added

Tests added in commit 9fe1a27 (`test(118): add regression tests`), then corrected in
d5266ab for accurate semantics:

**assertions.test.ts — simultaneous-turn regression (CR-01/02/03):**
- `BidGame` fixture: 2-player simultaneous game with `bid` and `fold` actions
- `assertActionAvailable — CR-01`: 3 tests verifying correct behavior for active
  simultaneous players and correct error message content
- `assertActionNotAvailable — CR-02`: 3 tests verifying no false passes in simultaneous
  turns, correct pass for inactive seats, and pass after a player completes
- `assertFlowState — CR-03`: 2 tests verifying actions are reported correctly in
  simultaneous turns (contains mode) and that genuinely missing actions still fail

**play-until-complete.test.ts — WR-02 regression:**
- 4 tests under `WR-02 regression — maxMoves bounds player moves`
- Key assertion: simultaneous games complete when all seats act in one iteration;
  sequential games respect the per-iteration cap; error message names "player moves"

## Test Suite Results

- `npx vitest run`: **1811 tests passed, 0 failures, 130 test files** (after all fixes)
- `npx tsc --noEmit`: **0 errors in modified files** (`src/testing/`). Pre-existing
  baseline errors in `src/ui/composables/`, `src/engine/element/`, `src/session/`,
  and `src/ai/` are unchanged.

---

_Fixed: 2026-06-30T18:40:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
