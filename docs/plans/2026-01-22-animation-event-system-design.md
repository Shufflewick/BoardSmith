# Animation Event System Design

**Date:** 2026-01-22
**Status:** Approved
**Author:** Claude (with direction from user)

## Overview

Infrastructure-level support for dramatic UI playback of game calculations. Games can emit animation events during execution (e.g., dice rolls, damage, deaths), and the UI plays them back asynchronously while coordinating with the ActionPanel.

## Problem Statement

BoardSmith's flow system is built around player decisions (ActionStep waits → player picks → execute → continue). But some game logic is **AI calculation** that:

1. Happens atomically (no decisions during)
2. Needs to emit granular events (dice rolls, damage, deaths)
3. Requires the UI to animate those events before showing next decisions

The MERC team built workarounds including event buffers, fake cleanup actions, manual deduplication, and Vue batching hacks. This design replaces all of that with first-class infrastructure.

## Design Principles

1. **Soft Continuation** - Game state advances immediately; UI plays back asynchronously
2. **Parallel Channel** - Animation events are separate from commands (events ≠ mutations)
3. **Automatic Coordination** - ActionPanel waits for animations; no manual synchronization
4. **Pit of Success** - Simple API that's hard to misuse

## Core Types

```typescript
// src/engine/animation/types.ts

/**
 * An animation event emitted during game execution.
 * Events are UI hints, not state mutations.
 */
export interface AnimationEvent<T extends string = string> {
  /** Unique ID for acknowledgment */
  id: number;

  /** Event type (game-defined, e.g., 'combat-roll', 'damage', 'death') */
  type: T;

  /** Event payload (dice values, target IDs, damage amounts, etc.) */
  data: Record<string, unknown>;

  /** Timestamp for ordering during replay */
  timestamp: number;

  /** Optional: group related events (e.g., all events from one combat round) */
  group?: string;
}

/**
 * Animation event buffer state (serialized with game).
 */
export interface AnimationEventBuffer {
  /** Events waiting to be consumed by UI */
  events: AnimationEvent[];

  /** Next event ID */
  nextId: number;

  /** Highest acknowledged ID (events <= this are consumed) */
  acknowledgedId: number;
}
```

## Game Class API

```typescript
// src/engine/element/game.ts (additions)

export class Game<G extends Game<G, P>, P extends Player<G, P>> {

  /** Animation event buffer (serialized with game state) */
  private _animationEvents: AnimationEventBuffer = {
    events: [],
    nextId: 1,
    acknowledgedId: 0,
  };

  /**
   * Emit an animation event for the UI to consume.
   *
   * Events are NOT state mutations - they're hints for dramatic playback.
   * The game state is already final; this tells the UI HOW to present it.
   */
  emitAnimationEvent<T extends string>(
    type: T,
    data: Record<string, unknown>,
    options?: { group?: string }
  ): void {
    this._animationEvents.events.push({
      id: this._animationEvents.nextId++,
      type,
      data,
      timestamp: Date.now(),
      group: options?.group,
    });
  }

  /**
   * Get pending animation events (events not yet acknowledged).
   */
  get pendingAnimationEvents(): readonly AnimationEvent[] {
    return this._animationEvents.events.filter(
      e => e.id > this._animationEvents.acknowledgedId
    );
  }

  /**
   * Acknowledge animation events up to (and including) the given ID.
   */
  acknowledgeAnimationEvents(upToId: number): void {
    if (upToId > this._animationEvents.acknowledgedId) {
      this._animationEvents.acknowledgedId = upToId;
      this._animationEvents.events = this._animationEvents.events.filter(
        e => e.id > upToId
      );
    }
  }

  /**
   * Get full animation buffer state (for serialization).
   */
  getAnimationEventBuffer(): AnimationEventBuffer {
    return { ...this._animationEvents };
  }

  /**
   * Restore animation buffer state (for deserialization).
   */
  restoreAnimationEventBuffer(buffer: AnimationEventBuffer): void {
    this._animationEvents = { ...buffer };
  }
}
```

## PlayerGameState Additions

```typescript
// src/session/types.ts

export interface PlayerGameState {
  // ... existing fields ...

  /**
   * Pending animation events for this player to consume.
   * UI should play these before showing new decisions.
   */
  animationEvents: AnimationEvent[];

  /**
   * Highest animation event ID (for acknowledgment).
   */
  lastAnimationEventId: number | null;
}
```

## Session API

```typescript
// src/session/game-session.ts

export class GameSession {
  /**
   * Acknowledge that the UI has consumed animation events up to the given ID.
   * This is NOT an action - it's infrastructure for animation coordination.
   */
  acknowledgeAnimations(playerSeat: number, upToId: number): void {
    this.#runner.game.acknowledgeAnimationEvents(upToId);

    if (this.#storage) {
      this.#storage.save(this.#storedState);
    }
  }
}
```

## UI Composables

### useAnimationEvents

