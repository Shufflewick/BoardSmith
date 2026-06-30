---
phase: 118-test-ergonomics
reviewed: 2026-06-30T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/testing/simulate-action.ts
  - src/testing/action-builder.ts
  - src/testing/assertions.ts
  - src/testing/test-game.ts
  - src/testing/index.ts
findings:
  critical: 3
  warning: 4
  info: 0
  total: 7
status: issues_found
---

# Phase 118: Code Review Report

**Reviewed:** 2026-06-30T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This review covers the TEST-01..05 test-ergonomics API: `playUntilComplete`+`GameStuckError`,
`ActionBuilder`, assertion trace wiring, and `actionsMode`. The implementation is generally
well-structured, with correct simultaneous/sequential seat precedence in `playUntilComplete`
and a sound `ActionBuilder` design. However, three of the five assertion helpers in
`assertions.ts` read sequential-only fields from `FlowState` without falling back to
`awaitingPlayers`, making them produce wrong results — either false errors or silent false
passes — in any game that uses simultaneous-action steps. This family of bugs is the
most serious concern. `playUntilComplete` has four secondary quality issues around
loop semantics and a discarded action result that could mask failures.

Note: `AnnotatedChoice.disabled: string | false` is typed without `undefined`, so
`ActionBuilder.getChoices()`'s `disabled === false` filter is correct.

---

## Critical Issues

### CR-01: `assertActionAvailable` throws false error on simultaneous turns

**File:** `src/testing/assertions.ts:207`

**Issue:** The function uses `flowState?.currentPlayer !== playerSeat` as the gate before
checking available actions. In a simultaneous-action step, `currentPlayer` is `undefined`
(the flow engine sets `awaitingPlayers` instead). So when a test calls
`assertActionAvailable(testGame, 2, 'bid')` during a simultaneous step, the guard fires
and throws:

```
Cannot check action availability for player 2 - current player is undefined
```

— even though player 2 IS active and 'bid' IS available via `awaitingPlayers`. Any test
that asserts on action availability in a simultaneous game will throw a false failure and
can never pass.

The canonical predicate for "can seat N act?" is `canSeatAct`/`availableActionsForSeat`
from `seat-activity.ts`, which already handles both sequential and simultaneous modes and
is used consistently by the engine, session, and MCTS bot. The assertion should route
through it.

**Fix:**
```typescript
export function assertActionAvailable(
  testGame: TestGame,
  playerSeat: number,
  actionName: string
): void {
  const flowState = testGame.getFlowState();
  const { canSeatAct, availableActionsForSeat } = await import('../engine/index.js');
  // Simpler: import the helper at the top of the file

  if (!canSeatAct(flowState, playerSeat)) {
    throw new Error(
      `Cannot check action availability for player ${playerSeat} — seat is not active. ` +
      `currentPlayer=${flowState?.currentPlayer}, ` +
      `awaitingPlayers=${JSON.stringify(flowState?.awaitingPlayers ?? [])}`
    );
  }

  const availableActions = availableActionsForSeat(flowState, playerSeat);
  if (!availableActions.includes(actionName)) {
    const player = testGame.getPlayer(playerSeat);
    const debugInfo = testGame.game.debugActionAvailability(actionName, player);
    // ... rest unchanged
  }
}
```

---

### CR-02: `assertActionNotAvailable` silently passes (false pass) on simultaneous turns

**File:** `src/testing/assertions.ts:256`

**Issue:** The early-return guard is:

```typescript
if (flowState?.currentPlayer !== playerSeat) {
  return; // Action is definitely not available
}
```

In a simultaneous-action step `currentPlayer` is `undefined`, so `undefined !== playerSeat`
is `true` for any real seat number, and the function silently returns — claiming the action
is NOT available. But the player IS active via `awaitingPlayers` and the action may well be
available. This is a silent false pass: the assertion says the action is unavailable when
it actually is. Any invariant test of "player cannot bid out of turn" in a simultaneous
game will pass incorrectly, masking the bug it was meant to catch.

**Fix:**
```typescript
export function assertActionNotAvailable(
  testGame: TestGame,
  playerSeat: number,
  actionName: string
): void {
  const flowState = testGame.getFlowState();

  // Seat cannot act at all — action is definitely not available.
  if (!canSeatAct(flowState, playerSeat)) return;

  const availableActions = availableActionsForSeat(flowState, playerSeat);
  if (availableActions.includes(actionName)) {
    throw new Error(
      `Action "${actionName}" should NOT be available for player ${playerSeat}, but it is`
    );
  }
}
```

---

### CR-03: `assertFlowState` `actions` check reads sequential-only field, fails silently on simultaneous turns

**File:** `src/testing/assertions.ts:93`

**Issue:** The `actual` object is built as:

```typescript
const actual = {
  actions: flowState?.availableActions,
  ...
};
```

`FlowState.availableActions` is only populated for sequential-turn action steps. For
simultaneous-action steps it is `undefined`. So when a test passes `expected.actions`
in a simultaneous-turn game:

```typescript
assertFlowState(testGame, { actions: ['bid', 'pass'] });
```

`actualActions` resolves to `[]`, and every action in `expected.actions` is reported as
missing even though those actions ARE available via `awaitingPlayers[*].availableActions`.
This produces a false failure — the assertion cannot be used for simultaneous-turn games
at all.

**Fix:** Use the same `_collectAvailableActions` helper that `playUntilComplete` already
uses (or expose `availableActionsForSeat` via a seat-agnostic union), so both sequential
and simultaneous states are covered:

