# Phase 61: Animation Playback - Research

**Researched:** 2026-01-22
**Domain:** Vue 3 composables / Animation event consumption
**Confidence:** HIGH

## Summary

This phase creates the UI-side composable `useAnimationEvents()` that consumes animation events from `PlayerGameState.animationEvents` (established in Phase 60). The composable processes events sequentially, allows custom handlers per event type, and provides playback control (pause/resume/skip).

The pattern follows existing BoardSmith composables (`useBoardInteraction`, `useActionController`) - reactive state management via Vue refs, provide/inject for tree-wide access, and clean separation between state and actions. The key insight is that handlers return Promises, enabling frame-perfect timing control where each animation completes before the next begins.

**Primary recommendation:** Create `useAnimationEvents()` composable with handler registry, Promise-based sequential playback, and playback control refs. Integrate with `GameShell.vue` to provide events to game boards. Gate `ActionPanel` on `isAnimating` to prevent action execution during playback.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | 3.5+ | Reactive state management (ref, computed, watch) | Already in use, provides reactivity primitives |
| TypeScript | 5.7 | Type definitions | Already the codebase language |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | Pure Vue composable | No additional dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Promise-based handlers | Callback-based handlers | Promise is cleaner for async timing, matches modern patterns |
| Manual event loop | RxJS observables | Overkill for sequential processing, adds dependency |
| Global event bus | Provide/inject | Provide/inject matches existing patterns, type-safe |

**Installation:**
No new dependencies required.

## Architecture Patterns

### Recommended Data Flow

```
PlayerGameState (from Phase 60)
  animationEvents: AnimationEvent[]
  lastAnimationEventId: number

         | watch for new events |
                   v

useAnimationEvents() Composable
  - Maintains handler registry by event type
  - Processes events sequentially (Promise chain)
  - Exposes isAnimating, paused, skipAll()

         | provides to tree |
                   v

Game UI Components
  - Register handlers for event types they care about
  - Handlers return Promise<void> for timing control
  - Read isAnimating to gate interactions

         | gates on isAnimating |
                   v

ActionPanel
  - Disables action execution while isAnimating
  - Shows visual indicator during playback
```

### Composable API Design

```typescript
// src/ui/composables/useAnimationEvents.ts

import type { AnimationEvent } from 'boardsmith/engine';

export interface AnimationHandler {
  /** Handle a single animation event. Return a Promise that resolves when animation completes. */
  (event: AnimationEvent): Promise<void>;
}

export interface UseAnimationEventsOptions {
  /** Animation events from PlayerGameState */
  events: () => AnimationEvent[] | undefined;
  /** Session's acknowledgeAnimations function */
  acknowledge: (upToId: number) => void;
  /** Default handler duration when handler doesn't return a Promise (ms) */
  defaultDuration?: number;
}

export interface UseAnimationEventsReturn {
  /** Register a handler for an event type. Returns unregister function. */
  registerHandler: (eventType: string, handler: AnimationHandler) => () => void;

  /** Whether animations are currently playing */
  isAnimating: Ref<boolean>;

  /** Whether playback is paused */
  paused: Ref<boolean>;

  /** Skip all remaining animations in the queue */
  skipAll: () => void;

  /** Number of pending events (for UI indicators) */
  pendingCount: Ref<number>;
}
```

### Handler Registration Pattern

```typescript
// In game board component
const { registerHandler, isAnimating } = useAnimationEvents();

// Register handlers in onMounted (or setup)
onMounted(() => {
  // Handler returns Promise - animation waits for completion
  registerHandler('cardMove', async (event) => {
    const { cardId, fromPosition, toPosition } = event.data;
    await flyCard(cardId, fromPosition, toPosition, 400); // 400ms animation
  });

  // Handler for combat animations
  registerHandler('combat', async (event) => {
    const { attackerId, defenderId, damage } = event.data;
    await showDamageNumber(defenderId, damage);
    await shakeElement(defenderId);
  });

  // Handler with no animation (instant)
  registerHandler('score', async (event) => {
    // Just update score display, no animation needed
    // Resolves immediately
  });
});
```

