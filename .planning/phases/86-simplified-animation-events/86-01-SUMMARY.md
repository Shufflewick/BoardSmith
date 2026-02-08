---
phase: 86-simplified-animation-events
plan: 01
subsystem: engine
tags: [animation, commands, event-sourcing, game-api]

# Dependency graph
requires:
  - phase: 85-theatre-erasure
    provides: clean animation event buffer infrastructure without theatre/mutation-capture
provides:
  - AnimateCommand type in GameCommand union with command stack integration
  - game.animate(type, data, callback?) public API for game developers
  - Buffer lifecycle with action-boundary clearing in performAction()
  - Comprehensive test coverage for all four ENG requirements
affects:
  - 86-02 (session layer broadcasting of animation events)
  - 87 (UI consumption of animation events)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ANIMATE command as pure data on command stack (no state mutation, not invertible)"
    - "Buffer clearing at performAction() boundaries for action-scoped event batches"
    - "Optional callback as convenience wrapper, not mutation capture"

key-files:
  created:
    - src/engine/element/animation-events.test.ts
  modified:
    - src/engine/command/types.ts
    - src/engine/command/executor.ts
    - src/engine/command/inverse.ts
    - src/engine/command/index.ts
    - src/engine/index.ts
    - src/engine/element/game.ts

key-decisions:
  - "AnimateCommand is not invertible (like MESSAGE) -- MCTS falls back to full state restore"
  - "Buffer cleared at performAction() start, not at flow execute blocks"
  - "pushAnimationEvent is a public method on Game (accessed by executor cross-file)"

patterns-established:
  - "ANIMATE command pattern: pure data event on command stack, survives serialization via existing toJSON/replayCommands"
  - "Callback-as-convenience: callback runs after ANIMATE command, mutations are separate commands"

# Metrics
duration: 4min
completed: 2026-02-08
---

# Phase 86 Plan 01: Animate API and Command Stack Summary

**game.animate(type, data, callback?) API with ANIMATE command on command stack, action-boundary buffer lifecycle, and 20 tests covering all four ENG requirements**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-08T00:25:06Z
- **Completed:** 2026-02-08T00:29:20Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- AnimateCommand added to GameCommand union with executor handler and inverse (null)
- game.animate() public method creates ANIMATE command, optional callback runs as normal game code
- performAction() clears animation event buffer at start of each action (ENG-04 lifecycle)
- 20 tests covering pure data events, callback behavior, command stack integration, and buffer lifecycle

## Task Commits

Each task was committed atomically:

1. **Task 1: Add AnimateCommand to the command system** - `4298913` (feat)
2. **Task 2: Implement game.animate(), pushAnimationEvent(), and buffer lifecycle** - `6f51c92` (feat)
3. **Task 3: Comprehensive tests for animate API** - `2e8dfe9` (test)

## Files Created/Modified
- `src/engine/command/types.ts` - AnimateCommand interface added to GameCommand union
- `src/engine/command/executor.ts` - executeAnimate handler pushes to animation event buffer
- `src/engine/command/inverse.ts` - ANIMATE case returns null (not invertible)
- `src/engine/command/index.ts` - AnimateCommand type exported
- `src/engine/index.ts` - AnimateCommand type exported
- `src/engine/element/game.ts` - animate() method, pushAnimationEvent(), buffer clearing in performAction()
- `src/engine/element/animation-events.test.ts` - 20 tests for all four ENG requirements

## Decisions Made
- AnimateCommand follows the MESSAGE pattern for non-invertibility -- MCTS handles this via full state restore fallback, which is already the pattern for SHUFFLE, CREATE, CREATE_MANY, and MESSAGE
- pushAnimationEvent() is public (not private) because the command executor in a separate file needs to call it -- follows existing executor-to-game access pattern
- Buffer clearing happens only at performAction() boundaries, not at flow execute blocks -- execute block events are included in the same batch as the surrounding action

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None -- no external service configuration required.

## Next Phase Readiness
- ANIMATE command is on the command stack and survives serialization -- ready for session layer broadcasting in Phase 86-02
- Buffer lifecycle is complete -- UI consumption in Phase 88-89 can rely on action-scoped batches
- All 529 tests pass (509 existing + 20 new)

---
*Phase: 86-simplified-animation-events*
*Completed: 2026-02-08*
