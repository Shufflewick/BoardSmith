---
phase: 118-test-ergonomics
plan: "02"
subsystem: testing
tags: [test-ergonomics, playUntilComplete, GameStuckError, simultaneous-turns, TDD]
dependency_graph:
  requires:
    - "117-04 (enumerateLegalMoves — engine primitive used for move selection)"
  provides:
    - "playUntilComplete(testGame, options?) — one-call game driver"
    - "GameStuckError — structured error with iteration/availableActions/flowState"
    - "PlayUntilCompleteOptions — maxMoves, strategy, rng"
  affects:
    - "src/testing/simulate-action.ts"
    - "src/testing/index.ts"
tech_stack:
  added: []
  patterns:
    - "TDD RED/GREEN — test file committed before implementation"
    - "Canonical seat resolution order (awaitingPlayers before currentPlayer)"
key_files:
  created:
    - src/testing/play-until-complete.test.ts
  modified:
    - src/testing/simulate-action.ts
    - src/testing/index.ts
decisions:
  - "awaitingPlayers checked BEFORE currentPlayer — mirrors dueSeats() in seat-activity.ts; currentPlayer is set even during simultaneous steps and must not be used as the primary gate"
  - "GameStuckError distinguishes dead-end (text/number inputs enumerate to []) from maxMoves exceeded via message wording"
  - "_collectAvailableActions helper centralizes sequential vs simultaneous action gathering for error messages"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-30"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 118 Plan 02: playUntilComplete + GameStuckError Summary

**One-liner:** `playUntilComplete(testGame)` drives sequential and simultaneous games to completion using `enumerateLegalMoves`, throwing a structured `GameStuckError` instead of hanging.

## What Was Built

### `GameStuckError` (src/testing/simulate-action.ts)

Extends `Error` with:
- `readonly name = 'GameStuckError'` — safe for switch/comparisons
- `readonly iteration: number` — 0-based when dead-end; equals `maxMoves` when capped
- `readonly availableActions: string[]` — what the engine considered callable at failure time
- `readonly flowState: FlowState | undefined` — full flow snapshot at moment of failure
- Actionable message distinguishing dead-end vs maxMoves-exceeded

### `playUntilComplete(testGame, options?)` (src/testing/simulate-action.ts)

Options: `maxMoves` (default 1000), `strategy` ('random' | 'first', default 'random'), `rng` (injectable, default Math.random).

Loop algorithm:
1. `if (testGame.isComplete()) return` — exit on completion
2. Skip iteration if `!flowState?.awaitingInput` — auto-advancing flow
3. **Seat resolution (awaitingPlayers before currentPlayer):** if `awaitingPlayers` is non-empty, iterate incomplete entries; otherwise fall back to `currentPlayer`
4. For each active seat: `enumerateLegalMoves(testGame.game, seat)` → pick move → `testGame.doAction`
5. Throw `GameStuckError` if active seats exist but no moves were made
6. After loop: throw `GameStuckError` (maxMoves variant) if still not complete

### Barrel exports (src/testing/index.ts)

Added `playUntilComplete`, `GameStuckError`, `PlayUntilCompleteOptions` to the simulate-action export block.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] awaitingPlayers must be checked before currentPlayer**
- **Found during:** Task 2 (GREEN phase) — simultaneous tests failing with GameStuckError on iteration 1
- **Issue:** `flowState.currentPlayer` is set to the first player even in `simultaneousActionStep` (artifact of engine initialization, not a meaningful signal in simultaneous mode). My initial implementation checked `currentPlayer` first, so it only processed seat 1 each iteration, never advancing seat 2 — causing a loop that ran seat 1 repeatedly until the stuck check fired.
- **Fix:** Changed priority to match the canonical `dueSeats()` in `seat-activity.ts`: check `awaitingPlayers` first (non-empty ⇒ use it), fall back to `currentPlayer` only when `awaitingPlayers` is absent.
- **Files modified:** `src/testing/simulate-action.ts`
- **Commit:** 5e3b439

## Test Coverage

22 tests in `src/testing/play-until-complete.test.ts`:
- Sequential completion (cross-layer integration: testing → engine via enumerateLegalMoves)
- strategy:'first' determinism (two identical runs produce identical total)
- Injectable rng (custom `() => 0` = same as strategy:'first')
- GameStuckError on dead-end (StuckGame with required `enterText` selection — can't enumerate)
- GameStuckError on maxMoves (PickGame with `maxMoves: 1`)
- Simultaneous turns: 2-player and 3-player SimGame — highest-risk behavior, explicitly verified
- GameStuckError class contract (instanceof Error, name, iteration, availableActions, flowState, message)

## Known Stubs

None — all behaviors fully wired.

## Threat Flags

None — in-process test utility only. No network, no auth, no secrets. T-118-02 (DoS/hang) mitigated by `maxMoves` cap and `GameStuckError`.

## Self-Check: PASSED
- `src/testing/play-until-complete.test.ts`: file exists ✓
- `src/testing/simulate-action.ts`: `playUntilComplete` and `GameStuckError` present ✓
- `src/testing/index.ts`: barrel exports added ✓
- Commits 5471187 (test/RED) and 5e3b439 (feat/GREEN) exist ✓
- `npx vitest run src/testing/` → 57 tests, all pass ✓
- `npx tsc --noEmit` → no new errors in changed files ✓