### Sequential Playback Implementation

```typescript
// Core playback logic (inside composable)
async function processQueue(): Promise<void> {
  if (_isProcessing || paused.value) return;
  _isProcessing = true;
  isAnimating.value = true;

  try {
    while (_queue.length > 0 && !_skipRequested) {
      // Wait if paused
      if (paused.value) {
        await waitForUnpause();
      }

      const event = _queue.shift()!;
      const handler = _handlers.get(event.type);

      if (handler) {
        try {
          await handler(event);
        } catch (err) {
          console.error(`[Animation] Handler error for '${event.type}':`, err);
          // Continue to next event despite error
        }
      } else {
        // No handler registered - skip with default delay
        await delay(options.defaultDuration ?? 0);
      }

      // Acknowledge this event was processed
      _lastProcessedId = event.id;
    }

    // Acknowledge all processed events
    if (_lastProcessedId !== null) {
      options.acknowledge(_lastProcessedId);
      _lastProcessedId = null;
    }
  } finally {
    _isProcessing = false;
    _skipRequested = false;
    isAnimating.value = _queue.length > 0;
  }
}
```

### Provide/Inject Pattern

Following `useBoardInteraction` pattern:

```typescript
// Injection key
const ANIMATION_EVENTS_KEY: InjectionKey<UseAnimationEventsReturn> = Symbol('animationEvents');

// Provider (in GameShell or parent)
export function provideAnimationEvents(instance: UseAnimationEventsReturn): void {
  provide(ANIMATION_EVENTS_KEY, instance);
}

// Consumer (in game components)
export function useAnimationEvents(): UseAnimationEventsReturn | undefined {
  return inject(ANIMATION_EVENTS_KEY);
}
```

### GameShell Integration

```typescript
// In GameShell.vue setup
const animationEvents = useAnimationEventsCore({
  events: () => state.value?.state?.animationEvents,
  acknowledge: (upToId) => {
    // Call session's acknowledge endpoint
    fetch(`${apiUrl}/games/${gameId.value}/acknowledge-animations`, {
      method: 'POST',
      body: JSON.stringify({ player: playerSeat.value, upToId }),
    });
  },
});

provideAnimationEvents(animationEvents);

// Provide to slot props
<slot name="game-board"
  :animation-events="animationEvents"
  :is-animating="animationEvents.isAnimating"
  ...
/>
```

### ActionPanel Gating

```typescript
// In ActionPanel.vue
const animationEvents = inject(ANIMATION_EVENTS_KEY);

// Disable actions while animating
const canExecuteActions = computed(() => {
  return isMyTurn.value && !animationEvents?.isAnimating.value;
});
```

### File Organization

```
src/ui/
├── composables/
│   └── useAnimationEvents.ts     # New composable
├── components/
│   ├── GameShell.vue             # Integration point
│   └── auto-ui/
│       └── ActionPanel.vue       # Gate on isAnimating
└── index.ts                      # Export new composable
```

### Anti-Patterns to Avoid

- **Anti-pattern: Processing events in parallel** - Events MUST be sequential. Parallel execution breaks timing expectations and can cause visual chaos.

- **Anti-pattern: Handlers modifying state directly** - Handlers should trigger visual animations only. Game state is already updated; animations are cosmetic.

- **Anti-pattern: Blocking on missing handlers** - If no handler is registered for an event type, skip it. Don't throw or block.

- **Anti-pattern: Not acknowledging on skip** - When `skipAll()` is called, still acknowledge all events so they're cleared from the buffer.

- **Anti-pattern: Re-processing events after acknowledge** - Track which events have been processed to avoid re-triggering on state updates.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reactive state | Custom event emitter | Vue refs (ref, computed) | Reactivity is built-in, matches codebase |
| Component tree access | Prop drilling | provide/inject | Matches useBoardInteraction pattern |
| Async sequencing | Custom scheduler | Promise chain with async/await | Native, well-understood, debuggable |
| Event tracking | Manual ID tracking | Watch on animationEvents array | Vue watch handles change detection |

