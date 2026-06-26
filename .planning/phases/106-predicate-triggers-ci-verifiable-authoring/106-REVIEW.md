---
phase: 106-predicate-triggers-ci-verifiable-authoring
reviewed: 2026-06-26T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/engine/action/action.ts
  - src/engine/index.ts
  - src/engine/tutorial/gate.ts
  - src/engine/tutorial/predicates.ts
  - src/engine/tutorial/progress.ts
  - src/engine/tutorial/types.ts
  - src/session/game-session.ts
  - src/session/tutorial-controller.ts
  - src/session/types.ts
  - src/testing/index.ts
  - src/testing/simulate-tutorial.ts
  - src/testing/tutorial-assertions.ts
findings:
  critical: 2
  warning: 4
  info: 1
  total: 7
status: issues_found
---

# Phase 106: Code Review Report

**Reviewed:** 2026-06-26
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 106 adds `advanceWhen` predicate helpers (`afterFirstTurn`, `afterTurns`, `whenForced`), the `autoAdvanceTutorial` pump, and the `simulateTutorial` CI DSL. The architecture is clean and the predicate evaluation reuse via `evaluateConditionWithTrace` is a good pattern. Two blockers exist at the session layer: the save/advance ordering in `performAction` leaves tutorial progress out of the persisted snapshot, and AI actions entirely bypass the tutorial advance hook. Four warnings round out authoring-correctness and test-reliability gaps.

---

## Critical Issues

### CR-01: Tutorial auto-advance not persisted — snapshot captured before `autoAdvanceTutorial` runs

**File:** `src/session/game-session.ts:903-921`

**Issue:** In `performAction`, `#save()` (line 903) captures the snapshot and writes it to storage BEFORE the `autoAdvanceTutorial` loop (lines 913–921) runs. Because `tutorialProgress` is serialized durable state in the snapshot, any step advance triggered by `advanceWhen` predicates is NOT included in what was just persisted. If the server crashes or process restarts between the advance (line 918) and the next action-triggered `#save()`, the restored game has tutorial progress at the pre-advance step. The learner would experience the step they already completed replaying, and any gate from the advanced step would not apply until the predicate fires again on the next action.

The same gap exists in the `broadcast()` comment path — `broadcast()` is also called before `autoAdvanceTutorial`, so any save triggered by the broadcast hook reads stale progress.

**Fix:** Move `await this.#save()` to after the auto-advance block, or add a second save when any seat advanced:

```typescript
// Persist (pre-advance snapshot — current position)
await this.#save();
this.broadcast();

// Post-action auto-advance
{
  const game = this.#runner.game;
  let anyAdvanced = false;
  for (const [seat, progress] of game.tutorialProgress) {
    if (progress.status !== 'running') continue;
    const { advanced } = autoAdvanceTutorial(game, seat);
    if (advanced) anyAdvanced = true;
  }
  if (anyAdvanced) {
    await this.#save();   // <-- persist the advanced progress
    this.broadcast();
  }
}
```

---

### CR-02: AI actions entirely bypass tutorial auto-advance

**File:** `src/session/game-session.ts:1643`

**Issue:** `#checkAITurn` calls `this.#runner.performAction(action, player, args)` directly (not `this.performAction`). The `autoAdvanceTutorial` post-action hook lives in `performAction`. This means opponent AI moves never trigger `advanceWhen` predicate evaluation for any seat.

The `performAction` comment explicitly acknowledges: *"An opponent's action can satisfy a learner's predicate, so we iterate ALL running-tutorial seats."* But the AI path is not wired to this logic, silently breaking all predicates that depend on opponent turns.

Practical impact: `afterTurns(2)` in a 2-player game (learner + AI) will never fire because the AI's "turn" is invisible to the tutorial subsystem. Any multi-turn predicate that the learner cannot complete alone is permanently stuck.

**Fix:** Add the advance pump to the AI callback, mirroring `performAction`:

```typescript
async (action, player, args) => {
  const result = this.#runner.performAction(action, player, args);
  if (result.success) {
    this.#storedState.actionHistory = this.#runner.actionHistory;
    // Auto-advance tutorial for all running seats, then save.
    const game = this.#runner.game;
    for (const [seat, progress] of game.tutorialProgress) {
      if (progress.status === 'running') autoAdvanceTutorial(game, seat);
    }
    await this.#save();
    this.broadcast();
    return true;
  }
  return false;
}
```

---

## Warnings

### WR-01: `nextProgress` silently falls back to step 0 for unknown step IDs

**File:** `src/engine/tutorial/progress.ts:54`

**Issue:** When `currentStepId` is non-null but not found in `def.steps` (e.g., stale data after a tutorial definition refactor), `findIndex` returns -1, `resolvedIndex` becomes 0, and the function advances to step index 1 — silently skipping step 0 without signaling any error. The comment says "guards against stale state," but the silent skip directly contradicts the project's fail-loud mandate and could cause the tutorial to advance to the wrong step without the learner or author noticing.

The caller in `TutorialController.#forwardAdvance` would silently set progress to step 2 when the stored `stepId` is unrecognized:

```typescript
const resolvedIndex = currentIndex === -1 ? 0 : currentIndex;  // silent fallback
```

