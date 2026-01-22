---
phase: 56
plan: 03
subsystem: ui
tags: [vue, components, composables, nomenclature, seat]

dependency-graph:
  requires: [56-01]
  provides: [ui-seat-terminology, player-seat-props, data-player-seat-attributes]
  affects: [56-04]

tech-stack:
  patterns: [provide-inject, vue-props, data-attributes]

key-files:
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/components/PlayersPanel.vue
    - src/ui/components/WaitingRoom.vue
    - src/ui/components/DebugPanel.vue
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/auto-ui/AutoGameBoard.vue
    - src/ui/components/auto-ui/AutoUI.vue
    - src/ui/components/auto-ui/AutoElement.vue
    - src/ui/components/helpers/FlyingCardsOverlay.vue
    - src/ui/composables/useActionController.ts
    - src/ui/composables/useActionControllerTypes.ts
    - src/ui/composables/useGameViewHelpers.ts
    - src/ui/composables/useAutoAnimations.ts
    - src/ui/composables/useAutoFlyingElements.ts
    - src/ui/composables/useAutoFlyToStat.ts
    - src/ui/composables/usePlayerStatAnimation.ts
    - src/ui/composables/useElementChangeTracker.ts
    - src/ui/composables/useHexGrid.ts
    - src/ui/composables/useGameGrid.ts
    - src/ui/composables/useActionAnimations.ts

decisions:
  - title: "API parameter names preserved"
    rationale: "GameConnection.playerPosition kept for API stability"

metrics:
  duration: ~45min
  completed: 2026-01-22
---

# Phase 56 Plan 03: UI Components and Composables Seat Rename Summary

**One-liner:** Vue components and composables updated to use playerSeat props, player.seat accessors, and data-player-seat attributes

## What Changed

### Core Shell Components (Task 1)

**GameShell.vue:**
- `playerPosition` ref renamed to `playerSeat`
- `provide('playerPosition', ...)` changed to `provide('playerSeat', ...)`
- Template props `:player-position` changed to `:player-seat`
- All computed properties accessing `playerPosition.value` updated

**PlayersPanel.vue:**
- `Player` interface: `position` renamed to `seat`
- Props: `playerPosition` and `currentPlayerPosition` renamed to `playerSeat` and `currentPlayerSeat`
- Template: `player.position` changed to `player.seat`

**WaitingRoom.vue:**
- Function parameters: `playerPosition` renamed to `playerSeat`

**DebugPanel.vue:**
- Props interface: `playerPosition` renamed to `playerSeat`
- API query params updated

### Auto-UI Components (Task 2)

**ActionPanel.vue:**
- Prop `playerPosition` renamed to `playerSeat`

**AutoGameBoard.vue:**
- Prop `playerPosition` renamed to `playerSeat`
- Provide key changed from `'playerPosition'` to `'playerSeat'`

**AutoUI.vue:**
- Prop and template binding updated

**AutoElement.vue:**
- Inject key changed from `'playerPosition'` to `'playerSeat'`
- `isOwned` computed: checks `player?.seat === playerSeat`
- `playerName` computed: uses `player?.seat`

**FlyingCardsOverlay.vue:**
- Piece rendering: `playerPosition` property renamed to `playerSeat`
- JSDoc updated throughout

### Composables (Task 3)

**useActionController.ts / useActionControllerTypes.ts:**
- Option `playerPosition` renamed to `playerSeat`
- Internal usages updated

**useGameViewHelpers.ts:**
- All function parameters renamed: `playerPosition` -> `playerSeat`
- `findPlayerHand()`: checks `player?.seat`
- `findPlayerElement()`: checks `attrs.seat`
- `getElementOwner()`: returns `player?.seat`
- `isOwnedByPlayer()`, `isMyElement()`, `isOpponentElement()`: params updated

**useAutoAnimations.ts:**
- JSDoc examples updated
- Data attribute changed from `data-player-position` to `data-player-seat`
- Card data property: `playerPosition` -> `playerSeat`

**useAutoFlyingElements.ts:**
- JSDoc examples updated to use `playerSeat`

**useAutoFlyToStat.ts:**
- Interface comments and card data properties updated

**usePlayerStatAnimation.ts:**
- Interface: `FlyToStatOptions.playerPosition` -> `playerSeat`
- `CardForAnimation.playerPosition` -> `playerSeat`
- `getPlayerStatElement()`: looks for `data-player-seat` attribute
- All function parameters updated

**useElementChangeTracker.ts:**
- JSDoc examples updated

**useHexGrid.ts / useGameGrid.ts:**
- JSDoc examples updated

**useActionAnimations.ts:**
- JSDoc examples updated

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| API parameter names preserved | `GameConnection.playerPosition` kept for backward compatibility with server API |
| Data attributes renamed | `data-player-position` -> `data-player-seat` for consistency with seat terminology |
| Test files not updated | Test mocks use `playerPosition` which is fine as they test the internal API |

## Deviations from Plan

None - plan executed as written.

## Verification Results

- `npx vue-tsc --noEmit`: No type errors
- `grep -r "playerPosition" src/ui/`: Only found in test files (expected)
- `grep -r "playerSeat" src/ui/`: Found in all 20 expected component and composable files

## Commits

1. `186797b` feat(56-03): update core UI components with playerSeat terminology (Task 1 - from previous session)
2. `a3bbd5b` feat(56-03): update auto-ui components with playerSeat terminology (Task 2)
3. `0bddd82` feat(56-03): update composables with playerSeat terminology (Task 3)

## Next Phase Readiness

Phase 56 Plan 04 (extracted games) can proceed. All UI components and composables now use:
- `playerSeat` props instead of `playerPosition`
- `player.seat` instead of `player.position`
- `data-player-seat` instead of `data-player-position`
- `'playerSeat'` inject/provide keys
