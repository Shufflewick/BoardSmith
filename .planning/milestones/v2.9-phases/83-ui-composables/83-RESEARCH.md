# Phase 83: UI Composables - Research

**Researched:** 2026-02-07
**Domain:** Vue 3 composables, reactive state management, WebSocket client integration
**Confidence:** HIGH

## Summary

This phase wires the Phase 82 session-layer theatre view changes into the Vue 3 UI layer. Phase 82 changed `buildPlayerState()` so that `view` is now theatre state (narrative view reflecting only acknowledged animation events) and `currentView` is truth (only present when animations are pending). The UI layer currently reads `state.value?.state.view` and treats it as truth. This phase needs to update composables so components render from theatre state by default, provide an explicit `useCurrentView()` opt-in API for truth, update `useAnimationEvents` for the new `animate()` flow, make ActionPanel render decisions against theatre state, and implement skip functionality.

The existing codebase is well-structured for these changes. The provide/inject pattern is already used for `gameView`, `actionController`, and `boardInteraction`. The `useAnimationEvents` composable already has the correct handler registration pattern, sequential processing, and skip functionality. The main work is: (1) making the acknowledge callback send a WebSocket message (currently missing from client SDK), (2) updating `GameShell.vue` to wire theatre/current views correctly, (3) creating a `useCurrentView()` composable, and (4) ensuring ActionPanel reads theatre state for mid-animation decisions.

**Primary recommendation:** The changes are mostly wiring -- the hard problems (theatre snapshot, mutation capture, per-player filtering, acknowledge handler) were solved in Phases 80-82. The UI layer changes are largely about plumbing the existing `state.value?.state.view` (which is already theatre state post-Phase 82) and adding the `acknowledgeAnimations` WebSocket message to the client.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | 3.x | UI framework | Already used throughout |
| TypeScript | 5.x | Type safety | Already used throughout |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | latest | Unit testing | Testing composables |

### Alternatives Considered
None -- this phase works entirely within the existing stack.

**Installation:**
No new dependencies needed.

## Architecture Patterns

### Current Data Flow (Post Phase 82)

```
Server (buildPlayerState)
  |-- view: theatreStateForPlayer(player)     <-- THEATRE (default)
  |-- currentView?: getPlayerView(player)     <-- TRUTH (only when divergent)
  |-- animationEvents?: pendingEvents
  v
WebSocket (state message)
  v
GameConnection.handleMessage()
  |-- lastState = { flowState, state: { view, currentView, animationEvents, ... } }
  v
useGame() composable
  |-- state = shallowRef<GameState>()
  v
GameShell.vue
  |-- gameView = computed(() => state.value?.state.view)  <-- Currently provides this
  |-- provide('gameView', gameView)
  v
Child components
  |-- inject('gameView')  <-- All components read this
```

### Target Data Flow (Phase 83)

```
GameShell.vue
  |-- gameView = computed(() => state.value?.state.view)          <-- Theatre (already correct post-82)
  |-- currentGameView = computed(() => state.value?.state.currentView ?? state.value?.state.view)
  |-- provide('gameView', gameView)                               <-- Theatre for all components
  |-- provide('currentGameView', currentGameView)                 <-- Truth for opt-in
  |-- createAnimationEvents({
  |     events: () => state.value?.state.animationEvents,
  |     acknowledge: (upToId) => sendAcknowledgeAnimations(upToId)
  |   })
  v
Components:
  |-- inject('gameView')        = theatre state (default)
  |-- useCurrentView()          = truth (opt-in)
  |-- useAnimationEvents()      = animation playback
```

### Pattern 1: Theatre View as Default (Already Done by Phase 82)

**What:** `state.value?.state.view` IS the theatre state after Phase 82. The `gameView` computed in `GameShell.vue` already provides it.
**When to use:** All rendering components by default.
**Key insight:** No component code needs to change to read theatre state -- Phase 82 made `view` = theatre state at the server level. Components that read `gameView` already get theatre state.

### Pattern 2: useCurrentView() Composable (New)

