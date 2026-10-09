# Migration Guide

## The game context's turn signals follow time travel; `usePlayContext()` works in a world

The game context now carries `isViewingHistory`, and while the debug panel shows
history its `isMyTurn` is false and its `availableActions` empty, matching the
board's props (#520). A component that read the live values from the context to
offer controls during a browse now withdraws them, which is the point: those
controls could not commit.

A component shared between a table and a world reads `usePlayContext()` instead of
raw `inject(GAME_CONTEXT_KEYS.<field>)` calls. `tryUseGameContext()` returns
`undefined` in a world instead of throwing.

## `boardsmith/testing` has one way to do each thing

`boardsmith/testing` dropped the exports that duplicated another one or that
nothing used (#517, #518, #519). A game test that imports one of them stops
type-checking. Replace each as follows:

| Removed | Use instead |
|---|---|
| `assertActionSucceeds(g, seat, action, args)` | `g.doAction(seat, action, args)`, which throws with the availability trace, flow position and seed |
| `simulateAction(g, seat, action, args)` | `g.tryAction(seat, action, args)`; the result no longer echoes `action` / `playerSeat` / `args` |
| `simulateActions(g, steps)` | a loop of `g.tryAction(...)` |
| `SimulateActionResult` | `ActionExecutionResult` from `boardsmith/runtime` |
| `playUntilComplete(g)`, `GameStuckError`, `PlayUntilCompleteOptions` | `simulateRandomGames(GameClass, { ... })` or `replayRandomGame(...)`; for a test about `enumerateLegalMoves` itself, a short loop over it with `doAction` |
| `assertFlowState(g, { ... })`, `ExpectedFlowState`, `FlowStateAssertionResult` | `assertActionAvailable` / `assertActionNotAvailable`, or read `g.getFlowState()` |
| `assertGameFinished(g, { winner })` | `expect(g.isComplete()).toBe(true)` and `g.getWinners()` |
| `getVisibleElements(game, seat)`, `testGame.getVisibleElements(seat)` | `game.all(...).filter((e) => isElementVisible(e, seat))` |
| `testGame.isElementVisible(el, seat)` | the standalone `isElementVisible(el, seat)` |
| `assertTutorialStep(...)` | `assertTutorialCompletes(result)`, or `result.finalStepId` |
| `viewPlayerRef(...)`, `assertViewFixtureShape(...)`, `ViewPlayerRef` | capture a real view with `testGame.getPlayerView(seat)` or `renderAsSeat` instead of building one by hand |

`assertActionFails` now returns an `ActionExecutionResult`. The random
simulator now asks the engine's `dueSeats` which seats may act, the same rule
every host uses, so a simultaneous step is never played for a stale
`currentPlayer`.

## GameShell's `providesOwnGameOverUI` is now `providesOwnGameOverUi`

Written in kebab-case, `provides-own-game-over-ui` camelized to
`providesOwnGameOverUi`, which was not the prop's name, so Vue passed it
through as a plain attribute and the shell still drew its game-over card
(#433). The prop is renamed so both forms reach it. A game still passing the
old name gets the same silent miss, so rename it:

```diff
-  <GameShell :providesOwnGameOverUI="true" ...>
+  <GameShell provides-own-game-over-ui ...>
```

Every prop of a component exported from `boardsmith/ui`,
`boardsmith/ui/auto-ui` or `boardsmith/ui/dice` now has to survive that round
trip; `src/ui/public-prop-names.test.ts` fails on one that does not.

## Engine contract r106: a test wires a table's actions with `useTableActionWiring`

Contract r106 (#356) replaced `useBoardActionBridge`'s `restoreEpoch` option
with `runnerIdentity` (`{ gameInstanceId, restoreEpoch }`), so a new game tears
down an open pick the way an undo does. That change shipped with no note here,
and every game test that wired `useActionController` and `useBoardActionBridge`
together stopped type-checking (TS2353, `'restoreEpoch' does not exist`) (#378).

The fix is not the new option name. A game should never have been passing
either: which state fields the bridge reads is the engine's business. So
`useBoardActionBridge` is no longer exported from `boardsmith/ui`, and
`useTableActionWiring` takes its place. It builds the controller and the bridge
from the seat's `PlayerGameState`, reading the action metadata, disabled
reasons, tutorial step and runner identity itself, and GameShell wires its own
actions with the same function.

```diff
-  const controller = useActionController({
-    sendAction, availableActions, actionMetadata, isMyTurn, disabledActions,
-    playerSeat: ref(seat), autoFill: true, autoExecute: true, fetchPickChoices,
-  });
-  useBoardActionBridge({
-    controller, boardInteraction: board, isMyTurn, autoEndTurn: ref(true),
-    actionMetadata, availableActions, disabledActions, isViewingHistory: ref(false),
-    restoreEpoch: computed(() => state.value.restoreEpoch),
-  });
+  const { controller, actionMetadata, disabledActions } = useTableActionWiring({
+    seatState: state,                     // Ref<PlayerGameState>
+    availableActions: computed(() => state.value.availableActions ?? []),
+    isMyTurn: computed(() => state.value.isMyTurn),
+    playerSeat: ref(seat),
+    boardInteraction: board,
+    autoEndTurn: ref(true),
+    isViewingHistory: ref(false),
+    sendAction, fetchPickChoices,
+  });
```

`autoFill` and `autoExecute` are gone from the call: a table auto-fills when
`autoEndTurn` is on and always executes once every pick is filled, as GameShell
always has. Pass the returned `actionMetadata` and `disabledActions` to an
`ActionPanel` you mount beside the board. `src/cli/slash-command/bs/build/test.md`
(the a11y floor, item 1) has the whole test shape.

## Engine contract r17 → r23

A run of upstream fixes. Most need nothing from a game; these four do.

### The game context is provided under typed keys, not strings (r21)

`GameShell` used to `provide()` its twelve context values under bare string keys
while the library's own composables used typed `InjectionKey` symbols, so every
consumer cast and a misspelled key was a silent `undefined`. The string keys are
gone.

A game only feels this if it mounts a BoardSmith component directly — the
common case is an a11y test mounting the real `ActionPanel`, which throws when
it cannot find a controller:

```diff
-  global: { provide: { actionController: controller } }
+  global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } }
```

```typescript
import { GAME_CONTEXT_KEYS } from 'boardsmith/ui';
```

A custom UI reading the context should use `useGameContext()`, which throws
outside a shell rather than returning a bag of `undefined`s:

```typescript
import { useGameContext } from 'boardsmith/ui';
const { gameView, playerSeat, actionController } = useGameContext();
```

### `boardsmith publish` requires a target (r18)

There is no default, because the default used to be production:

```diff
-boardsmith publish
+boardsmith publish --prod    # or --dev
```

### `--bot-level expert` is rejected (r18)

It was never a real preset and silently played at medium. Use `easy`, `medium`,
`hard`, or an explicit iteration count.

### Authoring mistakes now throw (r18)

Four things that used to warn and carry on:

- an attribute that clobbers `id`/`_t`/`_ctx` in `create()`
- an action `condition` that throws (it was read as "condition false", so the
  action silently vanished)
- a flow step naming an action that is not registered
- detected element-tree corruption, at dev/test time

Each was already a bug; the change is that it stops rather than degrades. A game
that was relying on any of them was not doing what it looked like it was doing.

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

### Step 3: Animation helpers fail loud on missing anchors

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

### Step 4: `onPersistenceError` signature change

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

### Step 5: `anchorAttrs()` signature change

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
