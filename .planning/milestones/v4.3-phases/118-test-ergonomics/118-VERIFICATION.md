---
phase: 118-test-ergonomics
verified: 2026-06-30T18:45:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 118: Test Ergonomics Verification Report

**Phase Goal:** A test author can read state, drive games to completion, and assert availability without low-level plumbing — with self-explaining failures.
**Verified:** 2026-06-30T18:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | TEST-01: `getPlayerView(seat): PlayerStateView` typed; JSDoc steers away from JSON parsing; hidden-info reuses Phase 117 filter | VERIFIED | `test-game.ts:294` — explicit `: PlayerStateView` annotation; JSDoc documents two patterns and explicitly warns against parsing `view.state` |
| 2 | TEST-02: `playUntilComplete` drives to completion in one call; throws `GameStuckError` (not hang); handles sequential AND simultaneous turns; uses `enumerateLegalMoves`; `maxMoves` bounds player moves with separate safety cap | VERIFIED | `simulate-action.ts:287–433` — `movesExecuted` counts only successful `doAction` calls; `maxIterations = maxMoves * 10` safety cap; `enumerateLegalMoves` imported at line 10 and called at line 358; `awaitingPlayers` checked before `currentPlayer` |
| 3 | TEST-03: Failed `assertActionAvailable` auto-includes trace via `debugActionAvailability` on failure path only; no stale `traceAction` | VERIFIED | `assertions.ts:226` — `debugActionAvailability` called only inside `if (!availableActions.includes(actionName))`; `grep traceAction assertions.ts` returns nothing |
| 4 | TEST-04: `assertFlowState` supports `actionsMode: 'exact'` (default) and `'contains'` | VERIFIED | `assertions.ts:38` — `actionsMode?: 'exact' \| 'contains'`; line 126–132 — extra-actions check gated on `mode === 'exact'`; default via `?? 'exact'` preserves backward compat |
| 5 | TEST-05: `ActionBuilder` + `testGame.action(name, seat)` factory; exposes only enabled choices | VERIFIED | `action-builder.ts` — `getChoices` filters `c.disabled === false` and maps to values (line 69–70); `test-game.ts:259` — `action()` factory returning `new ActionBuilder`; `index.ts:99` — barrel export |
| 6 | CR-01/02/03 simultaneous-turn fixes: `canSeatAct`/`availableActionsForSeat` used in all three assertion helpers | VERIFIED | `assertions.ts:11` — imports `canSeatAct, availableActionsForSeat` from engine; lines 213/266 use `canSeatAct`; line 221/270 use `availableActionsForSeat`; CR-03 uses `_collectAvailableActions` at line 96; BidGame regression suite at `assertions.test.ts:249–327` passes |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/testing/test-game.ts` | `getPlayerView` return type + `action()` factory | VERIFIED | `getPlayerView(playerSeat: number): PlayerStateView` at line 294; `action(actionName, seat): ActionBuilder` at line 259 |
| `src/testing/simulate-action.ts` | `playUntilComplete` + `GameStuckError` + `PlayUntilCompleteOptions` | VERIFIED | All three present; `_collectAvailableActions` helper exported for assertion reuse |
| `src/testing/assertions.ts` | `assertFlowState` with `actionsMode`; `assertActionAvailable`/`NotAvailable` with `canSeatAct` | VERIFIED | All present with CR-01/02/03 fixes applied |
| `src/testing/action-builder.ts` | `ActionBuilder` class with `getChoices`/`select`/`execute`/`buildArgs` | VERIFIED | All four methods present; disabled-choice filter and type-only TestGame import for cycle safety |
| `src/testing/index.ts` | Barrel exports for all new surfaces | VERIFIED | `playUntilComplete`, `GameStuckError`, `PlayUntilCompleteOptions`, `ActionBuilder` all exported; JSDoc examples use seat 1 (WR-04 fix confirmed) |
| `src/testing/test-game.test.ts` | TEST-01 integration tests | VERIFIED | 13 tests covering typed state, hidden-info exclusion, `testGame.game` typed access |
| `src/testing/play-until-complete.test.ts` | TEST-02 tests including simultaneous + `GameStuckError` contract | VERIFIED | 22 tests covering sequential, simultaneous (2p and 3p), strategy, injectable rng, dead-end, maxMoves, error contract |
| `src/testing/assertions.test.ts` | TEST-03 + TEST-04 + CR-01/02/03 regression tests | VERIFIED | 6 existing tests + BidGame simultaneous suite at lines 249–327 |
| `src/testing/action-builder.test.ts` | TEST-05 tests | VERIFIED | 13 tests covering enabled-only choices, dependent selection, `execute`, `buildArgs`, factory |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `assertActionAvailable` | `canSeatAct` / `availableActionsForSeat` | direct import from `../engine/index.js` | WIRED | `assertions.ts:11` — both imported and called on every invocation path |
| `assertActionNotAvailable` | `canSeatAct` / `availableActionsForSeat` | direct import | WIRED | Same import, `canSeatAct` at line 266, `availableActionsForSeat` at line 270 |
| `assertFlowState` | `_collectAvailableActions` | re-exported from `simulate-action.ts` | WIRED | `assertions.ts:12` import; called at line 96 for `actual.actions` — covers both sequential and simultaneous |
| `playUntilComplete` | `enumerateLegalMoves` | engine import | WIRED | `simulate-action.ts:10` import; called at line 358 inside per-seat loop |
| `ActionBuilder.getChoices` | `game.getSelectionChoices` | method call via `_testGame.game` | WIRED | `action-builder.ts:68` — delegates to `game.getSelectionChoices(actionName, selectionName, player, this._args)` |
| `testGame.action()` | `ActionBuilder` constructor | import + `new ActionBuilder(this, ...)` | WIRED | `test-game.ts:16` type-only import; line 260 `new ActionBuilder(this, actionName, seat)` |
| `getPlayerView` | `this.runner.getPlayerView` (Phase 117) | delegation | WIRED | `test-game.ts:295` — body unchanged from Phase 117 implementation |

### Data-Flow Trace (Level 4)

Not applicable — all Phase 118 artifacts are in-process test utilities producing assertion results, not components rendering dynamic data from external sources.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite including all new TEST-01..05 tests | `npx vitest run` | 1811 passed (130 test files) | PASS |
| No `traceAction` in assertions.ts | `grep traceAction src/testing/assertions.ts` | no output | PASS |
| `canSeatAct` imported in assertions.ts | `grep canSeatAct src/testing/assertions.ts` | line 11 (import) + lines 213, 266 | PASS |
| `movesExecuted` counter (WR-02 fix) | `grep movesExecuted src/testing/simulate-action.ts` | 5 lines confirming separate player-move counter | PASS |
| `doAction` result checked before `anyMoveMade` (WR-01 fix) | `grep "result.success" src/testing/simulate-action.ts` | line 365 — `if (result.success) { anyMoveMade = true; }` | PASS |
| `activeSeats.length === 0` early throw (WR-03 fix) | read `simulate-action.ts:341–352` | explicit `GameStuckError` thrown immediately | PASS |
| JSDoc examples use seat 1 not seat 0 (WR-04 fix) | `grep "doAction(0\|assertAction.*0," index.ts test-game.ts` | no output | PASS |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| TEST-01 | Typed observable state without JSON parsing | SATISFIED | `getPlayerView`: PlayerStateView at test-game.ts:294 |
| TEST-02 | `playUntilComplete` with `GameStuckError` + simultaneous support | SATISFIED | simulate-action.ts:287–433; 22 tests in play-until-complete.test.ts |
| TEST-03 | Auto-trace on assertion failure via `debugActionAvailability` | SATISFIED | assertions.ts:226 — failure-path-only, confirmed by spy test |
| TEST-04 | `actionsMode: 'exact' \| 'contains'` on `assertFlowState` | SATISFIED | assertions.ts:38, 126–132 |
| TEST-05 | `ActionBuilder` + `testGame.action()` factory | SATISFIED | action-builder.ts; test-game.ts:259 |

### Anti-Patterns Found

None. No `TBD`, `FIXME`, `XXX`, `HACK`, or `PLACEHOLDER` markers in any modified file. No stub implementations. No empty handlers. No hardcoded empty returns on the happy path.

### Human Verification Required

None — all Phase 118 behavior is automatable via Vitest per VALIDATION.md. The full suite is green at 1811 tests.

### Gaps Summary

No gaps. All six must-haves verified across code structure, wiring, data-flow, and behavioral spot-checks.

**Notable:** The code-review report (118-REVIEW.md) identified three critical issues (CR-01/02/03) and four warnings (WR-01..04) after the initial four plan executions. All seven issues were fixed before this verification:

- CR-01: `assertActionAvailable` false error on simultaneous turns — fixed with `canSeatAct`
- CR-02: `assertActionNotAvailable` silent false pass on simultaneous turns — fixed with `canSeatAct`
- CR-03: `assertFlowState` actions check broken for simultaneous turns — fixed with `_collectAvailableActions`
- WR-01: `doAction` result discarded — fixed; `anyMoveMade` only set on `result.success`
- WR-02: All loop iterations consuming `maxMoves` cap — fixed with separate `movesExecuted` counter and `maxIterations` safety cap
- WR-03: `awaitingInput=true` with empty `activeSeats` burning full budget — fixed with early `GameStuckError` throw
- WR-04: JSDoc examples using seat 0 — fixed to seat 1 in both `index.ts` and `test-game.ts`

---

_Verified: 2026-06-30T18:45:00Z_
_Verifier: Claude (gsd-verifier)_
