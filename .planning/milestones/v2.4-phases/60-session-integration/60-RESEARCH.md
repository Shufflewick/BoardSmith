# Phase 60: Session Integration - Research

**Researched:** 2026-01-22
**Domain:** Session layer / Animation event exposure to UI
**Confidence:** HIGH

## Summary

This phase bridges the Game-level animation event API (Phase 59) to the session layer, enabling UI consumers to receive animation events via `PlayerGameState`. The work is straightforward TypeScript integration following established patterns in `GameSession` and `buildPlayerState()`.

The core task is piping animation events from `game.pendingAnimationEvents` into `PlayerGameState`, adding a session-level `acknowledgeAnimations()` method (bypassing action system since acknowledgment is not a game action), and ensuring the animation buffer persists in session snapshots.

**Primary recommendation:** Add `animationEvents` and `lastAnimationEventId` to `PlayerGameState`, implement `GameSession.acknowledgeAnimations()` that delegates to `game.acknowledgeAnimationEvents()`, and verify snapshot serialization already works (via Game.toJSON).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.7 | Type definitions and implementation | Already in use |
| Vitest | 2.1.9 | Unit testing | Already the codebase testing framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | Pure integration work | No additional dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Action-based acknowledgment | Session method | Correct choice - acknowledgment is NOT a game action, should not pollute action history |
| WebSocket message-based ack | Session method | Session method is simpler, cleaner API |

**Installation:**
No new dependencies required.

## Architecture Patterns

### Recommended Data Flow

```
Game Layer (Phase 59 - Complete)
├── game.emitAnimationEvent(type, data)    # Adds to buffer
├── game.pendingAnimationEvents            # Getter returns copy
└── game.acknowledgeAnimationEvents(upToId) # Clears buffer

         ↓ piped through ↓

Session Layer (Phase 60 - This Phase)
├── PlayerGameState.animationEvents        # Exposed to clients
├── PlayerGameState.lastAnimationEventId   # Convenience for acknowledgment
└── GameSession.acknowledgeAnimations()    # Delegates to game

         ↓ consumed by ↓

UI Layer (Phase 61 - Next Phase)
├── useAnimationEvents()                   # Composable for consumption
└── useActionController()                  # Gates on pending animations
```

### PlayerGameState Additions

Based on existing `PlayerGameState` interface in `src/session/types.ts`:

```typescript
// Add to PlayerGameState interface
export interface PlayerGameState {
  // ... existing fields ...

  /** Animation events pending playback (from game buffer) */
  animationEvents?: AnimationEvent[];

  /** ID of the last animation event, for acknowledgment convenience */
  lastAnimationEventId?: number;
}
```

**Design rationale:**
- **Optional fields** - Empty array/undefined when no events pending (clean JSON)
- **Array copy** - Events should be copied from game buffer (already done by pendingAnimationEvents getter)
- **lastAnimationEventId** - Convenience field so UI doesn't need to compute `events[events.length - 1].id`

### GameSession.acknowledgeAnimations() Method

```typescript
/**
 * Acknowledge animation events for a player up to a given ID.
 *
 * This is NOT a game action - it doesn't modify game state or action history.
 * It's session-level bookkeeping for UI playback tracking.
 *
 * @param playerSeat - Player seat acknowledging events (1-indexed)
 * @param upToId - Acknowledge all events with ID <= this value
 */
acknowledgeAnimations(playerSeat: number, upToId: number): void {
  // Validate playerSeat (optional, could be permissive)
  // Delegate to game's acknowledge method
  this.#runner.game.acknowledgeAnimationEvents(upToId);

  // Optionally broadcast updated state
  this.broadcast();
}
```

**Design decisions:**
- **playerSeat parameter** - For future multi-client support (each client tracks independently)
- **Not async** - No persistence needed for acknowledgment state (events removed from buffer)
- **Broadcasts** - Notify all clients that events were consumed (optional, may not be needed)

### buildPlayerState() Integration

In `src/session/utils.ts`, the `buildPlayerState()` function needs to include animation events:

```typescript
export function buildPlayerState(
  runner: GameRunner,
  playerNames: string[],
  playerPosition: number,
  options?: { includeActionMetadata?: boolean; includeDebugData?: boolean }
): PlayerGameState {
  // ... existing code ...

  // Add animation events
  const animationEvents = runner.game.pendingAnimationEvents;
  if (animationEvents.length > 0) {
    state.animationEvents = animationEvents;
    state.lastAnimationEventId = animationEvents[animationEvents.length - 1].id;
  }

  return state;
}
```

### Snapshot Serialization (Already Done)

**Key insight:** Animation events are already serialized with game state via `Game.toJSON()`:

```typescript
// From src/engine/element/game.ts lines 2395-2398
...(this._animationEvents.length > 0 && {
  animationEvents: this._animationEvents,
  animationEventSeq: this._animationEventSeq,
}),
```

