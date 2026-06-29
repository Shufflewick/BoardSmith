---
phase: 109-checkers-tutorial-content
reviewed: 2026-06-28T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/engine/tutorial/types.ts
  - src/engine/tutorial/gate.ts
  - src/engine/action/action.ts
  - src/engine/index.ts
  - src/session/stateless-ops.ts
  - src/session/types.ts
  - src/session/utils.ts
  - src/cli/dev-host/bridge.ts
  - src/cli/commands/dev.ts
  - src/testing/test-game.ts
  - src/ui/components/ControlsMenu.vue
  - src/ui/components/GameShell.vue
  - ~/BoardSmithGames/checkers/src/rules/tutorial.ts
  - ~/BoardSmithGames/checkers/src/rules/game.ts
  - ~/BoardSmithGames/checkers/src/rules/index.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 109: Code Review Report

**Reviewed:** 2026-06-28
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

The checkers tutorial content, per-selection name gating (`SelectionMatcher` / `selectionMatchesValue`), the `start-tutorial` stateless op, `hasTutorial` broadcast signal, and `TestGameOptions` index-signature forwarding were all reviewed. The checkers-repo additions (tutorial definition, deterministic preset, registration) look structurally sound. The substrate wiring, however, has one critical gap and two quality warnings that should be addressed before the tutorial is considered functional in the dev environment.

The single **critical** finding is that `autoAdvanceTutorial` — the post-action pump that evaluates `advanceWhen` predicates and advances the active tutorial step — is completely absent from `stateless-ops.ts`. Every non-test execution path that runs through `SnapshotSessionHost` → `executeOp` (i.e., `boardsmith dev` and the stateless executor used in production) never triggers tutorial step advancement. This silently breaks the entire checkers tutorial in the dev environment: after the two-jump capture chain completes, `endTurn` is blocked by the stale `capture-tip` gate, leaving the player stuck.

Three warnings cover: missing seat validation on `startTutorial`, a silent failure mode for primitive choice values in `selectionMatchesValue`, and unnecessary `as any` casts for `tutorialDefinition` reattachment. Two info items address ordering and documentation.

---

## Critical Issues

### CR-01: `autoAdvanceTutorial` is never called from the stateless ops path — tutorial steps never advance in `boardsmith dev`

**File:** `src/session/stateless-ops.ts:243` (`handleAction`) and `stateless-ops.ts:733` (`startTutorial` case)

**Issue:** `autoAdvanceTutorial` is imported and called only in `game-session.ts` (lines 1246 and 1995 — after player actions and after AI actions respectively). It is **never called** in `stateless-ops.ts` nor in `SnapshotSessionHost`. Since `boardsmith dev` routes all ops through `MultiplayerHost` → `SnapshotSessionHost` → `executeOp`, no `advanceWhen` predicate is ever evaluated and no tutorial step ever advances in the dev environment.

Concrete consequence for the checkers tutorial:

1. Player starts tutorial → `capture-tip` becomes the active step (gate: `{ action: 'move' }`)
2. Player performs the forced two-jump capture chain (b6→d4, then d4→b2) — allowed because `capture-tip` only restricts the action name, not selections
3. After b2, `continuingPiece` is null and `hasMovedThisTurn` is true; the flow now offers `endTurn`
4. `endTurn` is **blocked** by the `capture-tip` gate — the tutorial is still on that step because `autoAdvanceTutorial` was never called
5. **The player is stuck and cannot end their turn**

The test suite passes because `simulate-tutorial.ts` manually calls `autoAdvanceTutorial` after each action (line 240), explicitly compensating for this missing call. The test comment at line 204 states "the session post-start hook calls `autoAdvanceTutorial` before the first player action" — no such hook exists in `game-session.ts`'s `startTutorial()` either, but in the production path the first auto-advance fires after the player's first action, which is sufficient. Only the stateless path is broken.

The known deviation (dropping the `destination: { toNotation: 'd4' }` gate from `execute-capture`) is a *consequence* of this bug, not an independent issue. The comment in `tutorial.ts` explains it as a synchronous-followUp ordering problem, but that framing is incorrect: the destination selection is a separate client round-trip, so `autoAdvanceTutorial` would run between the capture and the destination selection — making the gate safe. Restoring the execute-capture destination gate is correct only after fixing this root cause.

**Fix:**

In `stateless-ops.ts`, import `autoAdvanceTutorial` and call it after every state-mutating action:

```typescript
// Add import at the top of stateless-ops.ts
import { validateTutorialDefinition, initialProgress, autoAdvanceTutorial } from '../engine/tutorial/progress.js';

// In handleAction, after runner.performAction succeeds:
function handleAction(def, gameOptions, snapshot, op): OpResult {
  const runner = runnerFromSnapshot(snapshot, def);
  const actionResult = runner.performAction(op.actionName, op.player, op.args);
  if (!actionResult.success) return errorResult(actionResult.error ?? 'Action failed');

  // Mirror game-session.ts: advance tutorial for all running-tutorial seats.
  const game = runner.game as Game;
  for (const [seat, progress] of game.tutorialProgress) {
    if (progress.status === 'running') {
      autoAdvanceTutorial(game, seat);
    }
  }
  // ... rest unchanged
}
```

Apply the same pattern in `handleSelectionStep` (after a completed action) and in the `startTutorial` case (after setting initial progress, to fire the initial `advanceWhen` pump that advances `capture-tip`). Also correct the `simulate-tutorial.ts` comment at line 204: the production session fires auto-advance on the first player action, not at start.

---

## Warnings

### WR-01: `startTutorial` op has no seat range validation — invalid seats pollute `tutorialProgress`

**File:** `src/session/stateless-ops.ts:733`

**Issue:** The `startTutorial` case calls `runner.game.tutorialProgress.set(op.player, ...)` without checking that `op.player >= 1 && op.player <= gameOptions.playerCount`. Other ops that accept a player seat perform this check (e.g. `handleDebugActionTraces` at line 592: `if (op.player < 1 || op.player > gameOptions.playerCount)`). A spectator (seat 0) clicking "Start tutorial" — which is shown to spectators because `hasTutorial` is broadcast with no seat guard — sends `{ type: 'startTutorial', player: 0 }`. This sets `tutorialProgress` for seat 0 in the snapshot. While `buildPlayerState` already guards `if (playerPosition > 0)` for tutorial projection, the stale entry in the serialized Map persists in subsequent snapshots and violates the fail-loud invariant.

**Fix:**
```typescript
case 'startTutorial': {
  if (!def.tutorial) {
    return errorResult('No tutorial definition on this game.', 'protocol');
  }
  // Add this guard — mirrors handleDebugActionTraces validation
  if (op.player < 1 || op.player > gameOptions.playerCount) {
    return errorResult(
      `Invalid player seat ${op.player}: must be between 1 and ${gameOptions.playerCount}.`,
      'protocol',
    );
  }
  const runner = runnerFromSnapshot(snap, def);
  validateTutorialDefinition(def.tutorial);
  runner.game.tutorialProgress.set(op.player, initialProgress(def.tutorial));
  return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
}
```

---

### WR-02: `selectionMatchesValue` silently returns `false` for primitive (non-object) choice values — all choices blocked instead of the targeted one

**File:** `src/engine/tutorial/gate.ts:62`

**Issue:** `selectionMatchesValue` begins with:
```typescript
if (typeof value !== 'object' || value === null) return false;
```

If a `choice` selection has primitive values (e.g. `choices: ['heads', 'tails']`) and a tutorial author writes `selections: { coin: { value: 'heads' } }`, the matcher is applied to the string `'heads'` — a primitive. `selectionMatchesValue` returns `false` for every choice, so the gate marks **every choice disabled**, not just `'tails'`. There is no error; the game silently blocks all choices for that selection, making the action unavailable. The documentation in `types.ts` describes field-equality matching against "the choice object" but does not state that primitive values are unsupported, nor does the type system prevent this usage (`SelectionMatcher = Record<string, unknown>` places no restriction on the gate side).

This is a latent pit-of-failure for future tutorial authors who use `choice` selections with non-object values. Because the failure is silent (gate reason is returned but no type error is thrown), it may not surface until integration testing.

**Fix:** Add an explanatory dev-mode assertion or an early fast-fail path, and document the restriction explicitly in `SelectionMatcher`'s JSDoc:

```typescript
// In gate.ts — selectionMatchesValue
function selectionMatchesValue(matcher: SelectionMatcher, value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    // Primitive values (string, number) cannot match a SelectionMatcher.
    // SelectionMatcher only works for element refs and choice objects.
    // If you need to gate a primitive choice, the gate cannot use `selections`
    // for that selection name — use a TutorialGateCondition predicate instead.
    return false;
  }
  // ... existing logic unchanged
```