**Key insight:** Vue's reactivity system handles the hard parts. The composable just orchestrates.

## Common Pitfalls

### Pitfall 1: Processing Same Events Multiple Times
**What goes wrong:** Animation plays repeatedly on every state update
**Why it happens:** Watch triggers on any state change, not just new events
**How to avoid:** Track `lastProcessedId` locally. On new events, only queue events with `id > lastProcessedId`
**Warning signs:** Animations repeat, handlers called multiple times for same event

### Pitfall 2: Race Condition Between Acknowledge and New Events
**What goes wrong:** Events acknowledged before handler completes, then new events arrive mid-animation
**Why it happens:** Acknowledge called immediately instead of after handler
**How to avoid:** Acknowledge AFTER processing complete. Batch acknowledge at end of queue processing.
**Warning signs:** Events disappear from queue before animation visible

### Pitfall 3: Paused State Not Respected in Queue Processing
**What goes wrong:** Events continue processing despite paused.value being true
**Why it happens:** Pause checked only at loop start, not during iteration
**How to avoid:** Check paused state before each event AND await unpause when paused
**Warning signs:** Animations continue playing after pause button clicked

### Pitfall 4: Memory Leak from Handler Registration
**What goes wrong:** Handlers accumulate on HMR or component remount
**Why it happens:** Handler not unregistered on unmount
**How to avoid:** Return unregister function from registerHandler, call in onUnmounted
**Warning signs:** Multiple animations for same event, memory growth in devtools

### Pitfall 5: Handler Errors Breaking the Queue
**What goes wrong:** One bad handler stops all subsequent animations
**Why it happens:** Unhandled rejection in async handler breaks Promise chain
**How to avoid:** Wrap each handler call in try/catch, log error, continue
**Warning signs:** Animations stop mid-sequence after console error

### Pitfall 6: skipAll Not Acknowledging Events
**What goes wrong:** Skipped events remain in buffer, replay on reconnect
**Why it happens:** skipAll just empties local queue without acknowledging
**How to avoid:** skipAll should acknowledge all remaining event IDs before clearing
**Warning signs:** Old animations replay after page refresh

## Code Examples

### Complete Composable Implementation Sketch