And restored via `Game.restoreGame()`:

```typescript
// From src/engine/element/game.ts lines 2562-2567
if ((json as { animationEvents?: AnimationEvent[] }).animationEvents) {
  const jsonWithEvents = json as { animationEvents: AnimationEvent[]; animationEventSeq?: number };
  game._animationEvents = [...jsonWithEvents.animationEvents];
  game._animationEventSeq = jsonWithEvents.animationEventSeq ?? 0;
}
```

This means SES-04 (snapshot includes animation buffer) is **already satisfied** by Phase 59. We just need to verify it works through the session layer.

### Type Export Gap

Phase 59 verification noted: "AnimationEvent and EmitAnimationEventOptions are not re-exported from engine/index.ts". For Phase 60, we need `AnimationEvent` exported for `PlayerGameState` to use it.

Add to `src/engine/index.ts`:
```typescript
export type { AnimationEvent, EmitAnimationEventOptions } from './element/game.js';
```

### Anti-Patterns to Avoid

- **Anti-pattern: Acknowledging as an Action** - Acknowledgment is NOT a game action. It doesn't change game state (cards moved, scores updated). Making it an action would pollute action history with UI bookkeeping.

- **Anti-pattern: Per-Player Event Buffers** - The game has ONE event buffer. All clients see the same events. Per-player filtering is NOT needed (events are universal).

- **Anti-pattern: Persisting Acknowledgment State** - Don't save which clients have acknowledged which events. After restore, all clients re-receive pending events and re-acknowledge. Keep it simple.

- **Anti-pattern: Conditional Animation Events by Player** - Animation events are NOT player-specific. All players see all events. Visibility filtering is for game state, not animations.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event buffer management | Custom buffer in session | Game._animationEvents | Game layer already handles buffer |
| Serialization | Custom session serialization | Game.toJSON/restoreGame | Already includes animation events |
| ID generation | Session-level IDs | Game._animationEventSeq | IDs managed at game level |
| Event copying | Manual array copy | pendingAnimationEvents getter | Already returns copy |

**Key insight:** Phase 59 did the heavy lifting. Phase 60 is thin plumbing.

## Common Pitfalls

### Pitfall 1: Double-Acknowledgment Issues
**What goes wrong:** UI calls acknowledgeAnimations multiple times for same events
**Why it happens:** Network retries, multiple components acknowledging
**How to avoid:** `acknowledgeAnimationEvents()` is already idempotent - filtering `e.id > upToId` handles repeated calls gracefully
**Warning signs:** None if using game-level method correctly

### Pitfall 2: Race Condition Between Emit and Read
**What goes wrong:** Action emits event, broadcast reads events, but timing causes missed events
**Why it happens:** Async operations interleaving
**How to avoid:** Events are synchronously added to buffer during action execution; broadcast happens after action completes
**Warning signs:** Events appear in action result but not in broadcast state

### Pitfall 3: Forgetting to Export AnimationEvent Type
**What goes wrong:** TypeScript error when UI tries to type animation events
**Why it happens:** Type defined in game.ts but not exported from engine/index.ts
**How to avoid:** Add export to engine/index.ts: `export type { AnimationEvent } from './element/game.js';`
**Warning signs:** "Cannot find name 'AnimationEvent'" TypeScript errors

### Pitfall 4: Including Events in State When Empty
**What goes wrong:** PlayerGameState always has animationEvents field even when empty
**Why it happens:** Not checking for empty array before adding to state
**How to avoid:** Only add animationEvents/lastAnimationEventId when buffer is non-empty
**Warning signs:** Verbose JSON with unnecessary `animationEvents: []` fields

### Pitfall 5: Not Validating playerSeat in acknowledgeAnimations
**What goes wrong:** Invalid player seat causes confusion
**Why it happens:** Missing validation
**How to avoid:** Add early return or warning for invalid seats; or be permissive since acknowledgment doesn't need strict player binding
**Warning signs:** Console warnings or silent failures

## Code Examples

Verified patterns from existing codebase:

### Existing PlayerGameState Interface
```typescript
// Source: src/session/types.ts lines 398-416
export interface PlayerGameState {
  phase: string;
  players: Array<{ name: string; seat: number; [key: string]: unknown }>;
  currentPlayer?: number;
  availableActions?: string[];
  isMyTurn: boolean;
  view: unknown;
  actionMetadata?: Record<string, ActionMetadata>;
  canUndo?: boolean;
  actionsThisTurn?: number;
  turnStartActionIndex?: number;
  customDebug?: Record<string, unknown>;
}
```

