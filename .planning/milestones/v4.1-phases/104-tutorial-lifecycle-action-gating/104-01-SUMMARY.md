---
phase: 104-tutorial-lifecycle-action-gating
plan: 01
subsystem: engine/session
tags: [tutorial, serialization, types, contracts]
dependency_graph:
  requires: []
  provides:
    - TutorialStep/TutorialGate/TutorialDefinition/TutorialProgress/TutorialStepView types
    - Game.tutorialProgress (serialized Map<number, TutorialProgress>)
    - Game.tutorialDefinition (un-serialized static config)
    - GameDefinition.tutorial optional field
    - PlayerGameState.tutorial? and disabledActions? reserved slots
    - GameSessionOptions.tutorial threading
    - Serialization round-trip guard test (12 tests)
  affects:
    - src/engine/element/game.ts (tutorialProgress field + GameOptions)
    - src/session/types.ts (GameDefinition + PlayerGameState)
    - src/session/game-session.ts (GameSessionOptions + create() threading)
    - src/engine/element/volatile-state.ts (SAFE_PROPERTIES)
tech_stack:
  added: []
  patterns:
    - Map<number, TutorialProgress> serialized via __map encoding (preserves numeric keys)
    - TutorialDefinition excluded from _constructorOptions (function gates can't JSON.stringify)
    - unserializableAttributes pattern for static config fields (mirrors _actions)
key_files:
  created:
    - src/engine/tutorial/types.ts
    - src/session/tutorial-serialization.test.ts
  modified:
    - src/engine/element/game.ts
    - src/engine/element/volatile-state.ts
    - src/session/types.ts
    - src/session/game-session.ts
decisions:
  - tutorialProgress is Map<number, TutorialProgress> not Record to preserve numeric seat keys through JSON round-trip
  - tutorial excluded from _constructorOptions (not just unserializableAttributes) because function-gate steps would fail JSON.stringify and the session layer re-supplies it
  - TutorialStepView is a named export distinct from TutorialProgress so producer (104-04) and consumers (104-03 suppressAutoFill, 105 content) bind to one contract
  - tutorialDefinition added to volatile-state.ts SAFE_PROPERTIES to suppress false-positive HMR warning
metrics:
  duration: ~30 minutes
  completed: 2026-06-25
  tasks_completed: 3
  tests_added: 12
  files_created: 2
  files_modified: 4
---

# Phase 104 Plan 01: Tutorial Substrate Contracts & Serialization Summary

**One-liner:** Tutorial substrate: typed step/gate/progress contracts, serialized `Map<number,TutorialProgress>` field that round-trips snapshot/undo/MCTS, un-serialized `tutorialDefinition` threading from `GameDefinition` → `GameOptions` → `Game`, and a 12-test load-bearing serialization guard.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Define tutorial contracts + reserved PlayerGameState slots | 4cb37a1 |
| 2 | Add serialized tutorialProgress field + thread tutorialDefinition | 35a1fba |
| 3 | Serialization round-trip + undo + MCTS clone guard test | 9f09aab |

## What Was Built

### Task 1: Tutorial Type Contracts (`src/engine/tutorial/types.ts`)

Created the full type hierarchy for the tutorial substrate:

- **`TutorialGateAllowList`** `{ action: string; from?: unknown; to?: unknown }` — pit-of-success declarative gate for simple on-rails steps (from/to reserved for Phase 109)
- **`TutorialGatePredicate`** `(ctx: TutorialGateContext) => boolean` — escape hatch for complex gates
- **`TutorialGate`** union of allow-list | predicate
- **`TutorialStep`** `{ id, gate, content?, advanceWhen?, suppressAutoFill? }` — content reserved for Phase 105, advanceWhen for Phase 106, suppressAutoFill is the substrate signal wired by Plan 104-03
- **`TutorialDefinition`** `{ steps: TutorialStep[] }` — static config attached to GameDefinition
- **`TutorialProgress`** `{ stepId: string | null; status: 'running' | 'completed' | 'exited' }` — JSON-plain, serialized per-seat durable state
- **`TutorialStepView`** `{ stepId; content?; suppressAutoFill? }` — named client projection contract for `PlayerGameState.tutorial`

Updated `src/session/types.ts`:
- `GameDefinition.tutorial?: TutorialDefinition` — mirrors `ai` / `presets` peers
- `PlayerGameState.tutorial?: TutorialStepView` — reserved (Plan 104-04 populates)
- `PlayerGameState.disabledActions?: Record<string, string>` — reserved (Plan 104-02 populates)
- Re-exports all tutorial types from session surface

### Task 2: Engine Field + Session Threading

**`src/engine/element/game.ts`:**
- Added `tutorial?: TutorialDefinition` to `GameOptions`
- Added `tutorialProgress: Map<number, TutorialProgress> = new Map()` as plain public field (own-enumerable so `Object.keys` includes it, serializes via `__map` encoding)
- Added `tutorialDefinition?: TutorialDefinition` as public field in `unserializableAttributes` (static config, re-supplied on restore)
- Excluded `tutorial` from `_constructorOptions` so it does NOT pollute `snapshot.gameOptions` (function-gate predicates can't JSON.stringify; session re-supplies on restore)

**`src/session/game-session.ts`:**
- Added `tutorial?: TutorialDefinition` to `GameSessionOptions`
- Threaded `tutorial` from `options` into `effectiveGameOptions` in `create()` (mirrors `aiConfig`/`botAIConfig` threading pattern)

**`src/engine/element/volatile-state.ts`:**
- Added `tutorialProgress` and `tutorialDefinition` to `SAFE_PROPERTIES` to suppress false-positive HMR warning (tutorialProgress serializes correctly via `__map`; tutorialDefinition is non-Map framework config)

### Task 3: Serialization Guard Test (`src/session/tutorial-serialization.test.ts`)

12 tests across 4 describe blocks proving the three load-bearing invariants:

**Round-trip (4 tests):**
- Progress set to `{stepId:'s1', status:'running'}` → `getSnapshot()` → `JSON.parse(JSON.stringify)` → `fromSnapshot()` → `restored.tutorialProgress.has(1)` (not `"1"`) is truthy, `get(1).stepId === 's1'`
- Multiple seats round-trip independently
- Empty Map round-trips without error
- `tutorialDefinition` NOT in `snapshot.state.attributes` (excluded from `_constructorOptions`)

**Undo rewind (2 tests):**
- Checkpoint at index 0 has 's1' progress → perform action → mutate to 's2' → `GameRunner.fromCheckpoint(snapshot, 0, TutorialGame)` → restored progress is 's1', not 's2'
- Checkpoint at index 0 has empty progress → perform action → set 's1' → undo to checkpoint 0 → empty Map

**MCTS clone (2 tests):**
- `new TutorialGame(cloneOptions) + loadSerializedState(snapshotJson.state)` carries root progress
- MCTS clone has `tutorialDefinition === undefined` (correct — bot never advances tutorial)

**Threading (4 tests):**
- `game.tutorialDefinition` is set from `options.tutorial`
- `game.tutorialDefinition` is undefined when no tutorial in options
- `Object.keys(game)` includes `tutorialProgress`; `toJSON()` excludes `tutorialDefinition`
- `Game.unserializableAttributes` includes `tutorialDefinition`, excludes `tutorialProgress`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Excluded `tutorial` from `_constructorOptions`**
- **Found during:** Task 3 test writing (MCTS clone test)
- **Issue:** `_constructorOptions = { ...options, seed }` included `tutorial`, which caused it to appear in `snapshot.gameOptions`. This violated the design intent (tutorial must NOT serialize) and would cause function-gate predicates to fail `JSON.stringify` in production.
- **Fix:** Destructured `tutorial` out of options before spreading into `_constructorOptions`. Session layer must re-supply tutorial on restore (same as `aiConfig`).
- **Files modified:** `src/engine/element/game.ts`
- **Commit:** 9f09aab

**2. [Rule 2 - Missing critical] Added `tutorialProgress`/`tutorialDefinition` to `SAFE_PROPERTIES`**
- **Found during:** Task 3 test run (HMR warning spam)
- **Issue:** `checkForVolatileState` warned that `tutorialProgress` is a Map that "won't survive HMR". This is a false positive — it DOES serialize via `__map` encoding and IS in `toJSON()`.
- **Fix:** Added both keys to `SAFE_PROPERTIES` in `volatile-state.ts`.
- **Files modified:** `src/engine/element/volatile-state.ts`
- **Commit:** 9f09aab

**3. [Note] TDD ordering: implementation before test**
- The plan tasks are ordered 1 (types) → 2 (implementation) → 3 (TDD test). The TDD RED phase was written after the implementation was committed. The tests pass immediately (GREEN) because the implementation is correct. The test file is the regression guard — future changes that accidentally break serialization (e.g., moving `tutorialProgress` to `#private`) will cause the tests to fail.

## Verification Results

```
npx vitest run src/session/tutorial-serialization.test.ts
  Test Files  1 passed (1)
  Tests       12 passed (12)

npx vitest run (full suite)
  Test Files  98 passed (98)
  Tests       1262 passed (1262)
```

## Known Stubs

- `PlayerGameState.tutorial` is reserved but not yet populated — Plan 104-04 task
- `PlayerGameState.disabledActions` is reserved but not yet populated — Plan 104-02 task
- `GameSession.restore()` does not yet re-supply `tutorialDefinition` — Plan 104-02 threading task

These stubs are intentional: the contract is defined now so parallel plans (104-02, 104-03, 104-04) can implement against a stable interface.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `src/engine/tutorial/types.ts` exists | FOUND |
| `src/session/tutorial-serialization.test.ts` exists | FOUND |
| commit 4cb37a1 (Task 1) | FOUND |
| commit 35a1fba (Task 2) | FOUND |
| commit 9f09aab (Task 3) | FOUND |
| `npx vitest run src/session/tutorial-serialization.test.ts` | 12/12 passed |
| Full suite (`npx vitest run`) | 1262/1262 passed |
