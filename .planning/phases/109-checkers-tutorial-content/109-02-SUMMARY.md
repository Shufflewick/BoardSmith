---
phase: 109-checkers-tutorial-content
plan: "02"
subsystem: session, ui, cli
tags: [tutorial, stateless-ops, platform-request, controls-menu, hasTutorial]
dependency_graph:
  requires: []
  provides: [start-tutorial-op, hasTutorial-signal, tutorial-launch-surface]
  affects: [session/stateless-ops, session/types, session/utils, cli/bridge, ui/GameShell, ui/ControlsMenu]
tech_stack:
  added: []
  patterns: [stateless-op-pattern, runnerFromSnapshot-tutorial-threading, platformRequest-teaching-action]
key_files:
  created: []
  modified:
    - src/session/stateless-ops.ts
    - src/session/types.ts
    - src/session/utils.ts
    - src/cli/dev-host/bridge.ts
    - src/cli/commands/dev.ts
    - src/ui/components/ControlsMenu.vue
    - src/ui/components/GameShell.vue
    - src/session/stateless-ops.test.ts
    - src/session/build-player-state.test.ts
decisions:
  - "Thread tutorial def through runnerFromSnapshot/runnerFromCheckpoint helpers to ensure hasTutorial in ALL state broadcasts (not just after startTutorial)"
  - "Add tutorial?: TutorialDefinition to GameDefinitionLike and dev.ts gameDef so stateless-ops path has the definition available"
  - "Tutorial group in ControlsMenu uses boolean v-if='hasTutorial' (not undefined-gate like Teaching group) — cleaner for a boolean signal"
metrics:
  duration: "7 minutes"
  completed: "2026-06-28"
  tasks_completed: 2
  files_changed: 9
---

# Phase 109 Plan 02: Start-Tutorial Launch Surface Summary

Tutorial launch surface: `startTutorial` stateless Op + `hasTutorial` broadcast signal + bridge routing + ControlsMenu "Start tutorial" item + GameShell handler — working in production GameShell and `boardsmith dev` host.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | startTutorial stateless op + hasTutorial signal + bridge routing | ddebd12 | stateless-ops.ts, types.ts, utils.ts, bridge.ts, dev.ts, +tests |
| 2 | ControlsMenu Tutorial group + GameShell launch wiring | 53320ec | ControlsMenu.vue, GameShell.vue |

## What Was Built

### Task 1 — Core substrate

