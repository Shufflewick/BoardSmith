# Phase 59: Core Animation Events - Research

**Researched:** 2026-01-22
**Domain:** Game engine event system / Animation infrastructure
**Confidence:** HIGH

## Summary

This phase implements the foundational animation event system at the engine level. The design is already well-defined by prior decisions: soft continuation pattern (game state advances immediately, UI plays back asynchronously), animation events as a parallel channel (not commands, not state mutations), and events serializing with game state.

The implementation is straightforward engine-level TypeScript work with no external dependencies. The Game class will expose `emitAnimationEvent()`, maintain an internal buffer, and support acknowledgment-based clearing. The buffer serializes/deserializes with the existing game state serialization infrastructure.

**Primary recommendation:** Implement as a clean addition to the Game class following existing patterns for state management (like `messages`, `settings`, `commandHistory`), with comprehensive unit tests.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.7 | Type definitions for animation events | Already in use, strict mode |
| Vitest | 2.1.9 | Unit testing | Already the codebase testing framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | This is pure TypeScript engine work | No additional dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom ID generation | uuid/nanoid | Overkill - monotonic counter is simpler and sufficient |
| External event bus | RxJS/EventEmitter | Wrong pattern - events are stored data, not pub/sub |

**Installation:**
No new dependencies required.

## Architecture Patterns

### Recommended Type Definitions

Based on existing codebase patterns and requirements:

```typescript
// src/engine/element/animation-events.ts (new file)

/**
 * Animation event emitted during game execution.
 * These are UI hints, NOT state mutations.
 */
export interface AnimationEvent {
  /** Unique ID for acknowledgment (monotonically increasing) */
  id: number;
  /** Event type (e.g., 'combat', 'score', 'cardFlip') */
  type: string;
  /** Event-specific data payload */
  data: Record<string, unknown>;
  /** Timestamp when event was emitted */
  timestamp: number;
  /** Optional group ID for batching related events */
  group?: string;
}

/**
 * Options for emitting an animation event
 */
export interface EmitAnimationEventOptions {
  /** Group ID for batching related events (e.g., all combat events in a turn) */
  group?: string;
}
```

### Integration with Game Class

The animation event system follows the pattern of existing Game state properties:

```
Game class
├── phase: GamePhase           # Existing
├── messages: Message[]        # Existing - similar pattern
├── settings: Record<...>      # Existing
├── commandHistory: Command[]  # Existing
│
├── _animationEvents: AnimationEvent[]     # NEW - internal buffer
├── _animationEventSeq: number             # NEW - ID counter
│
├── emitAnimationEvent(type, data, opts?)  # NEW - public API
├── pendingAnimationEvents                 # NEW - getter
└── acknowledgeAnimationEvents(upToId)     # NEW - clearing method
```

### Pattern: Buffer with Acknowledgment

The animation event buffer follows a reader-acknowledges pattern:

1. **Emit**: Game logic calls `emitAnimationEvent()` during action execution
2. **Buffer**: Events accumulate in `_animationEvents` array
3. **Read**: UI reads via `pendingAnimationEvents` getter
4. **Acknowledge**: UI calls `acknowledgeAnimationEvents(upToId)` to clear consumed events

This pattern ensures:
- Events survive network transmission gaps
- Multiple UI clients can acknowledge independently (future-proofing)
- Events persist in snapshots for replay/checkpoint

### Serialization Pattern

Follow the existing `toJSON()` pattern in Game class:

```typescript
// In game.toJSON() - add animationEvents
override toJSON(): ElementJSON & {
  phase: GamePhase;
  // ... existing fields ...
  animationEvents?: AnimationEvent[];
  animationEventSeq?: number;
} {
  return {
    ...super.toJSON(),
    // ... existing fields ...
    // Only include if there are events (avoid cluttering empty snapshots)
    ...(this._animationEvents.length > 0 && {
      animationEvents: this._animationEvents,
      animationEventSeq: this._animationEventSeq,
    }),
  };
}
```

### Anti-Patterns to Avoid

