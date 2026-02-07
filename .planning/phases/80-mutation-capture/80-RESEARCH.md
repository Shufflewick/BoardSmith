# Phase 80: Mutation Capture - Research

**Researched:** 2026-02-06
**Domain:** Engine-level mutation tracking for scoped animation callbacks
**Confidence:** HIGH

## Summary

Phase 80 replaces the fire-and-forget `emitAnimationEvent()` API with a scoped callback `game.animate(type, data, callback)` that captures every mutation inside the callback and associates it with the animation event. This is the foundation for the Theatre View system (Phase 81+), where a "narrative" state can be maintained separately from truth by replaying captured mutations per-event.

The current codebase has a clean separation between the element tree (direct manipulation via `putInto()`, `remove()`, `create()`, attribute assignment) and the command system (used for replay/undo). Critically, element operations like `putInto()` and `remove()` do NOT go through the command system -- they directly manipulate the tree. This means mutation capture must intercept at a different level than commands.

Two categories of mutations need capturing: (1) element tree changes (create, move, remove, attribute changes) and (2) custom game property changes (e.g., `game.runningTotal = 5`, `game.cribbagePhase = 'scoring'`). These require different interception strategies.

**Primary recommendation:** Implement a capture context on the Game class that records mutations during `animate()` callbacks. Use before/after snapshotting for game properties, and intercept element operations (`putInto`, `remove`, `create`, attribute `set`) to record structured mutation records. The callback executes synchronously, mutations apply immediately to game state (preserving current behavior), and the captured mutations are stored on the AnimationEvent.

## Standard Stack

No external libraries needed. This is pure engine-level TypeScript work within the existing codebase.

### Core Files to Modify
| File | Purpose | Change Scope |
|------|---------|-------------|
| `src/engine/element/game.ts` | Game class - add `animate()` method, capture context | Major |
| `src/engine/element/game.ts` | AnimationEvent type - add `mutations` field | Minor |
| `src/engine/element/game-element.ts` | Element base - intercept create in capture mode | Minor |
| `src/engine/element/piece.ts` | Piece - intercept putInto/remove in capture mode | Minor |
| `src/engine/element/index.ts` | Exports - export new types | Trivial |
| `src/engine/index.ts` | Engine barrel - export new types | Trivial |

### New Files
| File | Purpose |
|------|---------|
| `src/engine/element/mutation-capture.ts` | Mutation types and capture context class |
| `src/engine/element/mutation-capture.test.ts` | Tests for mutation capture |

### Files That Import AnimationEvent (Impact Assessment)
| File | Impact |
|------|--------|
| `src/session/types.ts` | Will need updated type (adds `mutations` field) |
| `src/ui/composables/useAnimationEvents.ts` | No change needed yet (Phase 83) |
| `src/ui/composables/useAnimationEvents.test.ts` | No change needed yet |
| `src/engine/element/animation-events.test.ts` | Must update to test `animate()` |
| `src/session/animation-events.test.ts` | Must update to test session-level `animate()` |

## Architecture Patterns

### Recommended Approach: Capture Context Pattern

The Game class maintains a nullable capture context. When `animate()` is called, the context is set, the callback runs synchronously, mutations are recorded, then the context is cleared and the event is produced.

```
game.animate('death', { pieceId: 42 }, () => {
  piece.remove();      // Mutation recorded + applied immediately
  game.score += 10;    // Property change recorded + applied immediately
});
// AnimationEvent now has mutations: [{ type: 'REMOVE', ... }, { type: 'PROPERTY', ... }]
```

### Pattern 1: Synchronous Capture Context

**What:** A context object on Game that, when active, records mutations as they happen.
**When to use:** During `animate()` callback execution.
**Why synchronous:** Game rule callbacks are always synchronous in BoardSmith. The flow engine, action executors, and execute blocks all run synchronously.

