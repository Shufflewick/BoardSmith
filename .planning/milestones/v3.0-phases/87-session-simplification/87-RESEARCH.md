# Phase 87: Session Simplification - Research

**Researched:** 2026-02-07
**Domain:** Session layer state broadcasting, WebSocket message handling, animation event integration
**Confidence:** HIGH

## Summary

This phase simplifies the session layer's state broadcasting to send a single truth view with animation events -- no theatre/currentView split, no acknowledgment protocol. Research reveals that **most of the work is already done** from Phases 85 and 86.

The current codebase state shows:
1. `buildPlayerState()` in `src/session/utils.ts` already produces a single `view` field containing truth state (line 355: `runner.getPlayerView(playerPosition).state`). There is no `currentView` or theatre split -- Phase 85 removed it.
2. `buildPlayerState()` already includes animation events from the game's pending buffer (lines 446-450). Phase 86 added `game.pendingAnimationEvents` which this code reads.
3. `acknowledgeAnimations()` has already been removed from `GameSession` (Phase 85 verification confirms this at line 55-56).
4. The `acknowledgeAnimations` WebSocket message handler has already been removed from `GameServerCore` (Phase 85 verification confirms at line 56-57). The `WebSocketMessage` type union no longer includes `'acknowledgeAnimations'`.

**Primary recommendation:** The four SES requirements are already satisfied in the current code. This phase should verify and document completeness, clean up stale JSDoc references, and potentially add integration tests to prove the requirements hold.

## Standard Stack

No new libraries needed. This phase works entirely within existing codebase modules:

### Core
| Module | File | Purpose | Status |
|--------|------|---------|--------|
| session/utils.ts | `buildPlayerState()` | Builds per-player state for broadcasting | Already sends truth view + animation events |
| session/game-session.ts | `GameSession` | Session management, broadcasting | `acknowledgeAnimations()` already removed |
| server/core.ts | `GameServerCore` | WebSocket message routing | `acknowledgeAnimations` case already removed |
| session/types.ts | `PlayerGameState` | Type definition for player state | Already has `view` (no `currentView`), `animationEvents?`, `lastAnimationEventId?` |
| engine/game.ts | `Game` | Animation event buffer | `pendingAnimationEvents` getter, `pushAnimationEvent()`, buffer cleared per `performAction()` |

## Architecture Patterns

### Current Data Flow (Already Correct)

```
game.animate('combat', data)
  --> AnimateCommand on command stack
  --> game.pushAnimationEvent() adds to _animationEvents buffer

game.performAction() starts
  --> _animationEvents = [] (cleared)
  --> Action executes, may call animate() which refills buffer
  --> Action completes

session.broadcast()
  --> buildPlayerState(runner, names, position)
    --> truthView = runner.getPlayerView(position).state  (single view)
    --> animationEvents = runner.game.pendingAnimationEvents (copy of buffer)
    --> Returns { view: truthView, animationEvents?: [...] }
  --> send(session, { type: 'state', state, flowState })
```

### PlayerGameState Structure (Current)

```typescript
interface PlayerGameState {
  phase: string;
  players: Array<{ name: string; seat: number; [key: string]: unknown }>;
  currentPlayer?: number;
  availableActions?: string[];
  isMyTurn: boolean;
  view: unknown;                        // <-- Single truth view (SES-01)
  animationEvents?: AnimationEvent[];    // <-- From game buffer (SES-02)
  lastAnimationEventId?: number;         // <-- Convenience for clients
  actionMetadata?: Record<string, ActionMetadata>;
  canUndo?: boolean;
  actionsThisTurn?: number;
  turnStartActionIndex?: number;
  customDebug?: Record<string, unknown>;
  colorSelectionEnabled?: boolean;
}
// No 'currentView' field exists (SES-01 satisfied)
// acknowledgeAnimations() does not exist on GameSession (SES-03 satisfied)
// WebSocketMessage type does not include 'acknowledgeAnimations' (SES-04 satisfied)
```

### Anti-Patterns to Avoid
- **Re-introducing theatre view:** Do not add any "pre-animation" snapshot. The client sees truth immediately and plays animations as visual embellishment.
- **Server-side animation tracking:** The server never waits on animation playback. Don't add any form of per-player animation state on the server.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-player visibility filtering | Custom view filtering | `runner.getPlayerView(position).state` | Already handles hidden information via the engine's view system |
| Animation event deduplication | Custom dedup logic | Game's `performAction()` buffer clearing | Buffer is cleared at each `performAction()` boundary -- events are always a fresh batch |

## Common Pitfalls

### Pitfall 1: Assuming Work Still Needs to Be Done
**What goes wrong:** Spending time implementing changes that already exist in the codebase.
**Why it happens:** The requirements document shows SES-01 through SES-04 as "Pending", but Phase 85 already removed the theatre/currentView split and acknowledgeAnimations from session + server. Phase 86 added the animation event buffer.
**How to avoid:** Verify each requirement against the current codebase before planning implementation work.
**Warning signs:** Finding that code you planned to write/delete already matches the target state.

