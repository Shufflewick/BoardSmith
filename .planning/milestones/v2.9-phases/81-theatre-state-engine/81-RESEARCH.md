# Phase 81: Theatre State Engine - Research

**Researched:** 2026-02-06
**Domain:** Engine-level theatre state management with per-event mutation advancement
**Confidence:** HIGH

## Summary

Phase 81 adds a "theatre state" to the Game class -- a snapshot of game state that reflects only acknowledged events' mutations. When `game.animate()` is called, mutations apply immediately to the real game state (truth), but the theatre state stays behind. Acknowledging an event by ID applies that event's captured mutations to the theatre state, advancing it one step forward. This lets the UI render a "narrative" view where players never see the future ahead of animations.

The existing codebase provides all the building blocks: `game.toJSON()` serializes the complete element tree and game properties, `Game.restoreGame()` reconstructs from JSON, animation events with `mutations` arrays are already produced by Phase 80's `animate()` method, and the `acknowledgeAnimationEvents()` method already handles per-ID acknowledgment (currently just removing events from the buffer). The theatre state is fundamentally an ElementJSON snapshot plus game properties that gets mutated in place (or regenerated) as events are acknowledged.

The key architectural decision is how to represent the theatre state. There are two viable approaches: (1) maintain a separate serialized JSON snapshot that gets patched per-event, or (2) maintain a second Game instance ("shadow game") that replays mutations. After analysis, the JSON snapshot approach is clearly superior: it's simpler, serializes trivially, doesn't require class registries or flow engines, and directly produces the format that `buildPlayerState()` already consumes.

**Primary recommendation:** Add a `_theatreSnapshot` field to Game that holds an `ElementJSON` (same format as `toJSON()` output). Take the snapshot when the first `animate()` call occurs (lazy initialization). Acknowledging events applies mutations to this JSON snapshot. The snapshot serializes alongside animation events in `toJSON()` and restores in `restoreGame()`.

## Standard Stack

No external libraries needed. This is pure engine-level TypeScript work within the existing codebase.

### Core Files to Modify
| File | Purpose | Change Scope |
|------|---------|-------------|
| `src/engine/element/game.ts` | Game class -- theatre snapshot lifecycle, acknowledgment, serialization | Major |
| `src/engine/element/mutation-capture.ts` | Add mutation application functions (apply mutation to JSON) | Major |

### New Files
| File | Purpose |
|------|---------|
| `src/engine/element/theatre-state.ts` | Theatre state types, snapshot management, mutation application logic |
| `src/engine/element/theatre-state.test.ts` | Tests for theatre state engine |

### Files That May Need Updates
| File | Impact | Reason |
|------|--------|--------|
| `src/engine/element/index.ts` | Trivial | Export new types |
| `src/engine/index.ts` | Trivial | Export from barrel |

### Files That Do NOT Need Changes in This Phase
| File | Reason |
|------|--------|
| `src/session/utils.ts` (buildPlayerState) | Phase 82 -- session integration |
| `src/ui/composables/useAnimationEvents.ts` | Phase 83 -- UI composables |
| `src/session/game-session.ts` | Phase 82 -- session integration |

## Architecture Patterns

### Core Concept: Theatre State as Serialized Snapshot

The theatre state is stored as the same `ElementJSON & { phase, messages, settings, ... }` format that `game.toJSON()` already produces. This is the type that `toJSONForPlayer()` produces, that `buildPlayerState()` consumes, and that `Game.restoreGame()` accepts. Using the same format means:

- No new serialization format to invent
- The snapshot IS the format that the session layer already sends to clients
- `toJSONForPlayer()` can filter the theatre snapshot just like it filters truth
- Checkpoint serialization is just "include it in toJSON output"

### Pattern 1: Lazy Snapshot Initialization

**What:** The theatre snapshot is `null` when no animate() calls have been made. It's created from `game.toJSON()` immediately BEFORE the first animate() callback runs (capturing pre-mutation state).
**When to use:** Always. Most games don't use animate() at all, so the theatre state should have zero overhead when unused.
**Key insight:** The snapshot must be taken BEFORE the animate callback executes, because the callback mutates game state immediately. The snapshot captures the "last acknowledged" state.