```typescript
// Source: Derived from codebase analysis of game.ts

// In mutation-capture.ts
interface MutationCaptureContext {
  mutations: CapturedMutation[];
  propertySnapshot: Record<string, unknown>;  // Before-state of game properties
}

// In game.ts
class Game {
  /** Active capture context (null when not inside animate()) */
  _captureContext: MutationCaptureContext | null = null;

  animate(type: string, data: Record<string, unknown>, callback: () => void): AnimationEvent {
    // 1. Snapshot custom game properties BEFORE
    const propertySnapshot = this._snapshotCustomProperties();

    // 2. Create capture context
    this._captureContext = { mutations: [], propertySnapshot };

    // 3. Execute callback (synchronous - mutations apply immediately)
    callback();

    // 4. Diff custom properties to find changes
    const propertyMutations = this._diffCustomProperties(propertySnapshot);
    this._captureContext.mutations.push(...propertyMutations);

    // 5. Collect mutations and clear context
    const mutations = this._captureContext.mutations;
    this._captureContext = null;

    // 6. Create animation event with mutations
    const event: AnimationEvent = {
      id: ++this._animationEventSeq,
      type,
      data: { ...data },
      timestamp: Date.now(),
      mutations,
    };
    this._animationEvents.push(event);
    return event;
  }
}
```

### Pattern 2: Element Mutation Interception

**What:** Element operations check for an active capture context and record mutations when one exists.
**When to use:** In `putInto()`, `remove()`, `create()`, and attribute setters.
**Key principle:** Mutations still apply immediately -- capture is purely observational.

```typescript
// Source: Derived from piece.ts and game-element.ts analysis

// In piece.ts - putInto with capture
putInto(destination: GameElement, options?: { position?: 'first' | 'last' }): void {
  // Record mutation if capture context is active
  if (this.game._captureContext) {
    this.game._captureContext.mutations.push({
      type: 'MOVE',
      elementId: this._t.id,
      fromParentId: this._t.parent?._t.id,
      destinationId: destination._t.id,
      position: options?.position,
    });
  }

  // Original behavior - apply immediately
  this.moveToInternal(destination, options?.position);
}
```

### Pattern 3: Property Change Detection via Snapshot Diff

**What:** Capture custom game properties before the callback, diff after.
**When to use:** For detecting changes to properties like `game.score`, `game.cribbagePhase`, etc.
**Why not Proxy:** Game objects already use Proxy for array auto-sync. Adding a full property Proxy would be complex, fragile, and conflict with existing patterns. Snapshot-diff is simpler and more reliable.

```typescript
// Source: Derived from game.ts toJSON() pattern (line 696-731)

_snapshotCustomProperties(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  const unserializable = new Set(
    (this.constructor as typeof Game).unserializableAttributes
  );
  const safeProps = (this.constructor as typeof Game)._safeProperties;

  for (const key of Object.keys(this)) {
    // Skip internal/system properties
    if (unserializable.has(key) || safeProps.has(key) || key.startsWith('_')) continue;
    // Skip element tree references (board, deck, etc.) - those are tracked via element mutations
    const value = (this as any)[key];
    if (value && typeof value === 'object' && value._t) continue; // GameElement
    snapshot[key] = structuredClone(value);
  }
  return snapshot;
}

_diffCustomProperties(before: Record<string, unknown>): CapturedMutation[] {
  const mutations: CapturedMutation[] = [];
  const current = this._snapshotCustomProperties();

  for (const key of new Set([...Object.keys(before), ...Object.keys(current)])) {
    if (!deepEqual(before[key], current[key])) {
      mutations.push({
        type: 'SET_PROPERTY',
        property: key,
        oldValue: before[key],
        newValue: current[key],
      });
    }
  }
  return mutations;
}
```

### Recommended Project Structure

```
src/engine/element/
  mutation-capture.ts          # CapturedMutation types, MutationCaptureContext
  mutation-capture.test.ts     # Tests for capture behavior
  game.ts                      # animate() method, capture context on Game
  game-element.ts              # create() interception
  piece.ts                     # putInto()/remove() interception
```

### Anti-Patterns to Avoid

- **Command system hijacking:** Do NOT try to route mutations through the existing command system. Commands are for replay/undo. Element operations (`putInto`, `remove`, `create`) bypass commands intentionally. Capture should observe direct tree mutations, not command execution.

- **Async callbacks:** Do NOT allow async callbacks in `animate()`. The entire game execution model is synchronous. An async callback would break the flow engine's assumptions and make capture context lifetime management impossible.

- **Full game Proxy:** Do NOT wrap the entire Game instance in a Proxy to detect property changes. The Game class already uses Proxy for array auto-sync, and a full wrapper Proxy would conflict, add complexity, and have edge cases with `this` binding in subclass methods.