And in `types.ts`, extend the `SelectionMatcher` JSDoc:
```
 * NOTE: `SelectionMatcher` only matches object values (element refs, choice
 * objects). For `choice` selections with primitive string/number values, use
 * a `TutorialGateCondition` predicate instead.
```

---

### WR-03: `tutorialDefinition` reattachment uses unnecessary `(runner.game as any)` cast in both restore paths

**File:** `src/session/stateless-ops.ts:490` and `src/session/stateless-ops.ts:511`

**Issue:**
```typescript
if (def.tutorial) {
  (runner.game as any).tutorialDefinition = def.tutorial;
}
```

`Game.tutorialDefinition` is declared as a public property (`tutorialDefinition?: TutorialDefinition` at `src/engine/element/game.ts:479`). The `as any` cast is not needed — `runner.game` typed as `Game` (or `G extends Game`) exposes `tutorialDefinition` directly. The cast suppresses TypeScript: if `tutorialDefinition` is renamed, made readonly, or its type tightens, this assignment fails silently at runtime instead of at compile time. The same pattern appears twice (in `runnerFromSnapshot` and `runnerFromCheckpoint`).

**Fix:**
```typescript
// In runnerFromSnapshot and runnerFromCheckpoint:
if (def.tutorial) {
  (runner.game as Game).tutorialDefinition = def.tutorial;
  // Or, if runner.game is already typed as G extends Game:
  runner.game.tutorialDefinition = def.tutorial;
}
```

Remove the `as any` cast; use the declared type. If TypeScript reports an error here, it means `tutorialDefinition` is typed differently than expected on the `GameRunner`'s `game` property — which itself should be investigated.

---

## Info

### IN-01: `validateTutorialDefinition` called after `runnerFromSnapshot` in the `startTutorial` case

**File:** `src/session/stateless-ops.ts:735-737`

**Issue:**
```typescript
const runner = runnerFromSnapshot(snap, def);
validateTutorialDefinition(def.tutorial);         // ← validation after runner construction
runner.game.tutorialProgress.set(op.player, initialProgress(def.tutorial));
```

`validateTutorialDefinition` throws on malformed definitions (the fail-loud path). Calling it after `runnerFromSnapshot` means the runner is fully constructed — potentially expensive — before validation rejects the op. Correct ordering is: validate first, then perform any state-constructing operations.

**Fix:** Move `validateTutorialDefinition(def.tutorial)` to before `runnerFromSnapshot`:
```typescript
case 'startTutorial': {
  if (!def.tutorial) return errorResult('No tutorial definition on this game.', 'protocol');
  if (op.player < 1 || op.player > gameOptions.playerCount) { /* ... */ }
  validateTutorialDefinition(def.tutorial);          // ← validate before runner construction
  const runner = runnerFromSnapshot(snap, def);
  runner.game.tutorialProgress.set(op.player, initialProgress(def.tutorial));
  return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
}
```

---

### IN-02: `simulate-tutorial.ts` comment incorrectly attributes the post-start `autoAdvanceTutorial` call to a non-existent "session post-start hook"

**File:** `src/testing/simulate-tutorial.ts:204`

**Issue:** The comment reads:
> "Run auto-advance once at start — parity with the server's start-time evaluation (the session post-start hook calls `autoAdvanceTutorial` before the first player action)."

No such hook exists. `game-session.ts`'s `startTutorial()` calls only `#tutorialController.start(seat)`, which sets initial progress and broadcasts — it does **not** call `autoAdvanceTutorial`. In the production path, the first `autoAdvanceTutorial` call fires after the learner's first player action (game-session.ts line 1246), not at tutorial start. The simulate utility's explicit call at line 206 is doing something that the production server does **not** do until the first action, making the utility slightly more aggressive than production in how quickly it advances `capture-tip`.

This is a documentation discrepancy, not a functional issue (the test still exercises the right behavior), but it will mislead future maintainers about the production invariant.

**Fix:** Correct the comment:
```typescript
// 5. Run auto-advance once at start — mirrors the server's FIRST post-action pump.
//    In production, capture-tip.advanceWhen fires on the learner's first action,
//    not at tutorial start. Running it here before the first scripted move ensures
//    steps with immediate advanceWhen predicates (like capture-tip) are counted
//    as visited in stepsVisited, matching the effect of the first real action.
autoAdvanceTutorial(testGame.game, seat);
```

---

_Reviewed: 2026-06-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