```typescript
// At the top of assertFlowState, after building flowState:
import { availableActionsForSeat } from '../engine/index.js';

// Collect union of all currently-available actions (handles both modes).
function collectAllAvailableActions(flowState: FlowState | undefined): string[] {
  if (!flowState) return [];
  if (flowState.availableActions && flowState.availableActions.length > 0) {
    return flowState.availableActions;
  }
  if (flowState.awaitingPlayers) {
    const seen = new Set<string>();
    for (const p of flowState.awaitingPlayers) {
      if (!p.completed) p.availableActions.forEach(a => seen.add(a));
    }
    return [...seen];
  }
  return [];
}

const actual = {
  actions: collectAllAvailableActions(flowState),
  ...
};
```

---

## Warnings

### WR-01: `playUntilComplete` discards `doAction` result; `anyMoveMade` set on failure

**File:** `src/testing/simulate-action.ts:322-324`

**Issue:**
```typescript
testGame.doAction(seat, move.action, move.args);
anyMoveMade = true;
```

The `ActionExecutionResult` is discarded. `anyMoveMade` is set to `true` regardless of
whether the action succeeded or failed. If `doAction` returns `{ success: false }` (e.g.,
a validation rule that `enumerateLegalMoves` doesn't fully model, or a tutorial-gate
disabled action), the loop skips the dead-end check because `anyMoveMade` is already
`true`. On the next iteration, `enumerateLegalMoves` returns the same "legal" moves and
they fail again. This repeats silently for 1000 iterations before throwing the generic
maxMoves cap error, with no mention that every attempted move failed.

**Fix:** Check the result and only set `anyMoveMade` on success. Log or surface a
diagnostic on repeated failure:
```typescript
const result = testGame.doAction(seat, move.action, move.args);
if (result.success) {
  anyMoveMade = true;
} // If not successful, fall through — dead-end check will fire if all seats fail.
```

---

### WR-02: All loop iterations (including no-ops) consume the `maxMoves` cap

**File:** `src/testing/simulate-action.ts:285-291`

**Issue:** The option is documented as `"Maximum number of move-selection iterations"` but
the loop counter `i` increments on every pass — including the `continue` branch when
`!flowState?.awaitingInput` (auto-advancing flow). A game with 700 auto-advancing flow
steps (e.g., an initial deal loop in a card game) followed by 500 player moves would
exhaust the default cap of 1000 before all player moves complete, throwing a false
`GameStuckError("Game did not complete after 1000 moves")` even though the game is
progressing normally.

The semantic mismatch makes the option name misleading: callers who read the docs and set
`maxMoves: 200` for "up to 200 player moves" will actually get far fewer player moves if
the game has any auto-advancing phases.

**Fix option A (preferred):** Count only iterations where `anyMoveMade` becomes `true`:
```typescript
let movesExecuted = 0;
for (let i = 0; movesExecuted < maxMoves; i++) {
  if (testGame.isComplete()) return;
  const flowState = testGame.getFlowState();
  if (!flowState?.awaitingInput) continue;
  // ... pick move ...
  if (anyMoveMade) movesExecuted++;
}
```

**Fix option B:** Keep current semantics but rename the option to `maxIterations` and
update the JSDoc accordingly, so authors know the cap covers all loop passes, not just
player moves.

---

### WR-03: `awaitingInput=true` with empty `activeSeats` burns all `maxMoves` before throwing

**File:** `src/testing/simulate-action.ts:330`

**Issue:** The dead-end guard is:
```typescript
if (!anyMoveMade && activeSeats.length > 0 && !testGame.isComplete()) {
```

When `flowState.awaitingInput` is `true` but both `awaitingPlayers` is absent/empty AND
`currentPlayer` is `undefined`, `activeSeats` is `[]`. The condition requires
`activeSeats.length > 0`, so the dead-end check is skipped. The loop burns through all
remaining `maxMoves` iterations doing nothing, then throws the generic maxMoves cap error
with `"unknown seat still active"` — 1000 no-op iterations before the diagnostic fires.

While this state represents an engine invariant violation (if `awaitingInput` is true,
at least one seat should be determinable), the error should still surface immediately rather
than wasting iterations.

**Fix:** Add an explicit check after building `activeSeats`:
```typescript
if (flowState.awaitingInput && activeSeats.length === 0 && !testGame.isComplete()) {
  const availableActions = _collectAvailableActions(flowState);
  throw new GameStuckError(
    `Game stuck at iteration ${i}: flow reports awaitingInput but no active seats ` +
    `could be determined (currentPlayer=undefined, awaitingPlayers=[]). ` +
    `This is likely an engine-state inconsistency.`,
    i,
    availableActions,
    flowState,
  );
}
```

---

### WR-04: JSDoc examples use seat 0 (0-indexed) contradicting "(1-indexed)" API docs

**File:** `src/testing/index.ts:24`, `src/testing/test-game.ts:60`

**Issue:** Every function in the testing module documents `playerSeat` as `"(1-indexed)"`.
The actual test files (`assertions.test.ts`, `action-builder.test.ts`) correctly use
seats 1, 2. But two module-level JSDoc examples use seat `0`:

- `src/testing/index.ts:24`: `assertActionSucceeds(game, 0, 'draw')`
- `src/testing/test-game.ts:60`: `testGame.doAction(0, 'ask', { target: 1, rank: 'K' })`

A developer copy-pasting either example will get a `Player 0 not found` error (since
`getPlayer(0)` returns `undefined` and `TestGame.getPlayer` throws). This is
particularly harmful in a library whose test module is meant to reduce friction for new
game authors.

**Fix:** Change both examples to use seat `1`:
- `src/testing/index.ts:24`: `assertActionSucceeds(game, 1, 'draw')`
- `src/testing/test-game.ts:60`: `testGame.doAction(1, 'ask', { target: 2, rank: 'K' })`

---

_Reviewed: 2026-06-30T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