- **Capturing too much:** Do NOT capture changes to `settings`, `messages`, `phase`, `commandHistory`, or other system properties. Only capture: (a) element tree mutations and (b) custom game properties (properties defined by game subclasses).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deep value comparison | Custom recursive comparison | `JSON.stringify` comparison or simple `deepEqual` utility | Edge cases with circular refs, dates, etc. - but game properties are JSON-serializable by design |
| Property enumeration | Manual property listing | `Object.keys()` + existing `unserializableAttributes`/`_safeProperties` filtering | Already established pattern in `toJSON()` and `_checkForVolatileState()` |
| Unique event IDs | New ID system | Existing `_animationEventSeq` counter | Already monotonically increasing, already serialized/restored |

**Key insight:** The existing `toJSON()` serialization already knows which properties are "custom game properties" vs. system properties (via `unserializableAttributes` and key prefix filtering). Reuse this same logic for snapshot/diff rather than inventing a new property classification system.

## Common Pitfalls

### Pitfall 1: Element References in Property Snapshots
**What goes wrong:** Custom game properties may reference GameElements (e.g., `game.winner` which is a `HexPlayer`). Snapshotting these with `structuredClone` would fail or capture the entire element tree.
**Why it happens:** GameElements have circular references (`element.game`, `element._t.parent`).
**How to avoid:** Skip properties whose values are GameElements when snapshotting. Element references don't need property-level tracking because the elements themselves are tracked via element mutations. For the diff, record only the element ID or branch path.
**Warning signs:** `structuredClone` throwing "circular reference" errors; massive snapshot objects.

### Pitfall 2: Nested animate() Calls
**What goes wrong:** A developer calls `game.animate()` inside another `animate()` callback. The inner call would overwrite the outer capture context.
**Why it happens:** Nothing prevents it syntactically.
**How to avoid:** Detect nested calls and throw a clear error: "Cannot call game.animate() inside another animate() callback." The requirements document explicitly defers nested animate scopes (ADV-03) to a future release.
**Warning signs:** `_captureContext` is already non-null when `animate()` is entered.