**Fix:** Throw on a stale ID so authors get an actionable error rather than corrupted progress:

```typescript
if (currentStepId !== null && currentIndex === -1) {
  throw new Error(
    `Tutorial step '${currentStepId}' not found in the tutorial definition. ` +
    `If you renamed or removed this step, update the persisted tutorialProgress. ` +
    `Known steps: [${def.steps.map(s => s.id).join(', ')}]`
  );
}
```

---

### WR-02: Multi-seat gate-drift detection silently skips uninitialized seats in `simulateTutorial`

**File:** `src/testing/simulate-tutorial.ts:206-213`

**Issue:** `simulateTutorial` initializes tutorial progress only for the primary `seat` (line 177). When a `TutorialScenarioMove` overrides `seat` to a different player, Step A checks:

```typescript
const disabledActions = testGame.game.getTutorialDisabledActions(moveSeat);
```

But `getTutorialDisabledActions` calls `getActiveStep` for `moveSeat`, which returns `null` when no progress exists for that seat, causing `getActionLevelDisabledReasons` to return `{}`. The gate-drift check silently passes for any move with an overridden seat that was never initialized. A gate that should block the action is never evaluated, giving a false green result.

This means Drift Dimension 1 (gate drift) is not enforced for non-primary seats in multi-seat scenarios.

**Fix:** Initialize tutorial progress for all seats that appear in the scenario before executing moves:

```typescript
// Collect all seats referenced in the scenario
const scenarioSeats = new Set<number>([seat, ...scenario.map(m => m.seat).filter((s): s is number => s !== undefined)]);
for (const s of scenarioSeats) {
  if (!testGame.game.tutorialProgress.has(s)) {
    testGame.game.tutorialProgress.set(s, initialProgress(tutorialDef));
  }
}
```

---

### WR-03: `afterTurns` has no validation for non-positive `n`

**File:** `src/engine/tutorial/predicates.ts:87`

**Issue:** `afterTurns(n)` accepts any number. When `n <= 0`:
- `afterTurns(0)`: at game start, `roundsStarted = 1` (first loop iteration already begun), `learnerActedThisRound = false` → `completedTurns = 0 >= 0` → fires immediately, auto-advancing the step before the learner takes any action.
- `afterTurns(-5)`: `completedTurns >= -5` is always true, firing on the first evaluation.

Both cause the tutorial to silently skip steps, potentially bypassing teaching beats entirely with no error.

**Fix:** Add an early guard:

```typescript
export function afterTurns(n: number): TutorialAdvanceCondition {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `afterTurns(n): n must be a positive integer, got ${n}. ` +
      `Use afterFirstTurn() for n=1, or afterTurns(2), afterTurns(3), etc.`
    );
  }
  // ... existing implementation
}
```

---

### WR-04: `resolveSeatForPlayer` returns 0-indexed positions from the `playerIds` fallback, inconsistent with the lobby path's 1-indexed seats

**File:** `src/session/game-session.ts:1725-1726`

**Issue:** The lobby path (`this.getSeatForPlayer`) returns 1-indexed seats (1, 2, …). The `playerIds` fallback path returns:

```typescript
const idx = ids.indexOf(playerId);
if (idx >= 0) return idx;   // 0-indexed: player 1 → 0, player 2 → 1
```

A player whose ID is at `playerIds[0]` (the first player) gets seat `0` returned. Throughout the codebase, seat `0` is the spectator position (e.g., `broadcast()` uses `effectivePosition = session.isSpectator ? 0 : session.playerSeat`; `performAction` rejects `player < 1`). The first player identified via the `playerIds` fallback will be treated as a spectator and cannot perform actions.

The inconsistency also shifts all subsequent players: `playerIds[1]` returns `1` (treated as player 1's seat), `playerIds[2]` returns `2` (treated as player 2), etc. — every player in a non-lobby game gets the wrong seat.

**Fix:**

```typescript
if (idx >= 0) return idx + 1;  // Convert 0-indexed array position to 1-indexed seat
```

---

## Info

### IN-01: `assertTutorialStep` error message misleads when called with result overload and a non-primary seat

**File:** `src/testing/tutorial-assertions.ts:62-67`

**Issue:** The docstring explicitly states the `seat` parameter is "ignored" when a `SimulateTutorialResult` is passed. However, the thrown error still reads `Tutorial step assertion failed for seat ${seat}`. If a caller passes `seat: 2` while the result is tracking seat 1 (the primary), the error message says "for seat 2" — but the checked value is seat 1's `finalStepId`. This misleads the test author about which seat failed.

**Fix:** Clarify the message for the result overload:

```typescript
if (isSimulateTutorialResult(testGameOrResult)) {
  actualStepId = testGameOrResult.finalStepId;
  if (actualStepId !== expectedStepId) {
    throw new Error(
      `Tutorial step assertion failed (checking result.finalStepId, seat argument ignored): ` +
      `expected '${expectedStepId}', got '${actualStepId ?? 'none'}'. ` +
      `Check your scenario or advanceWhen predicate.`,
    );
  }
  return;
}
```

---

_Reviewed: 2026-06-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