**What:** An opt-in composable for components that need truth (AI decisions, post-game summary, score calculations).
**When to use:** Only when a component explicitly needs the latest truth, not the narrative view.
**Example:**
```typescript
// In GameShell.vue
const currentGameView = computed(() => {
  // currentView is only present when theatre diverges from truth
  return state.value?.state.currentView ?? state.value?.state.view;
});
provide('currentGameView', currentGameView);

// useCurrentView.ts composable
export function useCurrentView() {
  const currentView = inject('currentGameView');
  if (!currentView) {
    throw new Error('useCurrentView() must be called inside a GameShell context');
  }
  return currentView;
}
```

### Pattern 3: Acknowledge via WebSocket (New)

**What:** The client needs to send `acknowledgeAnimations` messages over WebSocket. Currently the client SDK (`GameConnection`, `MeepleClient`) has no method for this.
**When to use:** When `useAnimationEvents` finishes processing events or the user clicks Skip.
**Key finding:** The server already handles `case 'acknowledgeAnimations'` in `src/server/core.ts:770-788`. The session `WebSocketMessage` type already includes `'acknowledgeAnimations'` in its union (line 534) with `upToId?: number` field (line 554). But the client-side `WebSocketOutgoingMessage` type in `src/client/types.ts:210-216` does NOT include `acknowledgeAnimations`. The `GameConnection` class has no `acknowledgeAnimations()` method.

**Required changes:**
1. Add `'acknowledgeAnimations'` to `WebSocketOutgoingMessage.type` union in `src/client/types.ts`
2. Add `upToId?: number` to `WebSocketOutgoingMessage` in `src/client/types.ts`
3. Add `acknowledgeAnimations(upToId: number): void` method to `GameConnection` class
4. Expose it through `useGame()` composable or pass directly to `createAnimationEvents`

### Pattern 4: AnimationEvents Wiring in GameShell (Update)

**What:** `createAnimationEvents()` is currently NOT called in GameShell.vue. The composable exists and is documented, but GameShell doesn't wire it up. The ActionPanel injects it via `useAnimationEvents()` and checks for null.
**When to use:** Always -- this is the missing integration point.
**Example:**
```typescript
// In GameShell.vue setup
import { createAnimationEvents, provideAnimationEvents } from '../composables/useAnimationEvents.js';

const animationEvents = createAnimationEvents({
  events: () => state.value?.state.animationEvents,
  acknowledge: (upToId) => {
    // Send acknowledge message via WebSocket
    connection?.acknowledgeAnimations(upToId);
  },
});
provideAnimationEvents(animationEvents);

// Also pass to actionController for animation gating
const actionController = useActionController({
  // ... existing options ...
  animationEvents,  // <-- New: enables animationsPending and showActionPanel
});
```

### Anti-Patterns to Avoid

- **Directly accessing `state.value?.state.currentView` in components:** Use `useCurrentView()` to make the opt-in explicit and provide a clear error message when used outside GameShell.
- **Making acknowledge synchronous/fire-and-forget without WebSocket:** The server needs the acknowledge message to advance theatre state and rebroadcast. A simple function call won't work -- it must go through WebSocket.
- **Changing the meaning of `gameView` provide:** `gameView` is already theatre state post-Phase 82. Do NOT try to make it truth and add a separate theatreView -- that would break the semantic change Phase 82 established.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Animation event queue processing | Custom queue with manual dedup | `createAnimationEvents()` already in codebase | Already handles sequential processing, dedup by ID, pause/resume, skip, error recovery |
| Provide/inject for Vue composables | Custom event bus or global state | Vue's provide/inject (existing pattern) | Already used for gameView, actionController, boardInteraction |
| WebSocket message sending | Raw WebSocket.send() in composable | `GameConnection.acknowledgeAnimations()` method | Encapsulates JSON serialization, connection state checks |
| Theatre/truth state switching | Manual computed with watch | Provide two separate injection keys | Clean separation, explicit opt-in |

## Common Pitfalls

### Pitfall 1: GameConnection Has No acknowledgeAnimations Method
**What goes wrong:** The `useAnimationEvents` acknowledge callback needs to send a WebSocket message, but `GameConnection` class has no method for this, and `WebSocketOutgoingMessage` type doesn't include `acknowledgeAnimations`.
**Why it happens:** Phase 82 added the server-side handler but deferred client-side changes to this phase.
**How to avoid:** Add the method to `GameConnection` and update the outgoing message types before wiring `createAnimationEvents`.
**Warning signs:** `acknowledge` callback in `createAnimationEvents` does nothing or errors.