```typescript
// In game.ts, inside animate():
animate(type, data, callback) {
  // ... existing nested guard ...

  // Initialize theatre snapshot if this is the first animate() call
  if (!this._theatreSnapshot) {
    this._theatreSnapshot = this.toJSON();
  }

  // ... existing capture context setup ...
  // ... callback execution ...
  // ... mutation diffing ...
  // ... event creation ...
}
```

**Why before and not after:** Consider the sequence:
1. Game state = A
2. `animate('x', {}, () => { mutate to B })`
3. Game state = B, theatre should still show A
4. `animate('y', {}, () => { mutate to C })`
5. Game state = C, theatre should still show A
6. Acknowledge event x --> theatre shows B
7. Acknowledge event y --> theatre shows C

The snapshot must be taken at step 2, showing state A.

### Pattern 2: Mutation Application on JSON

**What:** Functions that apply CapturedMutation records to an ElementJSON snapshot, advancing it.
**When to use:** When acknowledgeAnimationEvents() is called.

Each mutation type maps to a specific JSON transformation:

```typescript
// MOVE: Find element by ID in source parent's children, move to destination parent's children
function applyMoveMutation(snapshot: ElementJSON, mutation: MoveMutation): void {
  const element = removeElementFromParent(snapshot, mutation.elementId);
  if (!element) return; // Element not found (edge case: already moved)
  const dest = findElementById(snapshot, mutation.toParentId);
  if (!dest) return;
  if (!dest.children) dest.children = [];
  if (mutation.position === 'first') {
    dest.children.unshift(element);
  } else {
    dest.children.push(element);
  }
}

// CREATE: Add new element to parent's children
function applyCreateMutation(snapshot: ElementJSON, mutation: CreateMutation): void {
  const parent = findElementById(snapshot, mutation.parentId);
  if (!parent) return;
  if (!parent.children) parent.children = [];
  const newElement: ElementJSON = {
    className: mutation.className,
    id: mutation.elementId,
    name: mutation.name,
    attributes: mutation.attributes ? { ...mutation.attributes } : {},
  };
  parent.children.push(newElement);
}

// SET_ATTRIBUTE: Find element by ID, update attribute in its attributes object
function applySetAttributeMutation(snapshot: ElementJSON, mutation: SetAttributeMutation): void {
  const element = findElementById(snapshot, mutation.elementId);
  if (!element) return;
  element.attributes[mutation.attribute] = mutation.newValue;
}

// SET_PROPERTY: Update top-level game property in the snapshot
function applySetPropertyMutation(snapshot: ElementJSON, mutation: SetPropertyMutation): void {
  // Game properties live in the root ElementJSON's attributes
  (snapshot as Record<string, unknown>)[mutation.property] = mutation.newValue;
}
```

### Pattern 3: Acknowledgment Advances Theatre State

**What:** `acknowledgeAnimationEvents()` is extended to apply mutations from acknowledged events to the theatre snapshot before removing them from the buffer.
**When to use:** When the session layer (or UI) acknowledges that animation playback is complete.
**Key detail:** Events must be acknowledged in order. The existing API `acknowledgeAnimationEvents(upToId)` acknowledges all events with `id <= upToId`, which guarantees ordering.

```typescript
acknowledgeAnimationEvents(upToId: number): void {
  if (this._theatreSnapshot) {
    // Apply mutations from events being acknowledged, in order
    const eventsToAck = this._animationEvents
      .filter(e => e.id <= upToId)
      .sort((a, b) => a.id - b.id);

    for (const event of eventsToAck) {
      if (event.mutations) {
        for (const mutation of event.mutations) {
          applyMutation(this._theatreSnapshot, mutation);
        }
      }
    }
  }

  // Remove acknowledged events (existing behavior)
  this._animationEvents = this._animationEvents.filter(e => e.id > upToId);

  // If no more pending events, clear theatre snapshot (truth and theatre are in sync)
  if (this._animationEvents.length === 0) {
    this._theatreSnapshot = null;
  }
}
```