### Pitfall 2: Stale Documentation References
**What goes wrong:** Old JSDoc comments reference removed APIs, causing confusion.
**Why it happens:** Phase 85 removed `session.acknowledgeAnimations()` but left stale references in `useAnimationEvents.ts` JSDoc.
**How to avoid:** Clean up JSDoc in `src/ui/composables/useAnimationEvents.ts` lines 15 and 45.
**Current stale references:**
- Line 15: `acknowledge: (upToId) => session.acknowledgeAnimations(upToId),`
- Line 45: `/** Callback to acknowledge events (calls session.acknowledgeAnimations) */`

### Pitfall 3: GameShell No-Op Acknowledge Callback
**What goes wrong:** `GameShell.vue` line 170 still passes `acknowledge: () => {}` to `createAnimationEvents()`.
**Why it happens:** Phase 85 removed the real callback but left a no-op to avoid breaking the `createAnimationEvents` signature.
**How to avoid:** This is intentionally deferred to Phase 89 (CLI-10) which removes the acknowledge parameter from `createAnimationEvents()` entirely. Do NOT fix this in Phase 87.

### Pitfall 4: Engine acknowledgeAnimationEvents() Still Exists
**What goes wrong:** Confusion about whether SES-03 is satisfied because `game.acknowledgeAnimationEvents()` still exists on the Game class.
**Why it happens:** SES-03 specifically targets `GameSession.acknowledgeAnimations()` (session layer), NOT `game.acknowledgeAnimationEvents()` (engine layer). The engine method was intentionally kept as infrastructure for the `useAnimationEvents` composable.
**How to avoid:** Read the requirement carefully -- it says "Remove `acknowledgeAnimations()` from GameSession", which is already done.

## Code Examples

### Current buildPlayerState() Implementation (Already Correct)

```typescript
// Source: src/session/utils.ts:346-453
export function buildPlayerState(
  runner: GameRunner,
  playerNames: string[],
  playerPosition: number,
  options?: { includeActionMetadata?: boolean; includeDebugData?: boolean }
): PlayerGameState {
  const flowState = runner.getFlowState();

  // Truth view -- always the current game state (SES-01)
  const truthView = runner.getPlayerView(playerPosition).state;

  // ... (available actions, undo info, player data computation) ...

  const state: PlayerGameState = {
    phase: runner.game.phase,
    players: fullPlayerData,
    currentPlayer: flowState?.currentPlayer,
    availableActions,
    isMyTurn,
    view: truthView,  // Single truth view, no theatre/currentView split
    canUndo,
    actionsThisTurn: isMyTurn ? actionsThisTurn : 0,
    turnStartActionIndex: isMyTurn ? turnStartActionIndex : undefined,
  };

  // ... (action metadata, debug data, color selection) ...

  // Include animation events if any are pending (SES-02)
  const animationEvents = runner.game.pendingAnimationEvents;
  if (animationEvents.length > 0) {
    state.animationEvents = animationEvents;
    state.lastAnimationEventId = animationEvents[animationEvents.length - 1].id;
  }

  return state;
}
```

### WebSocketMessage Type (Already Correct -- No acknowledgeAnimations)

```typescript
// Source: src/session/types.ts:529-549
export interface WebSocketMessage {
  type: 'action' | 'ping' | 'getState' | 'getLobby' | 'claimSeat' | 'updateName' |
        'setReady' | 'addSlot' | 'removeSlot' | 'setSlotAI' | 'leaveSeat' |
        'kickPlayer' | 'updatePlayerOptions' | 'updateSlotPlayerOptions' |
        'updateGameOptions';
  // No 'acknowledgeAnimations' in the union (SES-04)
  // ...
}
```

### GameServerCore WebSocket Handler (Already Correct -- No acknowledgeAnimations case)

```typescript
// Source: src/server/core.ts:468-771
async handleWebSocketMessage(session, gameId, message) {
  switch (message.type) {
    case 'action': // ... handles actions
    case 'getState': // ... handles state requests
    case 'ping': // ... handles keepalive
    case 'getLobby': // ... handles lobby
    // ... other lobby cases
    // NO 'acknowledgeAnimations' case exists (SES-04)
  }
}
```

## State of the Art

| Old Approach (Pre-Phase 85) | Current Approach (Post-Phase 85/86) | When Changed | Impact |
|------------------------------|--------------------------------------|--------------|--------|
| `buildPlayerState()` returned `currentView` (theatre) + truth | Returns single `view` (truth only) | Phase 85 | SES-01 already satisfied |
| `GameSession.acknowledgeAnimations()` existed | Method removed | Phase 85 | SES-03 already satisfied |
| `acknowledgeAnimations` WebSocket handler existed | Handler removed | Phase 85 | SES-04 already satisfied |
| No animation events in `PlayerGameState` | `animationEvents?` field populated from game buffer | Phase 86 | SES-02 already satisfied |