### Existing buildPlayerState Pattern
```typescript
// Source: src/session/utils.ts lines 346-436
export function buildPlayerState(
  runner: GameRunner,
  playerNames: string[],
  playerPosition: number,
  options?: { includeActionMetadata?: boolean; includeDebugData?: boolean }
): PlayerGameState {
  const flowState = runner.getFlowState();
  const view = runner.getPlayerView(playerPosition);
  // ... build state object ...

  // Optionally include custom debug data
  if (options?.includeDebugData) {
    const customDebug = runner.game.getCustomDebugData();
    if (Object.keys(customDebug).length > 0) {
      state.customDebug = customDebug;
    }
  }

  return state;
}
```

### Game Animation Event Methods (Phase 59)
```typescript
// Source: src/engine/element/game.ts lines 2322-2371
emitAnimationEvent(
  type: string,
  data: Record<string, unknown>,
  options?: EmitAnimationEventOptions
): AnimationEvent {
  const event: AnimationEvent = {
    id: ++this._animationEventSeq,
    type,
    data: { ...data },
    timestamp: Date.now(),
    ...(options?.group && { group: options.group }),
  };
  this._animationEvents.push(event);
  return event;
}

get pendingAnimationEvents(): AnimationEvent[] {
  return [...this._animationEvents];
}

acknowledgeAnimationEvents(upToId: number): void {
  this._animationEvents = this._animationEvents.filter(e => e.id > upToId);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No animation events | Animation event buffer in Game | Phase 59 | Foundation complete |
| Manual UI synchronization | PlayerGameState includes events | Phase 60 (this) | UI receives events automatically |

**Deprecated/outdated:**
- None for this phase - building on Phase 59 foundation

## File Changes

Based on codebase structure:

```
src/session/
├── types.ts           # Add animationEvents, lastAnimationEventId to PlayerGameState
├── utils.ts           # Add animation events to buildPlayerState()
├── game-session.ts    # Add acknowledgeAnimations() method
└── index.ts           # Export AnimationEvent type if needed

src/engine/
└── index.ts           # Add AnimationEvent export
```

## Implementation Strategy

### Task 1: Type Updates
1. Export `AnimationEvent` from `src/engine/index.ts`
2. Add `animationEvents?: AnimationEvent[]` to `PlayerGameState`
3. Add `lastAnimationEventId?: number` to `PlayerGameState`

### Task 2: buildPlayerState Integration
1. Import `AnimationEvent` type
2. Get `pendingAnimationEvents` from runner.game
3. Add to state object only if non-empty
4. Include `lastAnimationEventId` for convenience

### Task 3: GameSession.acknowledgeAnimations
1. Add method to GameSession class
2. Validate playerSeat (optional)
3. Delegate to `game.acknowledgeAnimationEvents(upToId)`
4. Optionally call `broadcast()` to update clients

### Task 4: Verify Snapshot Serialization
1. Write test: create game, emit events, snapshot, restore
2. Verify events survive round-trip
3. Verify session layer sees restored events

### Task 5: Tests
1. Unit tests for acknowledgeAnimations
2. Integration test for events in PlayerGameState
3. Snapshot round-trip test through session layer

## Open Questions

Things that couldn't be fully resolved:

1. **Should acknowledgeAnimations broadcast?**
   - What we know: Acknowledgment removes events from buffer
   - What's unclear: Should other clients be notified immediately?
   - Recommendation: Yes, broadcast to ensure all clients have consistent view. Cost is minimal.

2. **playerSeat parameter usage**
   - What we know: Current design has single buffer, all clients see same events
   - What's unclear: Should we track per-client acknowledgment for multi-device scenarios?
   - Recommendation: Keep playerSeat for future-proofing but don't implement per-client tracking now. Single buffer is sufficient.

3. **Should spectators receive animation events?**
   - What we know: Spectators see game state via buildPlayerState with position 0
   - What's unclear: Should they also receive animation events?
   - Recommendation: Yes, include events for spectators. They're watching the game and should see animations.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/session/game-session.ts` - GameSession implementation patterns
- `/Users/jtsmith/BoardSmith/src/session/types.ts` - PlayerGameState interface
- `/Users/jtsmith/BoardSmith/src/session/utils.ts` - buildPlayerState function
- `/Users/jtsmith/BoardSmith/src/engine/element/game.ts` - Animation event implementation (Phase 59)
- `/Users/jtsmith/BoardSmith/.planning/phases/59-core-animation-events/59-VERIFICATION.md` - Phase 59 verification

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/.planning/REQUIREMENTS.md` - SES-01 through SES-04 requirements
- `/Users/jtsmith/BoardSmith/.planning/PROJECT.md` - Design decisions on animation system

### Tertiary (LOW confidence)
- None - this is internal integration with clear requirements

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Pure TypeScript integration, no dependencies
- Architecture: HIGH - Clear patterns from existing codebase
- Pitfalls: HIGH - Based on Phase 59 patterns and existing session code
- Implementation: HIGH - Straightforward feature addition

**Research date:** 2026-01-22
**Valid until:** Indefinite - internal integration work with stable requirements