### Pattern 4: Serialization Round-Trip

**What:** Theatre snapshot and pending event state serialize in `toJSON()` and restore in `restoreGame()`.
**When to use:** Checkpoint/restore, HMR, MCTS cloning.

```typescript
// In toJSON():
override toJSON() {
  return {
    ...super.toJSON(),
    phase: this.phase,
    // ... existing fields ...
    ...(this._animationEvents.length > 0 && {
      animationEvents: this._animationEvents,
      animationEventSeq: this._animationEventSeq,
    }),
    // Theatre snapshot -- only serialized when pending events exist
    ...(this._theatreSnapshot && {
      theatreSnapshot: this._theatreSnapshot,
    }),
  };
}

// In restoreGame():
if (json.theatreSnapshot) {
  game._theatreSnapshot = json.theatreSnapshot;
}
```

### Pattern 5: Theatre View Access

**What:** A public getter that returns the theatre snapshot (or current state if no theatre state exists).
**When to use:** Phase 82's `buildPlayerState()` will call this instead of `toJSON()` for the default player view.

```typescript
/**
 * Get the theatre state -- the "narrative" view that reflects only acknowledged events.
 * Returns the theatre snapshot if animations are pending, or current toJSON() if in sync.
 */
get theatreState(): ReturnType<Game['toJSON']> {
  return this._theatreSnapshot ?? this.toJSON();
}
```

### Recommended Project Structure

```
src/engine/element/
  theatre-state.ts            # Theatre types, mutation applicators, findElementById, etc.
  theatre-state.test.ts       # Tests for theatre state engine
  mutation-capture.ts         # Existing -- unchanged
  game.ts                     # Modified: _theatreSnapshot, lazy init in animate(),
                              #   extended acknowledgeAnimationEvents(), serialization
```

### Anti-Patterns to Avoid

- **Shadow Game Instance:** Do NOT maintain a second Game object as the theatre state. Game instances are heavy (flow engine, action executor, class registry, event callbacks), have side effects during construction, and would need complex synchronization. The JSON snapshot is lightweight and sufficient.

- **Re-serializing on every access:** Do NOT call `toJSON()` every time someone asks for the theatre state. The snapshot is taken once (lazily) and mutated in place via acknowledged mutations. Re-serializing would be O(n) on every access.

- **Deep cloning the snapshot per mutation:** Do NOT deep-clone the theatre snapshot before applying each mutation. Mutations modify the snapshot in place, which is the whole point. The snapshot IS the mutable theatre state.

- **Tracking "theatre position" separately:** Do NOT maintain a separate index or counter for "how far through the event list the theatre state has advanced." The events themselves are the source of truth -- when acknowledged, mutations are applied and events are removed. The theatre snapshot reflects exactly the mutations that have been applied.

- **Applying mutations to Events without mutations:** Events produced by `emitAnimationEvent()` have `mutations: undefined`. Acknowledging these events should still remove them from the buffer but skip mutation application. This is a natural consequence of the `if (event.mutations)` guard.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Element tree serialization | Custom snapshot format | `game.toJSON()` (existing) | Already handles attributes, visibility, children, element refs |
| Finding elements by ID in JSON | Walk tree each time | `findElementById()` recursive search | Simple, and element trees are small (10-500 nodes for board games) |
| Deep value comparison | Custom equality | `JSON.stringify()` comparison (existing pattern) | Game values are JSON-serializable by design |
| Event ordering | Custom ordering logic | Array order + `id` comparison | Events already have monotonically increasing IDs and are stored in order |

**Key insight:** The theatre state operates on `ElementJSON` -- a simple, flat JSON structure. No class instances, no proxies, no getters. Just plain objects with `className`, `id`, `attributes`, and `children` arrays. This makes mutation application straightforward object manipulation.