### Pitfall 2: useGame() Doesn't Expose Connection for Acknowledge
**What goes wrong:** `useGame()` composable returns state and action methods but doesn't expose the underlying `GameConnection` for calling `acknowledgeAnimations()`.
**Why it happens:** `useGame()` wraps the connection with a limited API: `{ state, connectionStatus, isConnected, isMyTurn, error, action, connect, disconnect, reconnect, refreshState }`.
**How to avoid:** Either add an `acknowledgeAnimations` method to the `useGame()` return value, or find a way to pass the connection's acknowledge method to `createAnimationEvents`.
**Warning signs:** No way to call acknowledge from GameShell without breaking encapsulation.

### Pitfall 3: Time Travel Breaks Theatre View
**What goes wrong:** GameShell has a time travel feature (`timeTravelState`) that overrides `gameView`:
```typescript
const gameView = computed(() => {
  if (timeTravelState.value) {
    return timeTravelState.value.view as any;
  }
  return state.value?.state.view as any;
});
```
**Why it happens:** Time travel shows historical state. When time traveling, the view should be the historical state, not theatre state.
**How to avoid:** Time travel should still override gameView. But `useCurrentView()` should also respect time travel (show historical truth, not current truth).
**Warning signs:** Time travel shows current state mixed with historical state.

### Pitfall 4: ActionPanel Already Has Animation Gating Logic
**What goes wrong:** The ActionPanel already uses `animationsPending` and `showActionPanel` from the action controller, and has a skip button. Duplicating this logic or changing the interface would break existing behavior.
**Why it happens:** Phase 61-62 added animation gating to ActionPanel. The existing code checks `animationsPending` and renders a "Playing animations..." state with skip button.
**How to avoid:** The existing ActionPanel code is correct. Just wire up `createAnimationEvents` in GameShell and pass `animationEvents` to `useActionController`. The ActionPanel will start working automatically.
**Warning signs:** ActionPanel always shows action buttons during animations (animationsPending is always false because animationEvents is never provided).

### Pitfall 5: Mid-Animation ActionPanel State
**What goes wrong:** When flow yields for player input during an animation sequence, ActionPanel must show decisions against theatre state. If it reads truth, the player sees choices that don't match what they've seen.
**Why it happens:** `actionMetadata` and `availableActions` come from `state.value?.state`. These are already based on truth (the flow state). The choices are correct (what actions are available now), but the game board shows theatre state.
**How to avoid:** ActionPanel already reads `gameView` for element enrichment (via `actionController` which takes `gameView`). Since `gameView` is theatre state, element selections will already show theatre elements. The key insight is that `availableActions` and `actionMetadata` are flow-level data (not element-level), so they correctly come from truth. The combination of truth-based actions + theatre-based element rendering is correct.
**Warning signs:** ActionPanel shows actions that reference elements not yet visible in theatre view.

### Pitfall 6: Skip Must Send All Events to Server
**What goes wrong:** Skip button only clears the local queue but doesn't tell the server to advance all events.
**Why it happens:** The current `skipAll()` implementation calls `acknowledge(lastEvent.id)` which sends ONE acknowledge for all events. This is correct -- the server handles "acknowledge up to ID" semantics.
**How to avoid:** The existing `skipAll()` is correct. It acknowledges up to the last event ID, which tells the server to advance past all pending events. No changes needed to skip logic.
**Warning signs:** After skip, state doesn't update (acknowledge didn't reach server).

## Code Examples

### Exact Changes to GameConnection (src/client/game-connection.ts)

```typescript
// Add to GameConnection class
acknowledgeAnimations(upToId: number): void {
  if (this.ws && this.ws.readyState === WebSocket.OPEN) {
    const message: WebSocketOutgoingMessage = {
      type: 'acknowledgeAnimations',
      upToId,
    };
    this.ws.send(JSON.stringify(message));
  }
}
```

