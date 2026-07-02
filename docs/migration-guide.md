# Migration Guide

## v4.4: Agent-Ergonomics

v4.4 closes the determinism guarantee (no `Math.random` fallback anywhere in
the engine) and adds the FLOW/VIS/SIM/ERR/DRIVE/ANIM agent-ergonomics
surface documented in [Agent Control](./agent-control.md),
[boardsmith/testing](./api/testing.md), and
[Custom UI Guide](./custom-ui-guide.md). This section lists every
removed/changed API.

### What Changed

- The headless test-harness module moved and lost its old import path.
- `ElementCollection.shuffle()` now requires an explicit RNG argument — no
  silent `Math.random()` fallback.
- `playUntilComplete()` is deterministic by default (a fixed literal seed)
  instead of defaulting to `Math.random()`-derived randomness.
- Animation helpers (`useElementAnimation`, `useFLIP`, `useFlyingElements`)
  now fail loud in development when a target element has no anchor
  attribute, instead of silently no-oping.
- `onPersistenceError` gained two additional arguments.
- `anchorAttrs()` gained a second parameter.

### Step 1: Update the headless test-harness import

```typescript
// Before — internal, test-only module path (never a public package export)
import { createHeadlessSession } from './session/testing/headless-harness.js';

// After — public export from the boardsmith/session barrel
import { createHeadlessSession } from 'boardsmith/session';
```

The old module (`src/session/testing/headless-harness.ts`) is deleted — there
is no re-export shim at the old path. This only affects code that imported
the internal module directly by relative path; it was never part of a public
subpath export.

### Step 2: Pass an explicit RNG to `ElementCollection.shuffle()`

```typescript
// Before (implicit Math.random() fallback)
someCollection.shuffle();

// After — pass the game's seeded RNG explicitly (same as Space/Deck's own
// shuffle() wrapper already does internally)
someCollection.shuffle(game.random);
```

If you were shuffling a `Deck`/`Space` via its own `.shuffle()` method
(no arguments), nothing changes — that wrapper already threads `game.random`
through internally and was never affected by this break. This change only
affects direct callers of the lower-level `ElementCollection.shuffle(random)`.

### Step 3: `playUntilComplete()` is now deterministic by default

```typescript
// Before — no-options calls used Math.random()-derived randomness,
// producing a different playthrough on every run.
playUntilComplete(testGame);

// After — no-options calls use a fixed literal seed
// ('playUntilComplete-default'), so re-running the same test reproduces the
// identical command history. Pass your own `seed` or `rng` to vary it.
playUntilComplete(testGame);                          // now reproducible by default
playUntilComplete(testGame, { seed: 'my-run-seed' });  // explicit seed
playUntilComplete(testGame, { rng: () => 0 });         // escape-hatch: fully custom rng
```

No call-site changes are required — this is a behavior change, not a
signature change. If a test was relying on non-determinism across repeated
`playUntilComplete()` calls in the same process (rare), pass a different
`seed` per call.

### Step 4: Animation helpers fail loud on missing anchors

```typescript
// Before — a custom board element missing data-bs-el-id silently failed to
// animate, with no visible signal during development.

// After — the same gap throws an actionable dev-only error naming the
// composable, the attribute searched for, and the fix. Production builds
// still degrade gracefully (console.error + skip), matching prior behavior.
```

Fix by spreading `anchorAttrs(ref, type)` (or `useSelectable()`'s `attrs`)
onto every animated/draggable board element — see
[Custom UI Guide: Anchor Requirements & Fail-Loud](./custom-ui-guide.md#anchor-requirements--fail-loud-animation).

### Step 5: `onPersistenceError` signature change

```typescript
// Before
onPersistenceError?: (error: PersistenceErrorEntry) => void;

// After — two additional arguments: a running consecutive-failure count and
// a `healthy` flag (flips false after 3 consecutive failures, recovers on
// the next successful save)
onPersistenceError?: (
  error: PersistenceErrorEntry,
  consecutiveFailures: number,
  healthy: boolean,
) => void;
```

See [Agent Control: Structured Errors (ERR)](./agent-control.md#structured-errors-err)
for the full `persistenceHealthy`/`lastPersistenceError` observable-state
story this enables.

### Step 6: `anchorAttrs()` signature change

```typescript
// Before
anchorAttrs(ref: ElementRef): Record<string, string>;

// After — optional `type` label for the missing-anchor dev warning's
// dedup key (defaults to 'unknown' when omitted, preserving prior behavior)
anchorAttrs(ref: ElementRef, type: string = 'unknown'): Record<string, string>;
```

Existing single-argument call sites keep working unchanged. Pass a `type`
(e.g. `'card'`, `'piece'`, `'grid-cell'`) from renderer components so a
missing-anchor bug in your board names the actual component, not a generic
`'unknown'` bucket shared by every board element.

### Checklist

- [ ] Update `createHeadlessSession` imports from `boardsmith/session/testing/headless-harness` to `boardsmith/session`
- [ ] Pass an explicit RNG to any direct `ElementCollection.shuffle()` calls (not `Deck`/`Space.shuffle()` — that wrapper is unaffected)
- [ ] Review any test relying on `playUntilComplete()` non-determinism across repeated calls; pass an explicit `seed` if so
- [ ] Spread `anchorAttrs(ref, type)` (or `useSelectable()`'s `attrs`) onto every custom board element that animates or drag-drops
- [ ] Update any `onPersistenceError` callback to accept `(error, consecutiveFailures, healthy)`
- [ ] Pass a `type` label to `anchorAttrs()` calls in custom renderer components (optional but recommended)

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

### Step 5: Update animation event handlers (optional skip support)

Animation handlers (`registerHandler`) work the same in v3.0. Handlers now receive an optional second argument `{ signal }` with an `AbortSignal` that fires when the user presses "Skip". Handlers can check `signal.aborted` between animation steps to bail out early:

```typescript
// Before (still works)
animations.registerHandler('combat', async (event) => {
  await playAttack(event.data);
  await showDamage(event.data);
});

// After (adds skip support)
animations.registerHandler('combat', async (event, { signal }) => {
  await playAttack(event.data);
  if (signal.aborted) return;
  await showDamage(event.data);
});
```

Existing handlers that don't use the signal still work — the queue will unblock immediately when skip is pressed regardless.

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