## Common Pitfalls

### Pitfall 1: Game-Level Properties Live Outside `attributes`

**What goes wrong:** SET_PROPERTY mutations target game-level custom properties (e.g., `game.score`). In the live Game object, these are instance properties. But in the `toJSON()` output, Game extends `super.toJSON()` which puts own-properties in `attributes`, PLUS game-specific fields (`phase`, `messages`, `settings`) are explicitly added at the top level.
**Why it happens:** The `toJSON()` method for Game overlays explicit fields on top of `super.toJSON()`. Custom game properties like `score` end up in `attributes` (from the GameElement base toJSON). But `phase`, `messages`, `settings` are explicit top-level fields.
**How to avoid:** When applying SET_PROPERTY mutations, check if the property exists in `snapshot.attributes` (custom game properties like `score`, `round`, `status`). Game system properties (`phase`, `messages`, `settings`) should NOT be captured as mutations -- and they aren't, because `_snapshotCustomProperties()` skips them via `_safeProperties` and `unserializableAttributes`.
**Warning signs:** Property mutation applied but theatre state doesn't reflect it -- check whether the property landed in `attributes` vs. top-level.

### Pitfall 2: The Pile is Separate from the Main Tree

**What goes wrong:** `piece.remove()` moves a piece to `game.pile`, which is NOT in the main element tree (its parent is `undefined`). The `toJSON()` output does NOT include the pile. So a MOVE mutation whose `toParentId` is the pile's ID won't find a destination in the snapshot.
**Why it happens:** The pile is an internal container for removed elements, deliberately kept out of the serialized tree.
**How to avoid:** When applying a MOVE mutation where the destination is the pile, simply remove the element from the snapshot entirely (remove from source parent's children, don't add anywhere). Detect this by checking if `findElementById(snapshot, mutation.toParentId)` returns null -- if the destination isn't in the snapshot, the element is being removed from play.
**Warning signs:** Elements that should be "removed" still appear in the theatre state.

### Pitfall 3: Snapshot Timing with Multiple animate() Calls

**What goes wrong:** If the snapshot is taken at the wrong time, it shows intermediate state instead of the last-acknowledged state.
**Why it happens:** Multiple `animate()` calls can happen in sequence within a single action execution:
```
game.animate('a', {}, () => { piece1.remove() })  // truth: piece1 removed
game.animate('b', {}, () => { piece2.remove() })  // truth: piece1+piece2 removed
```
**How to avoid:** Take the snapshot ONCE, before the first animate() callback runs (lazy init). Subsequent animate() calls don't re-snapshot -- the theatre state was already captured at the pre-animation baseline. The snapshot advances only through acknowledgment.
**Warning signs:** Theatre state showing state after some animate() callbacks but not others.

### Pitfall 4: toJSON() is Not Free

**What goes wrong:** Calling `game.toJSON()` for the initial snapshot is a full serialization pass. If animate() is called many times per action, this only happens once (lazy init), but the cost exists.
**Why it happens:** toJSON() walks the entire element tree, serializes all attributes, creates JSON objects.
**How to avoid:** Lazy initialization means toJSON() is called at most once per "animation sequence" (from first animate() call to all events acknowledged). For typical board games with 10-500 elements, this is fast. No optimization needed.
**Warning signs:** Performance issues in games with very large element trees (unlikely for board games).

### Pitfall 5: Theatre Snapshot and Player Visibility

**What goes wrong:** The theatre snapshot from `toJSON()` contains the full, unfiltered state. But different players should see different filtered views.
**Why it happens:** `toJSON()` serializes everything. `toJSONForPlayer()` applies visibility filtering.
**How to avoid:** This is a Phase 82 concern. The engine-level theatre state stores the FULL (unfiltered) snapshot. The session layer in Phase 82 will apply `toJSONForPlayer()`-equivalent filtering to the theatre snapshot when building per-player views. For Phase 81, the theatre snapshot is the truth-minus-unacknowledged-mutations, without visibility filtering.
**Warning signs:** None for Phase 81. Phase 82 must handle this.