### Exact Changes to WebSocketOutgoingMessage (src/client/types.ts)

```typescript
// Current:
export interface WebSocketOutgoingMessage {
  type: 'action' | 'ping' | 'getState';
  // ...
}

// Change to:
export interface WebSocketOutgoingMessage {
  type: 'action' | 'ping' | 'getState' | 'acknowledgeAnimations';
  // ...existing fields...
  /** For acknowledgeAnimations: acknowledge events up to this ID */
  upToId?: number;
}
```

### Exact Changes to useGame() (src/client/vue.ts)

```typescript
// Add acknowledgeAnimations to UseGameReturn interface
export interface UseGameReturn {
  // ...existing fields...
  /** Acknowledge animation events up to the given ID */
  acknowledgeAnimations: (upToId: number) => void;
}

// In the useGame function, add:
const acknowledgeAnimations = (upToId: number): void => {
  connection?.acknowledgeAnimations(upToId);
};

// Add to return:
return {
  // ...existing...
  acknowledgeAnimations,
};
```

### Exact Changes to GameShell.vue

```typescript
// Add import
import { createAnimationEvents, provideAnimationEvents } from '../composables/useAnimationEvents.js';

// Destructure acknowledgeAnimations from useGame
const { state, connectionStatus, isConnected, isMyTurn, error, action, acknowledgeAnimations } = useGame(
  client,
  gameId,
  { playerSeat }
);

// Create and provide animation events
const animationEvents = createAnimationEvents({
  events: () => state.value?.state.animationEvents,
  acknowledge: (upToId) => acknowledgeAnimations(upToId),
});
provideAnimationEvents(animationEvents);

// Provide current view for opt-in truth access
const currentGameView = computed(() => {
  if (timeTravelState.value) {
    return timeTravelState.value.view as any;  // Time travel overrides both
  }
  return state.value?.state.currentView ?? state.value?.state.view;
});
provide('currentGameView', currentGameView);

// Update actionController to use animationEvents for gating
const actionController = useActionController({
  // ...existing options...
  animationEvents,  // Pass animation events for gating
});
```

### useCurrentView Composable (src/ui/composables/useCurrentView.ts)