## Requirements Status Analysis

### SES-01: `buildPlayerState()` sends truth as single `view` (no theatre/currentView split)
**Status:** ALREADY SATISFIED
**Evidence:** `src/session/utils.ts:355` -- `const truthView = runner.getPlayerView(playerPosition).state;` is assigned to `view` field (line 416). No `currentView` field exists in `PlayerGameState` type (confirmed in `src/session/types.ts:407-431`).
**Confidence:** HIGH

### SES-02: `buildPlayerState()` includes animation events from current flow step
**Status:** ALREADY SATISFIED
**Evidence:** `src/session/utils.ts:446-450` -- reads `runner.game.pendingAnimationEvents` and sets `state.animationEvents` and `state.lastAnimationEventId`. The `PlayerGameState` type has both fields (lines 426-428).
**Confidence:** HIGH

### SES-03: Remove `acknowledgeAnimations()` from GameSession
**Status:** ALREADY SATISFIED
**Evidence:** `grep acknowledgeAnimat src/session/game-session.ts` returns zero results. Phase 85 verification (line 55) confirms removal.
**Confidence:** HIGH

### SES-04: Remove `acknowledgeAnimations` WebSocket message handler from server
**Status:** ALREADY SATISFIED
**Evidence:** `grep acknowledgeAnimat src/server/core.ts` returns zero results. `WebSocketMessage` type (line 530) does not include `'acknowledgeAnimations'` in the union. Phase 85 verification (line 56-57) confirms removal.
**Confidence:** HIGH

## Remaining Work

Since all four SES requirements are already satisfied, the remaining work for this phase is:

### 1. Verification and Documentation
- Update `REQUIREMENTS.md` to mark SES-01 through SES-04 as complete
- Write verification report confirming all success criteria

### 2. Optional Cleanup (Stale References)
These are cosmetic and could wait for later phases:
- `src/ui/composables/useAnimationEvents.ts` lines 15, 45: stale JSDoc referencing `session.acknowledgeAnimations`
- `docs/nomenclature.md` line 466: references `acknowledgeAnimationEvents` in theatre context
- `.planning/MILESTONES.md` and `.planning/PROJECT.md`: stale references to theatre/acknowledge protocol

### 3. Test Coverage Gap
There are no dedicated tests proving:
- `buildPlayerState()` includes animation events when they exist
- `buildPlayerState()` omits animation events when buffer is empty
- State broadcasts include animation events for all connected players

Adding integration tests would strengthen confidence and serve as regression guards.

## Open Questions

1. **Should this phase add integration tests?**
   - What we know: The code works (verified in Phase 85/86 verifications). No dedicated buildPlayerState + animation events test exists.
   - What's unclear: Whether tests should be added in this phase or deferred
   - Recommendation: Add at least one integration test proving `buildPlayerState()` includes animation events, as this creates a regression guard for the SES-02 requirement.

2. **Should stale JSDoc cleanup happen here or in Phase 89?**
   - What we know: Phase 89 (CLI-10) removes the `acknowledge` parameter from `createAnimationEvents()`. The stale JSDoc references `session.acknowledgeAnimations()` which is the acknowledge callback.
   - Recommendation: Clean stale JSDoc in this phase since it references session-layer APIs that SES-03 removed. Phase 89 handles the composable API change.

## Sources

### Primary (HIGH confidence)
- `src/session/utils.ts` -- `buildPlayerState()` implementation (lines 346-453)
- `src/session/types.ts` -- `PlayerGameState` interface (lines 407-431), `WebSocketMessage` type (line 530)
- `src/session/game-session.ts` -- Full class, no `acknowledgeAnimations` method (1793 lines)
- `src/server/core.ts` -- `handleWebSocketMessage` switch statement (lines 475-771), no acknowledgeAnimations case
- `src/engine/element/game.ts` -- Animation buffer (lines 328-331, 2370-2418)

### Secondary (HIGH confidence)
- `.planning/phases/85-theatre-erasure/85-VERIFICATION.md` -- Confirms removal of acknowledgeAnimations from session and server
- `.planning/phases/86-simplified-animation-events/86-VERIFICATION.md` -- Confirms animation buffer implementation
- `.planning/REQUIREMENTS.md` -- SES-01 through SES-04 listed as Pending but code analysis shows satisfied

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Direct codebase inspection, no external dependencies
- Architecture: HIGH -- Data flow traced through actual source code
- Pitfalls: HIGH -- Based on verified Phase 85/86 outcomes
- Requirements status: HIGH -- Each requirement verified against current source code with exact line numbers

**Research date:** 2026-02-07
**Valid until:** Indefinite (internal codebase analysis, no external dependency concerns)
