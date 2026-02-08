# Breaking Changes

## v3.0 - Animation Timeline

### Removed: Theatre View System

The server-side theatre view system has been removed. In v2.9, the game maintained a frozen snapshot of state (`_theatreSnapshot`), captured mutations during `animate()` callbacks, and advanced the snapshot per-event as clients sent `acknowledgeAnimations` messages. This entire protocol -- engine, session, server, client, and UI -- has been deleted.

Animation playback is now 100% client-owned. The server broadcasts truth immediately and never waits on animation state.

#### Removed APIs

| API | Module | Replacement |
|-----|--------|-------------|
| `game.theatreState` | engine | Use `game.toJSON()` -- truth is the only view |
| `game.theatreStateForPlayer(seat)` | engine | Use `game.toJSONForPlayer(seat)` |
| `game.acknowledgeAnimationEvents(id)` | engine | Removed -- client manages playback locally |
| `game._captureContext` | engine | Removed -- no mutation capture |
| `game.animate()` | engine | Rebuilt in v3.0 as `game.animate(type, data)` pure data emitter |
| `GameSession.acknowledgeAnimations()` | session | Removed -- server does not track animation playback |
| `acknowledgeAnimations` WebSocket message | server | Removed -- server does not accept this message |
| `GameConnection.acknowledgeAnimations()` | client | Removed -- client manages playback locally |
| `useCurrentView()` | ui | Use `gameView` from GameShell (single truth view) |
| `CURRENT_VIEW_KEY` | ui | Removed -- single truth view, no injection key needed |
| `CapturedMutation` type | engine | Removed -- no mutation capture |
| `MutationCaptureContext` type | engine | Removed -- no mutation capture |
| `CreateMutation` type | engine | Removed -- no mutation capture |
| `MoveMutation` type | engine | Removed -- no mutation capture |
| `SetPropertyMutation` type | engine | Removed -- no mutation capture |
| `SetAttributeMutation` type | engine | Removed -- no mutation capture |
| `applyMutation()` | engine | Removed -- was only used for theatre snapshot trees |
| `applyMutations()` | engine | Removed -- was only used for theatre snapshot trees |
| `findElementById()` | engine | Removed -- was only used for theatre snapshot trees |
| `removeElementFromParent()` | engine | Removed -- was only used for theatre snapshot trees |

#### Removed Files

| File | Content |
|------|---------|
| `src/engine/element/theatre-state.ts` | Theatre state applicators, tree helpers, mutation dispatcher |
| `src/engine/element/mutation-capture.ts` | CapturedMutation types, MutationCaptureContext interface |
| `src/engine/element/theatre-state.test.ts` | All theatre state tests |
| `src/engine/element/mutation-capture.test.ts` | All mutation capture tests |
| `src/engine/element/animation-events.test.ts` | Animation event tests (depended on removed `animate()`) |
| `src/session/animation-events.test.ts` | Session animation event tests (depended on theatre protocol) |
| `src/ui/composables/useCurrentView.ts` | Theatre/truth view split composable |
| `src/ui/composables/useCurrentView.test.ts` | Tests for useCurrentView |

---

### Removed: Mutation Capture

The `mutations` field on `AnimationEvent` has been removed. Animation events are now pure data -- they carry `type` and `data` only. The mutation capture machinery (`MutationCaptureContext`, property diffing, element attribute diffing) no longer exists.

**Before (v2.9):**

```typescript
game.animate('combat', { damage: 5 }, () => {
  target.health -= damage;   // Captured as SET_PROPERTY mutation
  target.putInto(graveyard); // Captured as MOVE mutation
});
// event.mutations = [
//   { type: 'SET_PROPERTY', key: 'health', value: 15 },
//   { type: 'MOVE', elementId: '...', toId: '...' }
// ]
```

**After (v3.0):**

```typescript
game.animate('combat', { damage: 5 });
// event = { type: 'combat', data: { damage: 5 } }
// Mutations happen via normal game code, not inside animate callback
```

The animate callback pattern is gone. State changes happen through normal game logic. Animation events describe *what happened* as pure data for the client to visualize.

---

### Removed: Acknowledgment Protocol

The server no longer tracks animation playback state. In v2.9, clients sent `acknowledgeAnimations` messages to advance the server's theatre snapshot. The server would apply captured mutations to the snapshot and broadcast updated state. This entire round-trip is gone.

**Before (v2.9):**

```typescript
// Client receives animation events
const events = state.animationEvents;

// After playing each animation, client acknowledges
ws.send(JSON.stringify({
  type: 'acknowledgeAnimations',
  upToId: events[events.length - 1].id
}));
// Server applies mutations to theatre snapshot
// Server broadcasts updated theatre state to all clients
```

**After (v3.0):**

```typescript
// Client receives animation events with truth state
const events = state.animationEvents;

// Client plays animations locally -- no server communication needed
// UI already shows truth immediately
// Animations are visual-only overlays
```

The following have been removed across the stack:

- **Engine:** `game.acknowledgeAnimationEvents()` removed entirely
- **Session:** `GameSession.acknowledgeAnimations()` method deleted
- **Server:** `acknowledgeAnimations` case in WebSocket message handler deleted
- **Client:** `GameConnection.acknowledgeAnimations()` method deleted
- **Client SDK:** `useGame()` no longer returns `acknowledgeAnimations`

---

### Removed: currentView / Theatre View Split

`PlayerGameState` no longer has separate `view` (theatre) and `currentView` (truth) fields. There is only `view`, and it always contains truth.

**Before (v2.9):**

```typescript
// PlayerGameState had two views when animations were pending:
state.view        // Theatre state (frozen at pre-animation snapshot)
state.currentView // Truth (latest state, only present when animations pending)

// Components chose which to display:
const view = useCurrentView(); // Returned theatre during animation, truth after
```

**After (v3.0):**

```typescript
// PlayerGameState has one view, always truth:
state.view // Truth (always current)

// Components use truth directly:
const { gameView } = inject(/* from GameShell */);
// gameView is always the current truth
```

The `useCurrentView()` composable and `CURRENT_VIEW_KEY` injection key have been deleted. Components that previously used `useCurrentView()` should use the `gameView` provided by `GameShell`.