```typescript
import { inject, type Ref, type ComputedRef } from 'vue';
import type { GameElement } from '../types.js';

/**
 * Injection key for current (truth) game view.
 * Only use when you need the latest truth -- most components should use gameView (theatre state).
 */
export const CURRENT_VIEW_KEY = 'currentGameView';

/**
 * Get the current (truth) game view.
 *
 * Use this ONLY when you need the latest truth, such as:
 * - AI controller decisions
 * - Post-game summary
 * - Score calculations that must reflect latest state
 *
 * For rendering game elements, use inject('gameView') instead (theatre state).
 *
 * @throws Error if called outside GameShell context
 */
export function useCurrentView(): ComputedRef<GameElement | null> {
  const view = inject<ComputedRef<GameElement | null>>(CURRENT_VIEW_KEY);
  if (!view) {
    throw new Error(
      'useCurrentView() must be called inside a GameShell context. ' +
      'For rendering game elements, use inject(\'gameView\') instead -- ' +
      'it provides the theatre state which is correct for most UI components.'
    );
  }
  return view;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `view` = truth state | `view` = theatre state | Phase 82 | All components now render theatre by default without code changes |
| `emitAnimationEvent()` (fire-and-forget) | `game.animate()` (scoped callback with mutation capture) | Phase 80-81 | Events carry mutations for theatre state advancement |
| No acknowledge mechanism | `acknowledgeAnimations` WebSocket message | Phase 82 | Server advances theatre snapshot on acknowledge |

**Deprecated/outdated:**
- `emitAnimationEvent()`: Replaced by `game.animate()`. Phase 83 should use animate()-based events only. The old emitAnimationEvent still works but lacks mutations.

## Key Facts About Current State

### What Already Works (No Changes Needed)
1. **Theatre state as default view**: Phase 82 changed `buildPlayerState()` so `view` = `theatreStateForPlayer()`. All components reading `gameView` already get theatre state.
2. **AnimationEvent type**: Includes `mutations?: CapturedMutation[]` for theatre advancement.
3. **ActionPanel animation gating**: Already checks `actionController.animationsPending` and `showActionPanel`. Has skip button that calls `animationEvents?.skipAll()`.
4. **useAnimationEvents composable**: Fully implemented with handler registration, sequential processing, dedup, pause/resume, skip, error recovery.
5. **Server-side acknowledge handler**: WebSocket handler, session method, engine acknowledgment, and rebroadcast all wired.

### What Needs Adding
1. **Client-side acknowledge transport**: `GameConnection.acknowledgeAnimations()` method and type updates.
2. **GameShell wiring**: Call `createAnimationEvents()`, call `provideAnimationEvents()`, pass to `useActionController`.
3. **useCurrentView() composable**: Simple provide/inject wrapper for truth opt-in.
4. **useGame() acknowledgeAnimations**: Expose the method through the composable.
5. **Export updates**: Export `useCurrentView` from `src/ui/index.ts`.

### What Needs Testing
1. **E2E**: Animation events arrive via WebSocket, handler plays them, acknowledge goes back to server, theatre state advances, new state broadcast arrives with updated view.
2. **Unit**: `useCurrentView()` returns truth when currentView is present, falls back to view when not.
3. **Integration**: ActionPanel shows "Playing animations..." during playback, shows actions after playback completes.
4. **Integration**: Skip button acknowledges all events, immediately shows current view.

## Open Questions

1. **Per-event vs batch acknowledge timing**
   - What we know: The existing `createAnimationEvents` processes events sequentially but only calls `acknowledge(lastId)` at the end of the batch. Prior decisions say "per-event advancement" but the current composable batches.
   - What's unclear: Should the composable acknowledge after EACH event (causing a WebSocket message + server rebroadcast per event), or batch at end? Per-event means the theatre view updates between each animation on all clients, which is the correct behavior for the theatre model but creates more WebSocket traffic.
   - Recommendation: Change to per-event acknowledge. This is what the prior decision "per-event advancement" means. Each acknowledged event advances the theatre snapshot by one step, so the next state broadcast shows the updated theatre. This is the whole point of the theatre model.

2. **Connection access in GameShell**
   - What we know: `useGame()` returns a limited API. The internal `connection` variable is private.
   - What's unclear: Whether to add `acknowledgeAnimations` to `useGame()` return or expose connection differently.
   - Recommendation: Add `acknowledgeAnimations` to `UseGameReturn` interface. This is the cleanest approach -- it extends the existing pattern without exposing internals.

## Sources

### Primary (HIGH confidence)
- `src/ui/composables/useAnimationEvents.ts` - Full composable implementation, 277 lines
- `src/ui/composables/useActionController.ts` - Action controller with animationEvents gating, 1489 lines
- `src/ui/components/GameShell.vue` - Root component wiring, 1327 lines
- `src/ui/components/auto-ui/ActionPanel.vue` - ActionPanel with existing animation gating, 2109 lines
- `src/session/utils.ts` - `buildPlayerState()` with theatre view, 477 lines (Phase 82 changes)
- `src/session/types.ts` - `PlayerGameState` with `currentView` field, line 418
- `src/client/game-connection.ts` - WebSocket connection class, 480 lines
- `src/client/vue.ts` - Vue composables for client SDK, 487 lines
- `src/client/types.ts` - Client types including WebSocket message types, 360 lines
- `src/server/core.ts` - Server WebSocket handler for acknowledgeAnimations, lines 770-788
- `src/engine/element/game.ts` - AnimationEvent interface, theatre state methods
- `.planning/phases/82-session-integration/82-VERIFICATION.md` - Phase 82 verification (all 4 truths passed)

### Secondary (MEDIUM confidence)
- `src/ui/composables/useAnimationEvents.test.ts` - 813 lines of tests showing expected behavior

### Tertiary (LOW confidence)
- None -- all findings from direct codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries, all existing code
- Architecture: HIGH - All patterns directly observed in codebase, minimal new patterns needed
- Pitfalls: HIGH - All identified from actual code paths and missing integrations

**Research date:** 2026-02-07
**Valid until:** No expiry (all findings from current codebase state)
