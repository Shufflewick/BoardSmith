---
phase: 109-checkers-tutorial-content
fixed_at: 2026-06-28T22:49:00Z
review_path: .planning/phases/109-checkers-tutorial-content/109-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 5
skipped: 1
status: partial
---

# Phase 109: Code Review Fix Report

**Fixed at:** 2026-06-28T22:49:00Z
**Source review:** .planning/phases/109-checkers-tutorial-content/109-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6
- Fixed: 5 (CR-01, WR-01, WR-02, WR-03, IN-01, IN-02 all landed in one atomic commit)
- Skipped: 1 (destination gate restoration — breaks simulateTutorial test, see below)

## Fixed Issues

### CR-01, WR-01, WR-02, WR-03, IN-01, IN-02: stateless-ops tutorial fixes

**Files modified:** `src/session/stateless-ops.ts`, `src/session/stateless-ops.test.ts`, `src/engine/tutorial/gate.ts`, `src/engine/tutorial/types.ts`, `src/testing/simulate-tutorial.ts`
**Commit:** `421b441`
**Applied fix:**

- **CR-01:** Imported `autoAdvanceTutorial` into `stateless-ops.ts` and called it after every state-mutating op: after `runner.performAction` in `handleAction`, after `handler.processSelectionStep` in `handleSelectionStep`, and after `initialProgress` is set in the `startTutorial` case. Iterates over all seats with `status === 'running'`. Added regression test in `stateless-ops.test.ts` using a `CountingGame` that increments `passCount` on action — proves the tutorial auto-advances in the dev-host path and will catch any future regression.

- **WR-01:** Added seat range guard in `startTutorial` case: `if (op.player < 1 || op.player > gameOptions.playerCount)` returns a `protocol` error before any state mutation. Added test: `rejects invalid seat (0) with a protocol error`.

- **WR-02:** Added explicit documentation in `selectionMatchesValue` (gate.ts) explaining that primitive values (string/number) are not supported and return false for every value, silently blocking all choices. Also extended the `SelectionMatcher` JSDoc in types.ts with a NOTE directing authors to use `TutorialGateCondition` predicates for primitive-valued choice selections. (The behavior is unchanged — the comment and JSDoc are the fix per the REVIEW's recommendation.)

- **WR-03:** Replaced `(runner.game as any).tutorialDefinition` with `(runner.game as Game).tutorialDefinition` in both `runnerFromSnapshot` and `runnerFromCheckpoint`. Type-safe — if `tutorialDefinition` is renamed or made readonly, TypeScript will catch it at compile time.

- **IN-01:** Moved `validateTutorialDefinition(def.tutorial)` before `runnerFromSnapshot` in the `startTutorial` case. Validates before constructing state (fail-loud before expensive work).

- **IN-02:** Corrected the misleading comment in `simulate-tutorial.ts:203`: replaced "the session post-start hook calls `autoAdvanceTutorial` before the first player action" with an accurate description that the server fires the first pump on the learner's FIRST action, not at tutorial start.

**BoardSmith test suite after fix:** 1593/1593 tests pass.

---

## Skipped Issues

### Cross-repo follow-on: destination gate restoration in checkers execute-capture

**File:** `~/BoardSmithGames/checkers/src/rules/tutorial.ts`
**Reason:** Restoration breaks `simulateTutorial` test — root cause is structural, not a CR-01 side effect.
**Original issue:** The destination gate `{ toNotation: 'd4' }` was removed from `execute-capture` in phase 109-04 to work around a followUp deadlock. The REVIEW asserted the gate is safe after CR-01 is fixed because "the destination selection is a separate client round-trip, so `autoAdvanceTutorial` would run between the capture and the destination selection."

**Investigation result:** The REVIEW's claim is correct for the **production WebSocket path** (stateless-ops `handleSelectionStep`). In that path:
1. Client sends `selectionStep { piece }` → partial action, pending state saved
2. Client sends `selectionStep { destination: d4 }` → action completes, `autoAdvanceTutorial` fires, tutorial advances to `multi-jump-continue`
3. Client sends the followUp's `selectionStep { destination: b2 }` → now governed by `multi-jump-continue`'s gate (allows b2) ✓

However, `simulateTutorial` uses `TestGame.doAction()` which calls `runner.performAction()` with ALL args at once (`{ piece, destination: d4 }`). After the first capture executes inside `performAction`, the engine's `followUp` mechanism **re-enters the action step for the continuation move BEFORE `performAction` returns** — before `autoAdvanceTutorial` can fire. With the tutorial still on `execute-capture` and a `{ toNotation: 'd4' }` gate active, the continuation's only valid destination (`b2`) is blocked. The `move-loop` keeps iterating (`continuingPiece !== null → while true`) until it hits `maxIterations: 20` and throws.

This was confirmed by test run: restoring the gate caused `tests/tutorial.test.ts` to throw `Loop "move-loop" hit its maxIterations safety cap (20 iterations)` on the intact walkthrough test, while the break test passed.

The CR-01 fix in stateless-ops does NOT affect `simulateTutorial` — it already had its own `autoAdvanceTutorial` calls. The root cause for the test failure is that `doAction` provides all args synchronously, and the `followUp` continuation fires within the same `performAction` call with no hook point for `autoAdvanceTutorial`.

**What was done instead:** Updated the comment in `tutorial.ts` and `tutorial-preset.test.ts` to precisely document the root cause (doAction/followUp interaction vs. WebSocket round-trips), replacing the prior comment which attributed the issue to "before autoAdvanceTutorial fires" (now correct for the test path but not the production path).

**Path to resolution:** Two options remain open:
1. **Engine-level hook:** Add a post-action callback in the engine's `followUp` handling so `autoAdvanceTutorial` can fire between the initial action and the continuation action step. This would fix both paths simultaneously but requires engine changes.
2. **simulateTutorial split-step API:** Add a `doSelectionStep(seat, selectionName, value)` API to `TestGame` and update `simulateTutorial` to use separate selection calls rather than `doAction`. This mirrors the WebSocket path more closely.

The gate omission does not affect CHK-01 teaching (content text guides to d4; mandatory-capture rule enforces only d4 is valid from b6). The checkers suite remains 31/31 green.

---

_Fixed: 2026-06-28T22:49:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