```typescript
// src/ui/composables/useAnimationEvents.ts
import { ref, watch, type Ref, type InjectionKey, provide, inject } from 'vue';
import type { AnimationEvent } from 'boardsmith/engine';

export interface AnimationHandler {
  (event: AnimationEvent): Promise<void>;
}

export interface UseAnimationEventsOptions {
  events: () => AnimationEvent[] | undefined;
  acknowledge: (upToId: number) => void;
  defaultDuration?: number;
}

export interface UseAnimationEventsReturn {
  registerHandler: (eventType: string, handler: AnimationHandler) => () => void;
  isAnimating: Ref<boolean>;
  paused: Ref<boolean>;
  skipAll: () => void;
  pendingCount: Ref<number>;
}

export const ANIMATION_EVENTS_KEY: InjectionKey<UseAnimationEventsReturn> =
  Symbol('animationEvents');

export function createAnimationEvents(
  options: UseAnimationEventsOptions
): UseAnimationEventsReturn {
  const handlers = new Map<string, AnimationHandler>();
  const queue: AnimationEvent[] = [];
  const isAnimating = ref(false);
  const paused = ref(false);
  const pendingCount = ref(0);

  let lastProcessedId = 0;
  let isProcessing = false;
  let skipRequested = false;
  let unpauseResolve: (() => void) | null = null;

  function registerHandler(eventType: string, handler: AnimationHandler): () => void {
    handlers.set(eventType, handler);
    return () => handlers.delete(eventType);
  }

  async function processQueue(): Promise<void> {
    if (isProcessing) return;
    isProcessing = true;
    isAnimating.value = true;

    try {
      while (queue.length > 0 && !skipRequested) {
        if (paused.value) {
          await new Promise<void>(resolve => { unpauseResolve = resolve; });
          unpauseResolve = null;
        }

        const event = queue.shift()!;
        pendingCount.value = queue.length;

        const handler = handlers.get(event.type);
        if (handler) {
          try {
            await handler(event);
          } catch (err) {
            console.error(`[Animation] Handler error for '${event.type}':`, err);
          }
        } else if (options.defaultDuration) {
          await new Promise(r => setTimeout(r, options.defaultDuration));
        }

        lastProcessedId = event.id;
      }

      // Acknowledge all processed events
      if (lastProcessedId > 0) {
        options.acknowledge(lastProcessedId);
      }
    } finally {
      isProcessing = false;
      skipRequested = false;
      isAnimating.value = false;
      pendingCount.value = 0;
    }
  }

  function skipAll(): void {
    // Acknowledge all queued events
    if (queue.length > 0) {
      const lastId = queue[queue.length - 1].id;
      options.acknowledge(lastId);
    }
    queue.length = 0;
    skipRequested = true;
    pendingCount.value = 0;

    // Resolve any pending pause
    if (unpauseResolve) {
      unpauseResolve();
    }
  }

  // Watch for pause state changes
  watch(paused, (isPaused) => {
    if (!isPaused && unpauseResolve) {
      unpauseResolve();
    }
  });

  // Watch for new events
  watch(
    () => options.events(),
    (events) => {
      if (!events || events.length === 0) return;

      // Only queue events we haven't processed
      const newEvents = events.filter(e => e.id > lastProcessedId);
      if (newEvents.length === 0) return;

      queue.push(...newEvents);
      pendingCount.value = queue.length;

      // Start processing if not already
      processQueue();
    },
    { immediate: true }
  );

  return {
    registerHandler,
    isAnimating,
    paused,
    skipAll,
    pendingCount,
  };
}

export function provideAnimationEvents(instance: UseAnimationEventsReturn): void {
  provide(ANIMATION_EVENTS_KEY, instance);
}

export function useAnimationEvents(): UseAnimationEventsReturn | undefined {
  return inject(ANIMATION_EVENTS_KEY);
}
```

### Game Board Handler Registration

```typescript
// In a game board component
<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useAnimationEvents } from 'boardsmith/ui';

const animationEvents = useAnimationEvents();

// Track cleanup functions
const cleanupHandlers: Array<() => void> = [];

onMounted(() => {
  if (!animationEvents) return;

  // Register card movement animation
  cleanupHandlers.push(
    animationEvents.registerHandler('cardMove', async (event) => {
      const { cardId, from, to } = event.data as {
        cardId: number;
        from: string;
        to: string
      };

      // Use existing flying cards composable
      await flyCard({
        elementId: cardId,
        from: getElementPosition(from),
        to: getElementPosition(to),
        duration: 400,
      });
    })
  );

  // Register score animation
  cleanupHandlers.push(
    animationEvents.registerHandler('score', async (event) => {
      const { player, points } = event.data as { player: number; points: number };

      // Show floating score number
      await showFloatingText(`+${points}`, getPlayerScorePosition(player), 1000);
    })
  );
});

onUnmounted(() => {
  // Clean up all handlers
  cleanupHandlers.forEach(cleanup => cleanup());
});
</script>
```

### ActionPanel Integration