### Pitfall 6: Element References in Serialized State

**What goes wrong:** Game properties may contain element references (e.g., `game.winner` is a HexPlayer). In `toJSON()`, these become `{ __playerRef: 1 }` or `{ __elementRef: "0/2" }`. When applying SET_PROPERTY mutations that contain element references, the `newValue` in the mutation is a raw value (from `structuredClone` of the live object), not a serialized reference.
**Why it happens:** `_snapshotCustomProperties()` uses `structuredClone()`, which would fail on GameElement references. But the existing code already skips element references (the `if (value && typeof value === 'object' && '_t' in value) continue;` guard). So SET_PROPERTY mutations should never contain element references directly.
**How to avoid:** The existing guard in `_snapshotCustomProperties()` handles this. SET_PROPERTY mutations contain only JSON-serializable values (numbers, strings, arrays, plain objects). Applying them to the snapshot is safe.
**Warning signs:** A SET_PROPERTY mutation whose value contains `_t` or circular references -- this would indicate the snapshot guard failed.

### Pitfall 7: Clearing Theatre State Too Early

**What goes wrong:** Theatre snapshot is cleared when `_animationEvents` is empty after acknowledgment. But if new animate() calls happen between acknowledgments, the snapshot could be prematurely cleared and re-initialized from the wrong base state.
**Why it happens:** The lifecycle is: first animate() -> snapshot taken -> events accumulate -> events acknowledged -> mutations applied to snapshot -> all events acked -> snapshot cleared -> next animate() -> snapshot re-taken.
**How to avoid:** Only clear `_theatreSnapshot = null` when ALL events have been acknowledged (`_animationEvents.length === 0` after filtering). If new events arrive before all are acknowledged, the snapshot persists.
**Warning signs:** Theatre state showing a "jump" -- showing truth momentarily then snapping back to an older state.

## Code Examples

### findElementById in JSON Tree

```typescript
// Source: Derived from game-element.ts atId() pattern, adapted for ElementJSON
function findElementById(node: ElementJSON, id: number): ElementJSON | undefined {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findElementById(child, id);
      if (found) return found;
    }
  }
  return undefined;
}
```

### removeElementFromParent in JSON Tree

```typescript
// Source: Derived from piece.ts moveToInternal pattern, adapted for ElementJSON
function removeElementFromParent(root: ElementJSON, elementId: number): ElementJSON | undefined {
  // Search all nodes for a child with the given ID
  function searchAndRemove(node: ElementJSON): ElementJSON | undefined {
    if (!node.children) return undefined;
    const index = node.children.findIndex(c => c.id === elementId);
    if (index !== -1) {
      return node.children.splice(index, 1)[0];
    }
    for (const child of node.children) {
      const found = searchAndRemove(child);
      if (found) return found;
    }
    return undefined;
  }
  return searchAndRemove(root);
}
```

### applyMutation Dispatcher

```typescript
// Source: Derived from mutation-capture.ts CapturedMutation type
function applyMutation(snapshot: ElementJSON, mutation: CapturedMutation): void {
  switch (mutation.type) {
    case 'MOVE':
      applyMoveMutation(snapshot, mutation);
      break;
    case 'CREATE':
      applyCreateMutation(snapshot, mutation);
      break;
    case 'SET_ATTRIBUTE':
      applySetAttributeMutation(snapshot, mutation);
      break;
    case 'SET_PROPERTY':
      applySetPropertyMutation(snapshot, mutation);
      break;
  }
}
```

### SET_PROPERTY on Game-Level Snapshot

```typescript
// Game custom properties live in snapshot.attributes (from super.toJSON())
// Example: game.score = 10 -> snapshot.attributes.score = 10
function applySetPropertyMutation(
  snapshot: ElementJSON & Record<string, unknown>,
  mutation: SetPropertyMutation
): void {
  // Custom game properties are in attributes (from GameElement.toJSON())
  snapshot.attributes[mutation.property] = mutation.newValue;
}
```

