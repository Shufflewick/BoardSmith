# BoardSmith Migration Guide

This guide covers breaking changes and migration steps between BoardSmith versions.

## v2.3 - Nomenclature Standardization

v2.3 standardizes terminology across the codebase for clarity and consistency.

### API Renames

| Before (v2.2) | After (v2.3) | Type |
|---------------|--------------|------|
| `Player.position` | `Player.seat` | Property |
| `playerPosition` props | `playerSeat` props | Vue props |
| `currentSelection` | `currentPick` | Composable |
| `SelectionMetadata` | `PickMetadata` | Type |
| `fetchSelectionChoices` | `fetchPickChoices` | Option |
| `injectSelectionStepFn` | `injectPickStepFn` | Injection |

### Component Renames

| Before (v2.2) | After (v2.3) | Notes |
|---------------|--------------|-------|
| `GameBoard.vue` | `GameTable.vue` | In your game projects |

Note: `AutoGameBoard` component was NOT renamed (it's a distinct component).

### Slot Names (Unchanged)

The `#game-board` slot name in `GameShell` was NOT changed. Only the component filename changed.

### Backward Compatibility

Deprecated aliases are available for the following:
- `currentSelection` - use `currentPick` instead
- `SelectionMetadata` - use `PickMetadata` instead

These aliases will be removed in a future major version.

### Migration Steps

1. **Update component imports:**
   ```typescript
   // Before
   import GameBoard from './GameBoard.vue';
   // After
   import GameTable from './GameTable.vue';
   ```

2. **Update player property access:**
   ```typescript
   // Before
   const seat = player.position;
   // After
   const seat = player.seat;
   ```

3. **Update Vue props:**
   ```vue
   <!-- Before -->
   <MyComponent :player-position="1" />
   <!-- After -->
   <MyComponent :player-seat="1" />
   ```

4. **Update selection composable:**
   ```typescript
   // Before
   const { currentSelection } = useBoardInteraction();
   // After
   const { currentPick } = useBoardInteraction();
   ```

### Terminology Changes

For consistent communication:
- Say "pick" when referring to a choice the player must make
- Say "seat" when referring to a player's place at the table
- Say "table" when referring to the game area (the board is ON the table)

See [Nomenclature](./nomenclature.md) for the complete terminology reference.

---

## Related Documentation

- [Nomenclature](./nomenclature.md) - Standard terminology reference
- [Getting Started](./getting-started.md) - New project setup