- **Anti-pattern: Events as Commands** - Animation events are NOT commands. They don't mutate state and shouldn't be in commandHistory.
- **Anti-pattern: Event Bus Pattern** - This is NOT pub/sub. Events are stored data that persists across serialize/restore.
- **Anti-pattern: Automatic Acknowledgment** - UI must explicitly acknowledge. Don't auto-clear on read.
- **Anti-pattern: Clearing on Emit** - Events accumulate until acknowledged. Don't have a max buffer size that auto-clears.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unique IDs | UUID/random | Monotonic counter | Simpler, sufficient for sequential events, survives restore |
| Timestamps | Custom formatting | `Date.now()` | Standard, compact, JSON-safe |
| Array buffer | Circular buffer | Simple array with splice | Acknowledgment clears front, no need for complexity |

**Key insight:** The animation event system is intentionally simple. It's a data buffer, not a reactive system. The complexity lives in the UI layer (Phase 61), not here.

## Common Pitfalls

### Pitfall 1: Breaking Existing Serialization
**What goes wrong:** Adding properties that break existing snapshot restore
**Why it happens:** Not following existing patterns for optional serialization
**How to avoid:** Use conditional spread pattern (`...(condition && { prop })`), add to `unserializableAttributes` for non-serializable refs
**Warning signs:** Tests for snapshot restore fail

### Pitfall 2: ID Counter Reset on Restore
**What goes wrong:** After restore, new events get duplicate IDs
**Why it happens:** Forgetting to restore `_animationEventSeq` counter
**How to avoid:** Serialize and restore the sequence counter alongside events
**Warning signs:** `pendingAnimationEvents` returns events with duplicate IDs after restore

### Pitfall 3: Acknowledging Non-Existent Events
**What goes wrong:** Calling `acknowledgeAnimationEvents(999)` when max ID is 5
**Why it happens:** Race conditions or stale UI state
**How to avoid:** `acknowledgeAnimationEvents` should be safe with any ID value - just clear events with ID <= upToId
**Warning signs:** None if implemented correctly (idempotent operation)

### Pitfall 4: Event Data with Element References
**What goes wrong:** Storing GameElement references in event data that don't serialize
**Why it happens:** Tempting to pass element directly: `{ piece: piece }` instead of ID
**How to avoid:** Document that event data must be JSON-serializable. Store element IDs or paths, not references.
**Warning signs:** Events serialize/restore but lose element data

### Pitfall 5: Modifying Event After Emit
**What goes wrong:** Code modifies event data after calling `emitAnimationEvent`
**Why it happens:** Passing mutable object as data
**How to avoid:** Store a shallow copy of data, or document that data should be treated as immutable
**Warning signs:** Events have different data when read vs when emitted

## Code Examples

Verified patterns from existing codebase:

### Message System (Similar Pattern)
```typescript
// Source: src/engine/element/game.ts lines 2192-2255
// Messages follow a similar pattern to what animation events need

// Storage
messages: Array<{ text: string; data?: Record<string, unknown> }> = [];

// Public API
message(text: string, data?: Record<string, unknown>): void {
  this.addMessageInternal(text, data);
}

// Serialization (in toJSON)
messages: this.messages,
```

### Settings Serialization Pattern
```typescript
// Source: src/engine/element/game.ts lines 2264-2277
override toJSON(): ElementJSON & {
  phase: GamePhase;
  isFinished: boolean;
  messages: Array<{ text: string; data?: Record<string, unknown> }>;
  settings: Record<string, unknown>;
} {
  return {
    ...super.toJSON(),
    phase: this.phase,
    isFinished: this.isFinished(),
    messages: this.messages,
    settings: this.settings,
  };
}
```

### Unserializable Attributes
```typescript
// Source: src/engine/element/game.ts lines 303-313
static override unserializableAttributes = [
  ...Space.unserializableAttributes,
  'pile',
  'random',
  'commandHistory',
  '_actions',
  '_actionExecutor',
  '_flowDefinition',
  '_flowEngine',
  '_debugRegistry',
];
```