### Theatre Snapshot Lazy Init in animate()

```typescript
animate(type: string, data: Record<string, unknown>, callback: () => void): AnimationEvent {
  // ... existing nested guard ...

  // Lazy-init theatre snapshot before first animate() mutations
  if (!this._theatreSnapshot) {
    this._theatreSnapshot = this.toJSON();
  }

  // ... existing: propertySnapshot, elementAttrSnapshot ...
  // ... existing: capture context, callback, diffing ...
  // ... existing: event creation and push ...
}
```

### Extended acknowledgeAnimationEvents

```typescript
acknowledgeAnimationEvents(upToId: number): void {
  // Apply mutations to theatre snapshot for acknowledged events
  if (this._theatreSnapshot) {
    const eventsToAck = this._animationEvents
      .filter(e => e.id <= upToId)
      .sort((a, b) => a.id - b.id);

    for (const event of eventsToAck) {
      if (event.mutations) {
        for (const mutation of event.mutations) {
          applyMutation(this._theatreSnapshot, mutation);
        }
      }
    }
  }

  // Existing behavior: remove acknowledged events
  this._animationEvents = this._animationEvents.filter(e => e.id > upToId);

  // Clear theatre snapshot when all events acknowledged (truth and theatre in sync)
  if (this._animationEvents.length === 0) {
    this._theatreSnapshot = null;
  }
}
```

### Serialization/Deserialization

