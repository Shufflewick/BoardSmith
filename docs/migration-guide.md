# Migration Guide

## v3.0: Animation Timeline

v3.0 replaces the server-side theatre view system with a client-side animation timeline. Animation events are now pure data signals -- the server broadcasts truth immediately and never waits on animation playback.

For the complete list of removed APIs, see [BREAKING.md](../BREAKING.md).

### What Changed

The theatre view system (server-managed frozen snapshot, mutation capture, acknowledgment round-trips) has been removed entirely. In its place:

- **Pure data events:** Animation events carry only `type` and `data` -- no captured mutations.
- **Single truth view:** There is no theatre/current view split. `gameView` is always truth.
- **Client-owned playback:** The server broadcasts truth and moves on. The client processes events through a local FIFO queue.
- **Wait-for-handler:** Events pause for lazily-mounted handlers instead of being silently consumed.

### Step 1: Update `game.animate()` calls

**Remove empty callbacks:**

```typescript
// Before
game.animate('score', data, () => {});

// After
game.animate('score', data);
```

**Keep truth-advancing callbacks:**

```typescript
// Before
game.animate('score-complete', data, () => {
  this.addPoints(player, 10);
});

// After -- same (callbacks that advance game state are still supported)
game.animate('score-complete', data, () => {
  this.addPoints(player, 10);
});
```

Callbacks still run immediately as normal game code. The only change is that mutations inside the callback are NOT captured on the event.

**Remove mutation-capture patterns:**

```typescript
// Before -- mutations captured on event for theatre view
game.animate('combat', data, () => {
  target.putInto(graveyard);
});

// After -- mutations happen via normal code, event is pure data
game.animate('combat', data);
target.putInto(graveyard);
```

### Step 2: Update `createAnimationEvents()`

**Remove the `acknowledge` parameter:**

Before:

```typescript
const animationEvents = createAnimationEvents({
  events: () => state.value?.animationEvents,
  acknowledge: (upToId) => {
    session.acknowledgeAnimations(playerSeat, upToId);
  },
});
```

After:

```typescript
const animationEvents = createAnimationEvents({
  events: () => state.value?.animationEvents,
  handlerWaitTimeout: 3000, // optional, default 3s
});
```

### Step 3: Remove `useCurrentView()` usage

Before:

```typescript
import { useCurrentView } from 'boardsmith/ui';
const view = useCurrentView();
```

After:

```typescript
// useCurrentView is removed. Use gameView from GameShell directly.
// gameView is always truth -- there is no theatre/current split.
const { gameView } = props;
```

### Step 4: Remove theatre state references

Before:

```typescript
game.theatreState
game.theatreStateForPlayer(seat)
```

After:

```typescript
game.toJSON()            // truth is the only view
game.toJSONForPlayer(seat)
```

### Step 5: Update animation event handlers (no changes required)

Animation handlers (`registerHandler`) work exactly the same in v3.0. No migration needed for handler code.

### New in v3.0: Wait-for-Handler

Events arriving before their handler registers now pause the queue (up to `handlerWaitTimeout`, default 3s) instead of being silently consumed. This prevents fire-and-forget event loss when components mount after events arrive.

If the timeout expires, a console warning names the event type and ID, and the event is skipped.

### Checklist

- [ ] Remove all empty `() => {}` callbacks from `game.animate()` calls
- [ ] Keep callbacks that advance game state (e.g., `addPoints()`, `remove()`)
- [ ] Remove `acknowledge` parameter from all `createAnimationEvents()` calls
- [ ] Replace `useCurrentView()` with `gameView` from GameShell props
- [ ] Remove any `game.theatreState` or `game.theatreStateForPlayer()` references
- [ ] Remove any `session.acknowledgeAnimations()` calls
- [ ] Remove any `acknowledgeAnimations` WebSocket message handling
- [ ] Update comments referencing "theatre view", "mutation capture", or "acknowledgment"
- [ ] Test all animation flows in browser after migration
