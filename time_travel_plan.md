# Time Travel Debugging Plan

**STATUS: PHASE 2 COMPLETE**

Based on comparison between `features/03-time-travel-debugging.md` and current implementation.

## Current State - What's Already Implemented

### Backend Infrastructure ✅ COMPLETE

The engine/runtime/session packages already provide:

1. **Command History** (`Game.commandHistory: GameCommand[]`)
   - Automatically tracked in `packages/engine/src/element/game.ts`
   - Every mutation recorded as event-sourced command

2. **Action History** (`GameRunner.actionHistory: SerializedAction[]`)
   - High-level player actions tracked in `packages/runtime/src/runner.ts`
   - Serialized with element/player references

3. **Snapshots** (`createSnapshot()`, `createPlayerView()`)
   - Full game state serialization in `packages/engine/src/utils/snapshot.ts`
   - Version, timestamp, command history, action history, flow state

4. **Diff Computation** (`computeDiff()`)
   - Already implemented in snapshot.ts
   - Detects new commands/actions, added/removed/changed elements

5. **Replay** (`GameRunner.replay()`, `GameRunner.fromSnapshot()`)
   - Can rebuild game from action history
   - Deterministic with seed-based random

6. **Replay Files** (`createReplayFile()`, `parseReplayFile()`)
   - Standardized format for export/import in `packages/engine/src/utils/replay.ts`

7. **API Endpoints**
   - `GET /games/:id/history` - Returns action history and createdAt timestamp
   - `GET /games/:id/state-at/:actionIndex` - Returns state after replaying to specific action (**NEW**)

---

## Implementation Status

### Phase 1: History Tab in Debug Panel ✅ COMPLETE

**File:** `packages/ui/src/components/DebugPanel.vue`

- "History" tab with action list
- Auto-refresh on state changes
- Player-colored badges
- Action arguments display

### Phase 2: Time Travel UI ✅ COMPLETE

**Backend additions:**
- `GameSession.getStateAtAction(actionIndex, playerPosition)` - Replays game to specific point
- `GET /games/:id/state-at/:actionIndex?player=N` - API endpoint (added to both worker AND local-server.ts)

**UI additions:**
- **Timeline slider** - Scrub through game history
- **Step buttons** - Previous/Next action navigation
- **Live button** - Return to current state
- **Click to select** - Click any action in history list to view its state
- **Historical state banner** - Shows when viewing past state with "Back to Live" button
- **State display** - Shows state at selected point (or live state)
- **Visual indicators** - Orange highlighting for selected action and historical state
- **Main game UI updates** - DebugPanel emits `time-travel` event, GameShell overrides `gameView` with historical state
- **Actions disabled** - When viewing history, ActionPanel shows no actions and displays amber banner

### Phase 3: State Diff Highlighting ⏳ FUTURE

- Show what changed between actions
- Highlight added/removed/changed elements

---

## How to Test

1. Start a game:
   ```bash
   cd packages/games/go-fish && npx boardsmith dev
   ```

2. Make several moves to build up history

3. Press 'D' to open debug panel

4. Click "History" tab

5. **Timeline slider**: Drag to any point, state tab updates
6. **Click action**: Click any action in the list to jump to that point
7. **Step buttons**: Use < > to step through one action at a time
8. **Live button**: Click to return to current game state
9. **State tab**: Shows "Viewing state after action N" banner when in history mode

---

## Files Modified

| File | Changes |
|------|---------|
| `packages/session/src/game-session.ts` | Added `getStateAtAction()` method |
| `packages/worker/src/index.ts` | Added `/state-at/:actionIndex` route and handler |
| `packages/cli/src/local-server.ts` | Added `/state-at/:actionIndex` route for dev server |
| `packages/ui/src/components/DebugPanel.vue` | Full time travel UI: slider, selection, historical state display, `time-travel` emit |
| `packages/ui/src/components/GameShell.vue` | Added `timeTravelState` refs, `handleTimeTravel()`, updated `gameView` computed, time travel banner |

## Implementation Checklist

- [x] Add History tab to DebugPanel
- [x] Fetch action history from API
- [x] Display action list with formatting
- [x] Player color indicators
- [x] Current action highlighting
- [x] Loading/error/empty states
- [x] Auto-refresh on state changes
- [x] Add `getStateAtAction()` to GameSession
- [x] Add `/state-at/:actionIndex` API endpoint
- [x] Timeline slider in History tab
- [x] Step forward/back buttons
- [x] Click-to-select actions
- [x] Live button to return to current state
- [x] Historical state banner in State tab
- [x] Update State tab to show historical state
- [x] Build and verify
- [x] Main game UI updates when viewing history
- [x] Actions disabled when viewing history
- [x] Time travel banner in action bar
- [ ] State diff highlighting (future)

## Architecture Notes

**How state-at-point works:**
1. Client calls `GET /games/:id/state-at/:actionIndex?player=N`
2. Server creates a temporary `GameRunner` with same config
3. Replays actions 0 through actionIndex-1 using `GameRunner.replay()`
4. Returns the player view from the temporary game
5. Original game state is NOT modified

**Performance considerations:**
- Each state-at request replays from scratch
- For long games, could add periodic snapshots (every N actions)
- Current approach is simple and correct, optimize if needed

**Index semantics:**
- Index 0 = Initial state (no actions played)
- Index 1 = State after first action
- Index N = State after N actions (where N = actionHistory.length is current live state)