```typescript
// In toJSON() -- add theatre snapshot
override toJSON() {
  return {
    ...super.toJSON(),
    phase: this.phase,
    isFinished: this.isFinished(),
    messages: this.messages,
    settings: this.settings,
    ...(this._animationEvents.length > 0 && {
      animationEvents: this._animationEvents,
      animationEventSeq: this._animationEventSeq,
    }),
    ...(this._theatreSnapshot && {
      theatreSnapshot: this._theatreSnapshot,
    }),
  };
}

// In restoreGame() -- restore theatre snapshot
static restoreGame<G extends Game>(json, GameClass, classRegistry): G {
  // ... existing restore logic ...

  // Restore theatre snapshot if present
  if ((json as any).theatreSnapshot) {
    game._theatreSnapshot = (json as any).theatreSnapshot;
  }

  return game;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| UI shows truth immediately, plays animations as hints | Theatre state holds pre-animation snapshot, advances per-ack | Phase 81 (this phase) | UI can render "narrative" state without seeing future |
| `acknowledgeAnimationEvents()` just removes events from buffer | Also applies captured mutations to theatre snapshot | Phase 81 | Acknowledgment now has semantic meaning for state |
| No snapshot needed -- clients always see truth | Theatre snapshot is lazy-initialized before first animate() | Phase 81 | Zero overhead when animate() not used |

## Open Questions

### 1. Should the theatre snapshot include the pile?

**What we know:** `toJSON()` does NOT include the pile (removed elements). When a piece is removed (moved to pile), the MOVE mutation's `toParentId` is the pile's ID, which won't be found in the snapshot.
**What's unclear:** Should we add special handling for "move to non-existent destination = removal" or should we serialize the pile too?
**Recommendation:** Treat "destination not found in snapshot" as removal. This is simpler and matches the semantic meaning. The pile is an implementation detail that the theatre state shouldn't expose. Confidence: HIGH.

### 2. Should DevSnapshot/captureDevState also capture theatre state?

**What we know:** `captureDevState()` calls `game.toJSON()`, which will now include `theatreSnapshot` when present. HMR restore via `restoreDevState()` currently doesn't handle the theatre snapshot.
**What's unclear:** Whether HMR scenarios need to preserve animation state.
**Recommendation:** Include it for correctness (if it's in toJSON, it should survive HMR). The restoreDevState path uses the Game.restoreGame-like pattern, so it should naturally pick up the snapshot if we add it to restore. LOW priority -- can be addressed if HMR-during-animation becomes a real scenario. Confidence: MEDIUM.

### 3. How should `theatreState` getter handle `toJSONForPlayer` filtering?

**What we know:** The theatre snapshot is unfiltered (contains all elements, all attributes). Phase 82 needs filtered views per-player.
**What's unclear:** Whether Phase 81 should provide a filtered getter or just the raw snapshot.
**Recommendation:** Phase 81 provides only the raw, unfiltered `theatreState` getter. Phase 82 will handle per-player filtering by applying the same visibility logic that `toJSONForPlayer()` uses. Keep Phase 81 focused on the engine-level mechanics. Confidence: HIGH.

### 4. Events without mutations (emitAnimationEvent)

**What we know:** `emitAnimationEvent()` produces events with `mutations: undefined`. These events exist in the buffer and get acknowledged.
**What's unclear:** How acknowledging mutation-less events should interact with the theatre state.
**Recommendation:** Acknowledge them normally -- skip mutation application (the `if (event.mutations)` guard handles this), remove from buffer as usual. The theatre snapshot does not change when a mutation-less event is acknowledged. This is correct behavior -- `emitAnimationEvent` events don't carry state changes. Confidence: HIGH.

## Sources

### Primary (HIGH confidence)
- `src/engine/element/game.ts` -- Game class, toJSON(), restoreGame(), animate(), acknowledgeAnimationEvents(), _snapshotCustomProperties(), _safeProperties, unserializableAttributes
- `src/engine/element/game-element.ts` -- GameElement base class, toJSON(), fromJSON(), serializeValue(), resolveElementReferences()
- `src/engine/element/mutation-capture.ts` -- CapturedMutation types (CREATE, MOVE, SET_ATTRIBUTE, SET_PROPERTY), MutationCaptureContext
- `src/engine/element/piece.ts` -- putInto() with MOVE capture, remove() delegates to putInto(pile)
- `src/engine/element/types.ts` -- ElementJSON type definition
- `src/engine/utils/snapshot.ts` -- GameStateSnapshot, createSnapshot()
- `src/engine/utils/dev-state.ts` -- DevSnapshot, captureDevState(), restoreDevState(), createCheckpoint()
- `src/session/checkpoint-manager.ts` -- CheckpointManager, capture/findNearest
- `src/session/utils.ts` -- buildPlayerState() attaches animationEvents to PlayerGameState
- `src/session/game-session.ts` -- acknowledgeAnimations() delegates to game.acknowledgeAnimationEvents()
- `src/ui/composables/useAnimationEvents.ts` -- UI-side event processing, handler registration, acknowledge callback
- `src/engine/element/mutation-capture.test.ts` -- 39 tests validating animate() mutation capture
- `.planning/REQUIREMENTS.md` -- ENG-04, ENG-05, ENG-06 requirements
- `.planning/ROADMAP.md` -- Phase 81 success criteria
- `.planning/phases/80-mutation-capture/80-RESEARCH.md` -- Phase 80 architecture decisions
- `.planning/phases/80-mutation-capture/80-01-SUMMARY.md` -- Phase 80 implementation details
- `.planning/phases/80-mutation-capture/80-02-SUMMARY.md` -- Element interception details

### Secondary (MEDIUM confidence)
- `~/BoardSmithGames/hex/src/rules/game.ts` -- Example of custom game properties (boardSize, winner, board reference)

### Tertiary (LOW confidence)
- None. All findings are based on direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Pure engine work, no external dependencies, all files identified
- Architecture (JSON snapshot approach): HIGH -- Leverages existing toJSON/fromJSON infrastructure
- Architecture (mutation application): HIGH -- Mutation types are well-defined, application is mechanical
- Architecture (serialization round-trip): HIGH -- Follows existing animationEvents serialization pattern exactly
- Pitfalls: HIGH -- Derived from direct analysis of game.ts, piece.ts, and element serialization
- Code examples: HIGH -- Derived from existing patterns in the codebase

**Research date:** 2026-02-06
**Valid until:** Indefinite (internal codebase analysis, no external dependencies)
