---
phase: 104-tutorial-lifecycle-action-gating
plan: "04"
subsystem: session
tags: [tutorial, lifecycle, projection, parity, integration-test]
dependency_graph:
  requires: [104-01, 104-02, 104-03]
  provides: [TUT-05, TUT-02-client-surface]
  affects: [session/game-session.ts, session/utils.ts, engine/utils/snapshot.ts, engine/tutorial/gate.ts]
tech_stack:
  added: [TutorialController]
  patterns: [manager-callbacks-pattern, shared-projection-helper, runner-replacement-with-unserializable-rethread]
key_files:
  created:
    - src/session/tutorial-controller.ts
    - src/session/tutorial-controller.test.ts
  modified:
    - src/session/game-session.ts
    - src/session/utils.ts
    - src/engine/utils/snapshot.ts
    - src/engine/tutorial/gate.ts
    - src/session/build-player-state.test.ts
decisions:
  - "Shared getActiveTutorialStepView() helper in gate.ts used by both buildPlayerState and createPlayerView — single source prevents projection drift"
  - "Tutorial definition re-supplied in replaceRunner callback after undo/rewind (tutorialDefinition excluded from snapshot.gameOptions by design — session layer must re-thread it)"
  - "rewindToAction() used for undo-lockstep test (not undoToTurnStart) because undo requires currentPlayer == seat; cross-turn rewind tests the serialized-progress invariant equally well"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-25T20:42:29Z"
  tasks_completed: 3
  files_changed: 7
---

# Phase 104 Plan 04: Tutorial Lifecycle + Dual Projection Summary

**One-liner:** Session-layer `TutorialController` owns start/advance/skip/exit lifecycle for tutorial seats; active step + gate reasons project identically in both `buildPlayerState` and `createPlayerView` via a shared helper, with parity and suppressAutoFill e2e tests proving no platform/embed divergence.

## What Was Built

### Task 1: TutorialController + GameSession wiring (TDD)

`src/session/tutorial-controller.ts` — session-layer manager, peer to `PendingActionManager`:
- Constructor takes `getRunner: () => GameRunner` + `{ broadcast }` callbacks, mirroring `PendingActionManager`
- `start(seat)` — sets `game.tutorialProgress.get(seat)` to first step, status `'running'`; broadcasts once
- `advance(seat)` — moves to next step; at last step, status becomes `'completed'`; broadcasts once
- `skip(seat)` — same forward-advance as `advance`, semantically "learner bypassed"; broadcasts once
- `exit(seat)` — sets status to `'exited'`; gate goes inert; broadcasts once
- Throws an actionable error naming `GameDefinition.tutorial` when definition absent

`src/session/game-session.ts` changes:
- `#tutorialController: TutorialController<G>` — wired in private constructor with `{ broadcast: () => this.broadcast() }`
- `#tutorialDefinition?: TutorialDefinition` — captured from initial runner so `replaceRunner` can re-supply it after undo/rewind
- Public `startTutorial/advanceTutorial/skipTutorial/exitTutorial(seat)` methods

### Task 2: Dual projection — parity hard-rule (T-104-07)

`src/engine/tutorial/gate.ts` — new shared helper:
- `getActiveTutorialStepView(game, seat): TutorialStepView | undefined` — projects the active running step's `{ stepId, content?, suppressAutoFill?, suppressAutoFillFor? }` for the client; returns `undefined` when not running

`src/engine/utils/snapshot.ts`:
- `PlayerStateView` gains `tutorial?: TutorialStepView` and `disabledActions?: Record<string, string>`
- `createPlayerView()` populates both from `getActiveTutorialStepView` + `game.getTutorialDisabledActions` (skips spectator position 0)

`src/session/utils.ts`:
- `buildPlayerState()` populates `state.tutorial` + `state.disabledActions` using the same shared helper (skips position 0)

### Task 3: Lifecycle + parity + cross-layer integration tests

`src/session/tutorial-controller.test.ts`:
- 13 tests: lifecycle transitions, broadcast count (exactly one per op), error messages, multi-seat independence, two/three-step tutorial sequences