```typescript
// src/ui/composables/useAnimationEvents.ts

export interface AnimationEventHandler<T extends string = string> {
  type: T;
  handle: (event: AnimationEvent<T>) => Promise<void>;
}

export interface UseAnimationEventsOptions {
  gameState: Ref<PlayerGameState | null>;
  acknowledgeEvents: (upToId: number) => void;
  handlers: AnimationEventHandler[];
  defaultHandler?: (event: AnimationEvent) => Promise<void>;
}

export interface UseAnimationEventsReturn {
  isAnimating: Ref<boolean>;
  currentEvent: Ref<AnimationEvent | null>;
  queueLength: Ref<number>;
  skipAll: () => void;
  paused: Ref<boolean>;
}

export function useAnimationEvents(options: UseAnimationEventsOptions): UseAnimationEventsReturn
```

### useActionController Modifications

```typescript
// src/ui/composables/useActionController.ts

export function useActionController(options: UseActionControllerOptions) {
  // ... existing code ...

  const animationsPending = computed(() => {
    const events = options.gameState.value?.animationEvents;
    return events && events.length > 0;
  });

  const showActionPanel = computed(() => {
    if (animationsPending.value) return false;
    return isMyTurn.value && availableActions.value.length > 0;
  });

  return {
    // ... existing returns ...
    animationsPending,
    showActionPanel,
  };
}
```

## Integration with useAutoAnimations

```typescript
// src/ui/composables/useAutoAnimations.ts

export interface AutoAnimationsOptions {
  // ... existing options ...

  eventHandlers?: AnimationEventHandler[];
  acknowledgeEvents?: (upToId: number) => void;
}
```

## Data Flow

```
Game Logic:
  game.emitAnimationEvent('combat-roll', { attacker, rolls, hits })
  // State mutation happens immediately
  target.health -= damage
  game.emitAnimationEvent('damage', { target, damage })
        ↓
Serialization:
  PlayerGameState includes animationEvents array
        ↓
Client Receives:
  { animationEvents: [...], availableActions: ['move'], isMyTurn: true }
        ↓
UI Logic:
  1. animationEvents.length > 0 → hide ActionPanel
  2. useAnimationEvents processes queue
  3. Each handler plays animation, returns Promise
  4. On complete → acknowledgeEvents(lastId)
  5. Events cleared → ActionPanel appears
```

## Serialization & Replay

Animation event buffer is included in GameStateSnapshot:

```typescript
export interface GameStateSnapshot {
  // ... existing fields ...
  animationEventBuffer: AnimationEventBuffer;
}
```

On restore:
- Buffer is restored with acknowledgedId intact
- Only unacknowledged events appear in pendingAnimationEvents
- Replay is safe (events won't re-trigger)

## Example: MERC Combat

```typescript
// Game logic
resolveCombat(sector: Sector): void {
  for (const attacker of combatants) {
    const rolls = this.rollDice(attacker.combat);

    this.emitAnimationEvent('attack', {
      attacker: attacker.id,
      rolls,
      hits: rolls.filter(r => r >= 4).length,
    });

    // State mutation - immediate
    target.health -= damage;

    this.emitAnimationEvent('damage', {
      target: target.id,
      damage,
    });
  }
}

// UI handlers
handlers: [
  {
    type: 'attack',
    handle: async (event) => {
      await highlightAttacker(event.data.attacker, 400);
      await rollDiceAnimation(event.data.rolls, 1200);
    },
  },
  {
    type: 'damage',
    handle: async (event) => {
      await showDamageNumber(event.data.target, event.data.damage, 400);
    },
  },
]
```

## What This Eliminates

For games like MERC, this design eliminates:

- ❌ `_combatAnimationEventsBuffer` hack
- ❌ `completedCombatSnapshot` workaround
- ❌ Fake actions like `acknowledgeCompletedCombat`
- ❌ Manual event deduplication
- ❌ Two-phase cleanup dance
- ❌ Vue batching workarounds

## Files to Create

| File | Purpose |
|------|---------|
| `src/engine/animation/types.ts` | AnimationEvent, AnimationEventBuffer types |
| `src/engine/animation/index.ts` | Exports |
| `src/ui/composables/useAnimationEvents.ts` | Event consumption and handler orchestration |

## Files to Modify

| File | Changes |
|------|---------|
| `src/engine/element/game.ts` | Add emitAnimationEvent(), buffer management |
| `src/engine/index.ts` | Export animation types |
| `src/engine/utils/snapshot.ts` | Include animation buffer in snapshots |
| `src/session/types.ts` | Add animationEvents to PlayerGameState |
| `src/session/utils.ts` | Include events in buildPlayerState() |
| `src/session/game-session.ts` | Add acknowledgeAnimations() method |
| `src/ui/composables/useAutoAnimations.ts` | Integrate event handlers |
| `src/ui/composables/useActionController.ts` | Add animationsPending, showActionPanel |
| `src/ui/index.ts` | Export useAnimationEvents |
| `docs/ui-components.md` | Document the animation event system |

## Success Criteria

1. Games can emit animation events with `game.emitAnimationEvent(type, data)`
2. UI receives events in `PlayerGameState.animationEvents`
3. ActionPanel is hidden while animations are pending
4. Events are acknowledged and pruned after playback
5. Checkpoint/replay works correctly (events serialize with state)
6. Skip button allows users to bypass animations
7. MERC can delete all their workaround code