**`src/session/stateless-ops.ts`**
- Added `tutorial?: TutorialDefinition` to `GameDefinitionLike` — definition travels alongside every op call
- Added `| { type: 'startTutorial'; player: number }` to Op union (not in `READ_ONLY_OP_TYPES`)
- Added `runnerFromSnapshot(snapshot, def)` helper: creates runner from snapshot AND re-supplies `tutorialDefinition` on `runner.game` (mirrors `game-session.ts`'s `replaceRunner` guard — tutorialDefinition is unserializable so it is lost after `fromSnapshot`)
- Updated `runnerFromCheckpoint` to also re-supply `tutorialDefinition`
- Updated all 10+ `GameRunner.fromSnapshot`/`fromCheckpoint` call sites to use the helpers — ensures `hasTutorial` is present in EVERY state broadcast, not just after `startTutorial`
- Updated `handleStart` to pass `tutorial` in `effectiveOptions` so the initial runner also has it
- Added `startTutorial` case to `executeOp` switch: validates `def.tutorial`, creates runner, calls `validateTutorialDefinition` + `tutorialProgress.set(player, initialProgress(def))`, returns `stateEnvelope`

**`src/session/types.ts`**
- Added `hasTutorial?: boolean` to `PlayerGameState` with JSDoc explaining when populated

**`src/session/utils.ts`**
- Added `state.hasTutorial = true` block before the tutorial projection block in `buildPlayerState` — fires for all seats including spectators (no `playerPosition > 0` guard)

**`src/cli/dev-host/bridge.ts`**
- Added `'start-tutorial'` to `WireOp` union
- Added `case 'start-tutorial': return { type: 'startTutorial', player: seat }` to `translateOp`
- Added `case 'start-tutorial':` to `shapeResult` (same `{ success, error }` shape as undo/cancel_action)

**`src/cli/commands/dev.ts`**
- Added `tutorial: gameDefinition.tutorial` to `gameDef` — required so the stateless-ops path receives the tutorial definition; without it, `startTutorial` would always error and `hasTutorial` would never appear in dev host broadcasts

**Tests (stateless-ops.test.ts, build-player-state.test.ts)**
- `startTutorial` succeeds and sets tutorialProgress (tutorial step view appears in player state)
- `startTutorial` fails with 'No tutorial definition' (protocol error) when def has no tutorial
- Initial broadcast has `hasTutorial: true` when def has tutorial (regression guard for threading)
- `hasTutorial === true` when `runner.game.tutorialDefinition` is set
- `hasTutorial === undefined` when game has no tutorialDefinition
- `hasTutorial` present for all seat positions including spectator (position 0)

### Task 2 — UI surface

**`src/ui/components/ControlsMenu.vue`**
- Added `hasTutorial?: boolean` prop (JSDoc: shows Tutorial group when true)
- Extended `teaching-action` emit union with `'start-tutorial'`
- Added Tutorial group template block after Teaching group: `<template v-if="hasTutorial">` with separator, "Tutorial" grouplabel, and "Start tutorial" button that emits `'teaching-action','start-tutorial'` and calls `close()`

**`src/ui/components/GameShell.vue`**
- Extended `handleTeachingAction` param union with `'start-tutorial'`
- Added `else if (teachAction === 'start-tutorial')` branch: calls `platformRequest('start-tutorial', { seat: playerSeat.value })` with `toast.error` fallback (mirrors heatmap-toggle pattern)
- Added `hasTutorialProp` computed: `state.value?.state?.hasTutorial ?? false`
- Bound `:has-tutorial="hasTutorialProp"` on `<ControlsMenu>` element

## Key Design Decision

**Why `runnerFromSnapshot` helper threading all handlers (not just startTutorial):** The `tutorialDefinition` is stored in `unserializableAttributes` so it is NOT serialized into game snapshots. Every `GameRunner.fromSnapshot` call creates a runner without `tutorialDefinition`. If we only set it in the `startTutorial` case, `hasTutorial` would disappear from broadcasts after the first non-startTutorial op (action, undo, etc.). The fix is to re-supply it in every runner restored from snapshot — mirroring what `game-session.ts`'s `replaceRunner` already does for the stateful path. The `runnerFromSnapshot` and `runnerFromCheckpoint` helpers centralize this threading, replacing all direct `GameRunner.fromSnapshot` calls.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Thread tutorialDefinition through all fromSnapshot calls**
- **Found during:** Task 1 implementation
- **Issue:** The plan's action said "reads `runner.game.tutorialDefinition`" without addressing the fact that `tutorialDefinition` is an unserializable attribute lost after `GameRunner.fromSnapshot`. Without threading, `hasTutorial` would only appear in the `start` op broadcast and disappear on every subsequent op — making the ControlsMenu item flicker away after the first action.
- **Fix:** Added `runnerFromSnapshot(snapshot, def)` and updated `runnerFromCheckpoint` to re-supply `tutorialDefinition` from `def.tutorial`. Updated all 10 `GameRunner.fromSnapshot` call sites. Added `tutorial` field to `GameDefinitionLike` and `dev.ts` gameDef.
- **Files modified:** src/session/stateless-ops.ts, src/cli/commands/dev.ts
- **Commit:** ddebd12

**2. [Rule 2 - Missing critical functionality] Include tutorial in dev.ts gameDef**
- **Found during:** Task 1 implementation
- **Issue:** The CLI's `dev.ts` built `gameDef` with only `gameClass/gameType/minPlayers/maxPlayers` — no `tutorial` field. Without it, `(def as any).tutorial` in `executeOp` would always be undefined for the dev bridge path, causing `startTutorial` to fail with 'No tutorial definition' even for games that have one.
- **Fix:** Added `tutorial: gameDefinition.tutorial` to the `gameDef` object in `dev.ts`.
- **Files modified:** src/cli/commands/dev.ts
- **Commit:** ddebd12

## Verification

```
src/session + src/ui test suites: 929 passed (929 tests, 80 files)

Acceptance criteria:
- grep -c startTutorial src/session/stateless-ops.ts → 2 (Op union + executeOp case)
- grep -c 'start-tutorial' src/cli/dev-host/bridge.ts → 3 (WireOp + translateOp + shapeResult)
- grep -c hasTutorial src/session/types.ts → 1
- grep -c 'start-tutorial' src/ui/components/ControlsMenu.vue → 3
- grep -c "platformRequest('start-tutorial'" src/ui/components/GameShell.vue → 1
- grep -c 'has-tutorial' src/ui/components/GameShell.vue → 1
- startTutorial NOT in READ_ONLY_OP_TYPES: confirmed
- hint/heatmap/demo bridge ops untouched: confirmed
```

## Scope Honored

`start-tutorial` only. `hint`/`heatmap-toggle`/`demo-start`/`demo-stop` bridge ops remain unimplemented (require stateful AI session layer — deferred to Phase 110 DEMO-01 as planned).

## Self-Check: PASSED

- src/session/stateless-ops.ts: modified (feat ddebd12)
- src/session/types.ts: hasTutorial field present
- src/session/utils.ts: hasTutorial = true when tutorialDefinition set
- src/cli/dev-host/bridge.ts: start-tutorial in WireOp, translateOp, shapeResult
- src/cli/commands/dev.ts: tutorial: gameDefinition.tutorial in gameDef
- src/ui/components/ControlsMenu.vue: Tutorial group + hasTutorial prop + emit
- src/ui/components/GameShell.vue: hasTutorialProp + platformRequest + :has-tutorial binding
- Commits ddebd12, 53320ec: exist in git log
- 929 session + UI tests green