### Test Pattern for Serialization
```typescript
// Source: src/engine/utils/snapshot.test.ts
describe('createSnapshot', () => {
  it('should create a complete snapshot', () => {
    const snapshot = createSnapshot(game, 'test-game', [], 'test');

    expect(snapshot.version).toBe(1);
    expect(snapshot.gameType).toBe('test-game');
    expect(snapshot.seed).toBe('test');
    expect(snapshot.state).toBeDefined();
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Animation in commands | Animation as parallel channel | v2.4 design phase | Cleaner separation, better replay |
| Blocking flow for animations | Soft continuation | v2.4 design phase | Faster state progression |

**Deprecated/outdated:**
- None for this phase - this is new infrastructure

## File Structure

Based on codebase conventions:

```
src/engine/
├── element/
│   ├── game.ts           # Modified: Add animation event methods
│   ├── animation-events.ts  # NEW: Type definitions (optional, can inline)
│   └── game.test.ts      # Existing tests - ensure no regression
│
└── utils/
    └── snapshot.ts       # May need update for animation event serialization
```

Alternatively, types could be inlined in `game.ts` since they're simple and tightly coupled.

## Implementation Strategy

### Step 1: Add Types
Add `AnimationEvent` and `EmitAnimationEventOptions` interfaces.

### Step 2: Add Private State
```typescript
private _animationEvents: AnimationEvent[] = [];
private _animationEventSeq: number = 0;
```

### Step 3: Add Public API
```typescript
emitAnimationEvent(type: string, data: Record<string, unknown>, options?: EmitAnimationEventOptions): AnimationEvent
get pendingAnimationEvents(): AnimationEvent[]
acknowledgeAnimationEvents(upToId: number): void
```

### Step 4: Update Serialization
Modify `toJSON()` to include animation events and sequence counter.

### Step 5: Update Restore
Modify `restoreGame()` to restore animation events and sequence counter.

### Step 6: Add Tests
- Unit tests for emit/acknowledge cycle
- Serialization round-trip tests
- Edge cases (empty buffer, acknowledge all, acknowledge none)

## Open Questions

Things that couldn't be fully resolved:

1. **Group ID format**
   - What we know: Groups are strings for batching related events
   - What's unclear: Should there be a standard format (e.g., `turn-5`, `action-playCard-3`)?
   - Recommendation: Keep it freeform string for Phase 59. Let game developers choose meaningful names. Can standardize in future if patterns emerge.

2. **Event data validation**
   - What we know: Data must be JSON-serializable
   - What's unclear: Should we validate at emit time or trust caller?
   - Recommendation: Trust caller for Phase 59 (performance). Add optional dev-mode validation if issues arise.

3. **Restore behavior for partial acknowledgment**
   - What we know: Events and sequence counter serialize together
   - What's unclear: If a client acknowledged events but snapshot was taken before, restored state has those events again
   - Recommendation: This is correct behavior. Restore rebuilds complete server state. Clients re-acknowledge on reconnect.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/engine/element/game.ts` - Game class implementation, serialization patterns
- `/Users/jtsmith/BoardSmith/src/engine/utils/snapshot.ts` - Snapshot creation patterns
- `/Users/jtsmith/BoardSmith/src/session/types.ts` - PlayerGameState interface (Phase 60 consumer)
- `/Users/jtsmith/BoardSmith/.planning/REQUIREMENTS.md` - ENG-01 through ENG-06 requirements

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/.planning/ROADMAP.md` - Phase dependencies and success criteria
- `/Users/jtsmith/BoardSmith/.planning/PROJECT.md` - Prior decisions on soft continuation pattern

### Tertiary (LOW confidence)
- None - this is internal implementation with clear requirements

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Pure TypeScript, no dependencies
- Architecture: HIGH - Follows clear existing patterns in Game class
- Pitfalls: HIGH - Based on existing codebase serialization experience
- Implementation: HIGH - Straightforward feature addition

**Research date:** 2026-01-22
**Valid until:** Indefinite - internal engine work with stable requirements
