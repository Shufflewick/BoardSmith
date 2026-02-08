---
phase: 90-documentation-migration
plan: 02
subsystem: example-games
tags: [migration, demo-animation, cribbage, animation-events, v3.0, skip-fix]
dependency_graph:
  requires: [90-01, 85-animation-events, 88-client-animation-queue, 89-ui-integration]
  provides: [migrated-demo-animation, migrated-cribbage, skip-abort-fix]
  affects: []
tech_stack:
  added: []
  patterns: [abort-controller-cancellation, cooperative-skip, signal-aware-handlers]
key_files:
  created: []
  modified:
    - ~/BoardSmithGames/demo-animation/src/rules/actions.ts
    - ~/BoardSmithGames/demo-animation/src/ui/components/GameTable.vue
    - ~/BoardSmithGames/cribbage/src/rules/game.ts
    - ~/BoardSmithGames/cribbage/src/ui/components/CribbageBoard.vue
    - src/ui/composables/useAnimationEvents.ts
    - src/ui/composables/useAnimationEvents.test.ts
    - src/ui/index.ts
    - docs/ui-components.md
    - docs/migration-guide.md
decisions:
  - id: 90-02-D1
    description: "Fix skip button to actually abort in-flight handlers using AbortController + Promise.race"
    rationale: "Skip clearing the queue but not interrupting the running handler left animations playing visually"
  - id: 90-02-D2
    description: "Not a breaking change -- handler signal parameter is optional second arg, backwards compatible"
    rationale: "TypeScript allows fewer params to satisfy wider types; JS ignores extra args"
metrics:
  duration: "~30 minutes"
  completed: "2026-02-08"
---

# Phase 90 Plan 02: Example Game Migration Summary

Migrated demo-animation and cribbage example games to v3.0 animation system. During browser verification, discovered and fixed a UX bug where the Skip button cleared the queue but didn't abort the currently-running handler. Added AbortController-based cooperative cancellation to the animation framework.

## What Was Done

### Task 1: Migrate demo-animation game
**Commit:** `115238e` (in ~/BoardSmithGames/demo-animation)

- Removed empty `() => {}` callback from `game.animate('demo', data)` in `actions.ts`
- Updated comments to remove theatre/mutation capture language
- Updated `GameTable.vue` handler to use signal-aware timer with `clearTimeout` on abort
- Removed outdated "server acknowledge" comment

### Task 2: Migrate cribbage game
**Commit:** `658886d` (in ~/BoardSmithGames/cribbage)

- Removed `acknowledge` parameter from `createAnimationEvents()` in `CribbageBoard.vue`
- Removed empty callbacks from `game.animate('score-hand-start', ...)` and `game.animate('score-item', ...)` calls in `game.ts`
- Kept truth-advancing callback on `game.animate('score-hand-complete', ...)` (adds points)
- Updated all 3 animation handlers to accept `{ signal }` and check `signal.aborted` between steps
- Added watcher on `isAnimating` to clean up scoring overlay when animations stop mid-scoring
- Removed outdated theatre/mutation capture comments

### Bug Fix: Skip button abort support (framework)
**Commit:** `e7542e1` (in BoardSmith)

During browser verification, the Skip button was observed to hide the animation bar but not actually skip through animations. Root cause: `skipAll()` cleared the queue and set `isAnimating = false` but the currently-running handler's Promise continued to completion.

Fix:
- Added `AnimationHandlerContext` interface with `signal: AbortSignal`
- Updated `AnimationHandler` type to accept optional `(event, { signal })` second arg
- Added `AbortController` per handler invocation in `processQueue()`
- Used `Promise.race` to unblock the queue immediately when skip is pressed
- `skipAll()` now calls `abort()` on the current controller
- Added 3 new tests (cooperative handler abort, normal signal state, non-cooperative handler unblock)
- Updated docs: ui-components.md (signal parameter), migration-guide.md (Step 5 skip support)
- Exported `AnimationHandlerContext` from `src/ui/index.ts`

### Task 3: Browser verification
Both games verified in browser:

**Cribbage:**
- Played through full rounds with AI opponent
- Score animations played correctly (score-hand-start, score-item, score-hand-complete)
- Points awarded correctly after scoring animations
- Skip button tested: animations stopped immediately, overlay cleared, round summary appeared instantly
- No console errors

**Demo-animation:**
- Game loaded, connected, and running with AI
- Flying elements, card flips, drag-drop, and animation events all working
- No console errors

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 90-02-D1 | Fix skip to abort in-flight handlers via AbortController + Promise.race | Skip clearing queue without interrupting running handler left animations visually playing |
| 90-02-D2 | Handler signal is optional second arg (not breaking) | TypeScript allows fewer params; JS ignores extra args |

## Deviations from Plan

- **Added:** AbortController-based skip fix to framework (`useAnimationEvents.ts`) -- discovered during browser verification checkpoint. This was a legitimate bug in the skip implementation.
- **Added:** 3 new tests for skip abort behavior
- **Added:** Documentation updates for skip signal support (ui-components.md, migration-guide.md)
- **Added:** `AnimationHandlerContext` type export

## Verification Results

All verification checks passed:

1. Both example games compile without TypeScript errors
2. demo-animation game runs with animations in browser -- no errors
3. cribbage game runs with score animations and skip works correctly in browser -- no errors
4. No references to removed v2.9 APIs (acknowledge, theatre, mutation capture) in either game
5. Truth-advancing callbacks in cribbage preserved (`score-hand-complete`)
6. Skip button properly interrupts in-flight handlers (new behavior)
7. All 540 tests pass, including 36 animation event tests (3 new)