`src/session/build-player-state.test.ts` extensions (14 new tests):
- **Parity suite** (8 tests): deep equality of `tutorial` + `disabledActions` between `buildPlayerState` and `createPlayerView` across run/exit/complete/advance/spectator states
- **Cross-layer integration** (3 tests): `startTutorial` → projection shows step + gated reason; rewind restores `tutorialProgress` in lockstep; `exitTutorial` clears projection
- **E2e suppressAutoFill trace** (2 tests): real `useActionController` auto-fill driven from an ACTUAL `buildPlayerState` projection of a `suppressAutoFill: true` step — asserts that a single-enabled choice is NOT auto-filled when the tutorial step suppresses it

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Tutorial definition not re-supplied after undo/rewind**

- **Found during:** Task 3 cross-layer integration test (undo-lockstep test)
- **Issue:** `StateHistory.replaceRunner` callback creates a new runner via `GameRunner.fromCheckpoint`, which uses `snapshot.gameOptions` — but `tutorial` is intentionally excluded from `_constructorOptions` (see Game constructor). The new runner had no `tutorialDefinition`, causing all lifecycle methods to throw after undo.
- **Fix:** Added `#tutorialDefinition?: TutorialDefinition` field to `GameSession`, captured from initial runner in constructor. `replaceRunner` callback re-sets `newRunner.game.tutorialDefinition = this.#tutorialDefinition` when present.
- **Files modified:** `src/session/game-session.ts`
- **Commit:** 9a0dc91

**2. [Rule 1 - Bug] Test game used incorrect `chooseFrom` API**

- **Found during:** Task 1 GREEN phase — tests failed with `choiceSel.choices is not iterable`
- **Issue:** Test game used `Action.create('move').chooseFrom('piece', ['a', 'b', 'c'])` but the API requires `{ choices: [...] }` object form
- **Fix:** Changed to `.chooseFrom('piece', { choices: ['a', 'b', 'c'] })`
- **Files modified:** `src/session/tutorial-controller.test.ts`

**3. [Rule 3 - Blocking] GameRunner tutorial option was passed wrong**

- **Found during:** Task 1 GREEN phase — controller threw "No tutorial definition" despite passing tutorial to GameRunner
- **Issue:** Test's `makeRunner` passed `tutorial` as a separate `GameRunnerOptions` field; but `GameRunnerOptions` doesn't have `tutorial` — it must go inside `gameOptions`
- **Fix:** Moved `tutorial` into `gameOptions: { ..., tutorial }`

**4. [Rule 1 - Bug] Undo test used wrong undo API**

- **Found during:** Task 3 undo-lockstep test
- **Issue:** `undoToTurnStart(1)` fails after a player action because the flow advances to player 2 (not player 1's turn anymore), returning `NOT_YOUR_TURN`
- **Fix:** Used `rewindToAction(0)` instead, which doesn't require `currentPlayer === seat` and tests the serialized-progress invariant equally: checkpoint[0] captured step 'intro', rewind to index 0 restores it

## Known Stubs

None — all tutorial fields are wired to real data. The `content?` and `advanceWhen?` fields in `TutorialStepView` remain `unknown` as designed (RESERVED for Phase 105/106 respectively).

## Threat Flags

No new threat surface beyond what the plan's threat model covered.

## Self-Check: PASSED

Files confirmed:
- src/session/tutorial-controller.ts ✓
- src/session/tutorial-controller.test.ts ✓
- src/session/game-session.ts ✓
- src/session/utils.ts ✓
- src/engine/utils/snapshot.ts ✓
- src/engine/tutorial/gate.ts ✓
- src/session/build-player-state.test.ts ✓

Commits confirmed:
- 4010e17 test(104-04): add failing tests for TutorialController lifecycle (RED)
- ecc487d feat(104-04): implement TutorialController with start/advance/skip/exit lifecycle (GREEN)
- baa74f3 feat(104-04): project active tutorial step + disabledActions in both projection paths
- 9a0dc91 feat(104-04): add parity, cross-layer, and suppressAutoFill e2e tests; fix tutorial re-supply on undo

Full suite: 1313 tests, all green (was 1286 at start of phase).