### Pitfall 3: Mutations Outside animate() Still Work
**What goes wrong:** Someone assumes all mutations must be inside `animate()` now.
**Why it happens:** Confusion about what `animate()` is for.
**How to avoid:** When `_captureContext` is null (outside `animate()`), element operations work exactly as before -- no capture, no recording. The capture is purely additive. Existing tests must all continue passing without modification (success criteria #5).
**Warning signs:** Existing tests failing after adding capture hooks.

### Pitfall 4: Settings vs. Custom Properties Confusion
**What goes wrong:** Capturing changes to `game.settings` entries that are system-managed (auto-sync arrays, player config, etc.).
**Why it happens:** `settings` is a bag that holds both system and game-developer data.
**How to avoid:** Only diff properties on the Game instance itself (not inside `settings`). Properties in `settings` are managed by the framework's auto-sync system and will be captured indirectly through the game properties that wrap them. For example, `game.currentPlayCards` (a getter/setter backed by `settings._currentPlayCards`) - the property change is captured at the getter/setter level.
**Warning signs:** Duplicate or conflicting mutations for the same logical change.

### Pitfall 5: Capture Context Leaking on Exceptions
**What goes wrong:** If the callback throws, the capture context remains active, corrupting subsequent operations.
**Why it happens:** No try/finally around callback execution.
**How to avoid:** Always wrap callback execution in try/finally that clears `_captureContext`.
**Warning signs:** Mutations being recorded outside of `animate()` calls.

### Pitfall 6: `remove()` Implementation Detail
**What goes wrong:** `piece.remove()` calls `this.putInto(this.game.pile)`, which means a remove is really a move-to-pile. If both `remove()` and `putInto()` record mutations, you get a duplicate.
**Why it happens:** `remove()` delegates to `putInto()`.
**How to avoid:** Only record at the lowest level (`moveToInternal` / `putInto`). Use a `MOVE` mutation type for all movements, including removes (destination is pile). Then in the theatre state engine (Phase 81), a move-to-pile can be interpreted as a removal.
**Warning signs:** Two mutations recorded for a single `piece.remove()` call.

## Code Examples

### CapturedMutation Type Definition

```typescript
// Source: Derived from command/types.ts patterns

/**
 * A mutation captured during an animate() callback.
 * These are observations of state changes, not commands to execute.
 * They record what happened so the theatre state can be advanced per-event.
 */
export type CapturedMutation =
  | CreateMutation
  | MoveMutation
  | SetAttributeMutation
  | SetPropertyMutation;

interface CreateMutation {
  type: 'CREATE';
  /** Class name of created element */
  className: string;
  /** Name of created element */
  name: string;
  /** ID of parent element */
  parentId: number;
  /** ID assigned to the new element */
  elementId: number;
  /** Initial attributes */
  attributes?: Record<string, unknown>;
}

interface MoveMutation {
  type: 'MOVE';
  /** ID of moved element */
  elementId: number;
  /** ID of previous parent (for theatre state rollback) */
  fromParentId: number;
  /** ID of new parent */
  toParentId: number;
  /** Position in destination */
  position?: 'first' | 'last';
}

interface SetAttributeMutation {
  type: 'SET_ATTRIBUTE';
  /** ID of element */
  elementId: number;
  /** Attribute name */
  attribute: string;
  /** Previous value */
  oldValue: unknown;
  /** New value */
  newValue: unknown;
}

interface SetPropertyMutation {
  type: 'SET_PROPERTY';
  /** Property name on the Game instance */
  property: string;
  /** Previous value */
  oldValue: unknown;
  /** New value */
  newValue: unknown;
}
```

### Updated AnimationEvent Type

```typescript
// Source: Extended from game.ts line 149-160

export interface AnimationEvent {
  /** Unique ID for acknowledgment (monotonically increasing) */
  id: number;
  /** Event type (e.g., 'combat', 'score', 'cardFlip') */
  type: string;
  /** Event-specific data payload (must be JSON-serializable) */
  data: Record<string, unknown>;
  /** Timestamp when event was emitted */
  timestamp: number;
  /** Optional group ID for batching related events */
  group?: string;
  /** Mutations captured during the animate() callback */
  mutations: CapturedMutation[];
}
```

### game.animate() Method

```typescript
// Source: Derived from game.ts emitAnimationEvent (line 2372-2386)

animate(
  type: string,
  data: Record<string, unknown>,
  callback: () => void
): AnimationEvent {
  // Guard against nested animate() calls
  if (this._captureContext) {
    throw new Error(
      `Cannot call game.animate() inside another animate() callback. ` +
      `Nested animation scopes are not supported. ` +
      `Move the inner animate() call outside the outer callback.`
    );
  }

  // Snapshot custom properties before callback
  const propertySnapshot = this._snapshotCustomProperties();

  // Activate capture context
  this._captureContext = { mutations: [] };

  try {
    // Execute callback synchronously - mutations apply immediately
    callback();
  } finally {
    // Always clear context, even on exception
    const mutations = this._captureContext.mutations;
    this._captureContext = null;

    // Diff custom properties
    const propertyMutations = this._diffCustomProperties(propertySnapshot);
    mutations.push(...propertyMutations);
  }

  // Note: mutations variable is available here because of the finally block structure
  // Actually need to restructure - capture mutations before finally clears context
  // See implementation note below

  const event: AnimationEvent = {
    id: ++this._animationEventSeq,
    type,
    data: { ...data },
    timestamp: Date.now(),
    mutations, // Will need restructuring in actual implementation
  };

  this._animationEvents.push(event);
  return event;
}
```

**Implementation note:** The try/finally pattern needs careful structuring so that `mutations` is accessible after the finally block clears the context. The actual implementation should capture the mutations array reference before clearing.

### Element Interception Points

```typescript
// In piece.ts - putInto()
putInto(destination: GameElement, options?: { position?: 'first' | 'last' }): void {
  // Capture mutation if inside animate()
  if (this.game._captureContext) {
    this.game._captureContext.mutations.push({
      type: 'MOVE',
      elementId: this._t.id,
      fromParentId: this._t.parent?._t.id ?? -1,
      toParentId: destination._t.id,
      position: options?.position,
    });
  }

  this.moveToInternal(destination, options?.position);
}

// In game-element.ts - create()
create<T extends GameElement>(
  elementClass: ElementClass<T>,
  name: string,
  attributes?: ElementAttributes<T>
): T {
  const element = this.createInternal(elementClass, name, attributes);

  // Capture mutation if inside animate()
  if (this.game._captureContext) {
    this.game._captureContext.mutations.push({
      type: 'CREATE',
      className: elementClass.name,
      name,
      parentId: this._t.id,
      elementId: element._t.id,
      attributes: attributes ? { ...attributes } : undefined,
    });
  }

  return element;
}
```

### Attribute Change Capture

```typescript
// This is the trickiest part. Element attributes are plain properties.
// Options:
//
// 1. Proxy-based (complex but automatic):
//    Wrap element in Proxy during animate() to intercept property sets
//
// 2. Snapshot-based (simpler, matches game property approach):
//    Snapshot element attributes before, diff after
//    Downside: Must snapshot ALL elements that might change
//
// 3. Explicit method (cleanest):
//    Require game.setAttribute(element, 'attr', value) during animate()
//    Downside: Breaking change to how attributes are set
//
// RECOMMENDATION: Option 2 (snapshot-based) for elements that have
// attribute changes. The callback is synchronous and typically modifies
// a small number of elements. We can snapshot all elements' serializable
// attributes before the callback and diff after.
//
// ALTERNATIVE RECOMMENDATION: Since element attribute changes are less
// common inside animate() callbacks (most animate() calls involve moves
// and removes, not attribute changes), we could defer attribute-level
// capture to a separate sub-task and validate with real game examples first.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `emitAnimationEvent()` fire-and-forget | `game.animate()` with capture (this phase) | v2.9 | Animation events now carry mutation data |
| No mutation tracking | Capture context on Game | v2.9 | Foundation for theatre state |
| UI plays animations then shows truth | UI shows theatre state, advances per-event | v2.9 (Phase 81+) | No more "seeing the future" |

**Important compatibility note:** During Phase 80, `emitAnimationEvent()` must continue to work. It is only removed in Phase 84. The `animate()` method is added alongside it. Tests for `emitAnimationEvent()` must continue passing.

## Element Attribute Change Strategy

This deserves special attention because it's the most architecturally uncertain part.

### The Problem

Element attributes are plain JavaScript properties:
```typescript
card.faceUp = true;      // This is just a property assignment
piece.health = 5;        // No setter, no method call
```

There is no interception point for plain property assignments in JavaScript without Proxy or `Object.defineProperty`.

### Options Evaluated

**Option A: Full Element Proxy During Capture**
- Wrap every element in a Proxy when capture context is active
- Intercept all `set` operations
- Complexity: HIGH -- must handle prototype chain, `this` binding, nested access
- Risk: Breaks existing patterns, performance overhead
- Verdict: Too complex and fragile

**Option B: Snapshot All Elements Before/After**
- Before callback: snapshot all elements' serializable attributes via `toJSON()`
- After callback: diff to find changes
- Complexity: MEDIUM -- uses existing `toJSON()` infrastructure
- Risk: Performance on large element trees; captures attributes of all elements, not just changed ones
- Verdict: Viable but potentially slow for large games

**Option C: Snapshot Only Touched Elements**
- Track which elements are touched during callback (via move/create interception)
- Only diff those elements' attributes
- Complexity: MEDIUM -- requires tracking + targeted diffing
- Risk: Misses attribute-only changes (element not moved/created, just attribute changed)
- Verdict: Partial solution -- misses the `card.faceUp = true` case

**Option D: Require Explicit API for Attribute Changes**
- `game.setElementAttribute(element, 'faceUp', true)` during animate()
- Complexity: LOW
- Risk: Not pit-of-success -- developers will forget and get silent failures
- Verdict: Violates project philosophy

**Option E: Property Descriptor Interception**
- Use `Object.defineProperty` to intercept known attribute names on element prototypes
- Register which attributes should be tracked per element class
- Complexity: MEDIUM-HIGH
- Risk: Must know attribute names upfront; interacts with serialization system
- Verdict: Possible but requires registration system

### Recommendation: Option B with Optimization

Use full element tree snapshot/diff, but optimize by:
1. Only snapshotting attribute objects (not full toJSON with children)
2. Using a Map<elementId, attributes> for fast lookup
3. The callback is synchronous and typically fast, so performance is acceptable
4. This matches the pattern used for game property changes (consistency)

Phase 81 can optimize further if profiling reveals bottlenecks.

**Confidence: MEDIUM** -- This is the area with most design uncertainty. The planner should consider splitting attribute capture into a separate task that can be validated independently.

## Open Questions

1. **Settings-backed properties:** Properties like `CribbageGame.currentPlayCards` use getter/setter pairs backed by `game.settings`. The snapshot-diff approach on `Object.keys(this)` will find `currentPlayCards` as a descriptor, not an own property. Need to verify that the diff correctly handles computed properties.
   - What we know: `Object.keys()` returns own enumerable properties. Getters defined via `get`/`set` in the class body ARE enumerable own properties.
   - What's unclear: Whether `Object.keys()` returns getter-defined properties on the prototype chain vs. instance.
   - Recommendation: Test this specifically. If getters aren't enumerated, diff `settings` object as well for `_`-prefixed internal keys.

2. **Element attribute change detection scope:** How many elements typically exist in a game? If 100s, snapshot/diff is fine. If 10,000s (unlikely for board games), need optimization.
   - What we know: Board games typically have 10-200 elements. Hex has ~50-200. Cribbage has ~60. Even complex games rarely exceed 500.
   - Recommendation: Snapshot/diff is fine for this scale. Don't optimize prematurely.

3. **Backward compatibility during transition:** Phases 80-83 add `animate()` alongside existing `emitAnimationEvent()`. Should `emitAnimationEvent()` produce events with empty `mutations: []` for consistency?
   - Recommendation: Yes. Make `emitAnimationEvent()` produce `mutations: []` so downstream consumers don't need to handle `undefined`. This is a tiny change and simplifies the type.

4. **Capture context visibility:** Should `_captureContext` be truly private (`#captureContext`) or internal-private (`_captureContext`)?
   - What we know: The codebase uses `_` prefix for internal properties, not `#` private fields. The `#` syntax is only used in `session/` and `ui/` modules.
   - Recommendation: Use `_captureContext` to match engine module conventions. Elements need to read it from `this.game._captureContext`.

## Sources

### Primary (HIGH confidence)
- `src/engine/element/game.ts` - Game class, AnimationEvent type, emitAnimationEvent(), toJSON(), settings, unserializableAttributes
- `src/engine/element/game-element.ts` - GameElement base class, create(), toJSON(), attribute serialization
- `src/engine/element/piece.ts` - Piece class, putInto(), remove(), moveToInternal()
- `src/engine/command/types.ts` - GameCommand types (CREATE, MOVE, REMOVE, SET_ATTRIBUTE, etc.)
- `src/engine/command/executor.ts` - Command execution (NOT used by element methods directly)
- `src/engine/element/animation-events.test.ts` - 18 existing animation event tests
- `src/session/animation-events.test.ts` - Session-level animation event tests
- `src/session/utils.ts` - buildPlayerState() including animation event attachment
- `.planning/REQUIREMENTS.md` - v2.9 requirements (ENG-01 through ENG-08)
- `.planning/ROADMAP.md` - Phase 80-84 architecture and dependencies

### Secondary (MEDIUM confidence)
- `BoardSmithGames/cribbage/src/rules/game.ts` - Real-world emitAnimationEvent usage pattern (scoring animations with interleaved state changes)
- `BoardSmithGames/demo-animation/src/rules/actions.ts` - Simple emitAnimationEvent usage
- `BoardSmithGames/hex/src/rules/game.ts` - Example of custom game properties (boardSize, winner)

### Tertiary (LOW confidence)
- Element attribute change capture strategy (Option B recommendation) - based on reasoning, not validated with profiling or prototype

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Codebase thoroughly analyzed, no external dependencies
- Architecture (animate method + element interception): HIGH - Clear pattern from codebase analysis
- Architecture (property snapshot/diff): HIGH - Follows existing toJSON() pattern
- Architecture (element attribute capture): MEDIUM - Most complex part, multiple viable approaches
- Pitfalls: HIGH - Derived from direct code analysis of edge cases

**Research date:** 2026-02-06
**Valid until:** Indefinite (internal codebase analysis, no external dependencies that could change)
