# Undo Feature Plan

**Approach:** Time-travel based undo (replay to previous state) rather than reverse-execution

## Key Design Decisions

### What Makes This Different from Original Plan

The original feature doc (`01-undo-redo.md`) proposed snapshot-based undo with undo/redo stacks. Our approach is simpler:

1. **No redo** - Just undo within the current turn
2. **Time-travel based** - Replay game to action N-1 instead of storing snapshots
3. **Turn-scoped** - Only undo actions in YOUR current turn
4. **No undoable flag needed initially** - Actions that reveal hidden info or have randomness naturally create "undo boundaries" through the turn system

### Core Rules

1. **Undo is only available during your own turn**
2. **Undo rewinds to start of your current turn** (not action-by-action)
3. **"End Turn" button confirms your actions** - once clicked, no undo
4. **Undo uses existing time-travel infrastructure** - `GameSession.getStateAtAction()` + replay

## Implementation Plan

### Phase 1: Track Turn Start Index

**Goal:** Know which action index marks the start of the current player's turn

**Changes:**

1. **FlowState additions** (`packages/flow/types.ts`):
   ```typescript
   interface FlowState {
     // ... existing
     turnStartActionIndex?: number;  // Action index when current turn began
   }
   ```

2. **FlowEngine tracking** (`packages/flow/flow-engine.ts`):
   - When `currentPlayer` changes, record current `actionHistory.length` as `turnStartActionIndex`
   - Pass this through to FlowState

3. **GameRunner propagation** (`packages/runtime/src/runner.ts`):
   - Track `turnStartActionIndex` on the runner
   - Update it when player changes
   - Include in FlowState returned from `performAction()`

### Phase 2: Undo API Endpoint

**Goal:** API to undo to turn start

**Changes:**

1. **GameSession method** (`packages/session/src/game-session.ts`):
   ```typescript
   undoToTurnStart(playerPosition: number): UndoResult {
     // Validate: is it this player's turn?
     // Validate: are there actions to undo?
     // Get turnStartActionIndex
     // Replay game to that index
     // Replace runner with replayed state
     // Return new state
   }
   ```

2. **API endpoint** (`packages/cli/src/local-server.ts` and `packages/worker/src/index.ts`):
   ```
   POST /games/:id/undo
   Body: { player: number }
   Response: { success: boolean, state: PlayerGameState, flowState: FlowState }
   ```

### Phase 3: UI - Undo Button

**Goal:** Show "Undo" button when player has made actions this turn

**Changes:**

1. **PlayerGameState additions** (`packages/engine/src/game-view/types.ts`):
   ```typescript
   interface PlayerGameState {
     // ... existing
     canUndo: boolean;        // Has actions to undo this turn
     turnStartIndex: number;  // For reference
     actionsThisTurn: number; // Count of actions made this turn
   }
   ```

2. **GameShell.vue** or **ActionPanel.vue**:
   - Show "Undo" button when `canUndo === true && isMyTurn`
   - Button calls `POST /games/:id/undo`
   - On success, state updates via WebSocket as usual

### Phase 4: UI - End Turn Button (Future Enhancement)

**Note:** This may not be needed for all games. Many games auto-end turns when required actions complete.

**If needed:**
- Add `endTurn` as a special action
- Show "End Turn" button when all required actions are done
- Clicking it prevents further undo

## File Changes Summary

| File | Change |
|------|--------|
| `packages/flow/types.ts` | Add `turnStartActionIndex` to FlowState |
| `packages/flow/flow-engine.ts` | Track and emit turnStartActionIndex |
| `packages/runtime/src/runner.ts` | Track turnStartActionIndex, include in state |
| `packages/session/src/game-session.ts` | Add `undoToTurnStart()` method |
| `packages/cli/src/local-server.ts` | Add `POST /games/:id/undo` endpoint |
| `packages/worker/src/index.ts` | Add `POST /games/:id/undo` endpoint |
| `packages/engine/src/game-view/types.ts` | Add canUndo, turnStartIndex to PlayerGameState |
| `packages/engine/src/game-view/build-state.ts` | Compute canUndo |
| `packages/ui/src/components/GameShell.vue` | Show Undo button, call API |

## What About Non-Undoable Actions?

Your insight is correct - some actions shouldn't be undoable:
- Drawing a card (reveals hidden info)
- Rolling dice (randomness)
- Seeing opponent's hand

**Solution:** These naturally work with turn-scoped undo because:
1. If you draw a card, you've seen it - but you can still undo to turn start (you lose the knowledge)
2. If opponent's turn reveals info, you can't undo their turn anyway
3. If dice roll happens, undoing to turn start means re-rolling (which is fine for casual, problematic for competitive)

**For competitive play:** Could add `undoable: false` flag to actions that locks undo for the turn, but this is a future enhancement.

## Implementation Order

1. **Phase 1:** FlowState tracking (most complex, touches core engine)
2. **Phase 2:** Undo API (builds on time-travel infra)
3. **Phase 3:** Undo button (UI only)
4. **Phase 4:** End Turn button (optional, game-specific)

## Testing Plan

1. Start checkers game
2. Make a move
3. Verify `canUndo: true` and `actionsThisTurn: 1`
4. Click Undo
5. Verify state returns to turn start
6. Make a different move
7. End turn (opponent moves)
8. Verify `canUndo: false` (not your turn)