```typescript
// In ActionPanel.vue
<script setup lang="ts">
import { computed, inject } from 'vue';
import { ANIMATION_EVENTS_KEY } from '../composables/useAnimationEvents';

const animationEvents = inject(ANIMATION_EVENTS_KEY);

// Gate action execution on animation state
const canPerformAction = computed(() => {
  if (!props.isMyTurn) return false;
  if (animationEvents?.isAnimating.value) return false;
  return true;
});
</script>

<template>
  <!-- Show indicator when animating -->
  <div v-if="animationEvents?.isAnimating.value" class="animating-indicator">
    Playing animations...
    <button @click="animationEvents.skipAll()">Skip</button>
  </div>

  <!-- Normal action buttons, disabled while animating -->
  <div :class="{ disabled: !canPerformAction }">
    <!-- action buttons -->
  </div>
</template>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No animation events | Game emits events (Phase 59) | Phase 59 | Foundation established |
| Events not exposed to UI | PlayerGameState includes events (Phase 60) | Phase 60 | UI can receive events |
| UI receives events but no playback | useAnimationEvents composable (Phase 61) | This phase | UI can play back animations |

**Deprecated/outdated:**
- None for this phase - building on Phase 59/60 foundation

## Implementation Strategy

### Task 1: Create useAnimationEvents Composable
1. Create `src/ui/composables/useAnimationEvents.ts`
2. Implement handler registry with Map
3. Implement sequential queue processing with async/await
4. Implement isAnimating, paused, skipAll, pendingCount refs
5. Implement provide/inject pattern

### Task 2: Add Acknowledge Endpoint
1. Add `/games/:id/acknowledge-animations` endpoint to server
2. Route to `GameSession.acknowledgeAnimations()`
3. Handle WebSocket message type for real-time acknowledgment

### Task 3: Integrate with GameShell
1. Create animation events instance in GameShell setup
2. Provide to component tree
3. Pass acknowledge function that calls server endpoint
4. Expose to game-board slot props

### Task 4: Gate ActionPanel
1. Inject animation events in ActionPanel
2. Disable action execution while isAnimating
3. Show visual indicator during playback
4. Add skip button

### Task 5: Export from UI Package
1. Add exports to `src/ui/index.ts`
2. Export types and functions

### Task 6: Write Tests
1. Unit tests for queue processing
2. Unit tests for handler registration/cleanup
3. Unit tests for pause/resume/skip
4. Integration tests with mock events

## Open Questions

Things that couldn't be fully resolved:

1. **Should handlers be able to cancel pending events?**
   - What we know: Current design processes all events
   - What's unclear: Should a handler be able to say "skip remaining"?
   - Recommendation: Keep simple - handlers just animate, skipAll is for user control

2. **Should there be event grouping support?**
   - What we know: AnimationEvent has optional `group` field
   - What's unclear: Should grouped events play together or have special handling?
   - Recommendation: Defer grouping to Phase 62+. Sequential is sufficient for MVP.

3. **WebSocket vs HTTP for acknowledge?**
   - What we know: Both patterns exist in codebase
   - What's unclear: Which is preferred for this use case?
   - Recommendation: HTTP POST is simpler, matches existing patterns. WebSocket can be added later for efficiency.

4. **Should pendingCount include currently-playing event?**
   - What we know: UI may want to show "3 animations remaining"
   - What's unclear: Does "remaining" include current?
   - Recommendation: Decrement after handler completes, so current is included in count.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/ui/composables/useBoardInteraction.ts` - Provide/inject pattern reference
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionController.ts` - Composable design patterns
- `/Users/jtsmith/BoardSmith/src/ui/components/GameShell.vue` - Integration point
- `/Users/jtsmith/BoardSmith/src/session/types.ts` - AnimationEvent type, PlayerGameState interface
- `/Users/jtsmith/BoardSmith/.planning/phases/60-session-integration/60-RESEARCH.md` - Phase 60 context

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/src/engine/element/game.ts` - AnimationEvent definition
- `/Users/jtsmith/BoardSmith/src/ui/composables/useAutoAnimations.ts` - Existing animation patterns

### Tertiary (LOW confidence)
- Vue 3 Composition API documentation - Standard patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Pure Vue composable, no dependencies
- Architecture: HIGH - Clear patterns from existing composables
- Pitfalls: HIGH - Based on async queue processing patterns
- Implementation: HIGH - Straightforward feature with clear requirements

**Research date:** 2026-01-22
**Valid until:** Indefinite - internal integration work with stable requirements
