# Phase 62: ActionController Integration - Research

**Researched:** 2026-01-22
**Domain:** Vue 3 composable integration / Animation-gated UI
**Confidence:** HIGH

## Summary

This phase integrates the animation event system (from Phase 61) with the ActionController and useAutoAnimations composables to enable animation-aware action execution. The key requirement is that the ActionPanel waits for animations to complete before showing new decisions to the user.

The integration points are clear and well-defined:
1. **useActionController** needs two new computed properties: `animationsPending` and `showActionPanel`
2. **useAutoAnimations** needs an `eventHandlers` option to register handlers with useAnimationEvents
3. **useAnimationEvents** is already exported from the UI package (completed in Phase 61)

The pattern follows the existing "soft continuation" design: game state advances immediately, but the UI gates on animation completion before presenting new choices. This is achieved by having useActionController consume the `isAnimating` state from the animation events system.

**Primary recommendation:** Add `animationsPending` and `showActionPanel` computed properties to useActionController, accepting an optional `animationEvents` ref in options. Add `eventHandlers` option to useAutoAnimations that forwards to createAnimationEvents.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | 3.5+ | Reactive computed properties (computed, ref, watch) | Already in use, provides reactivity primitives |
| TypeScript | 5.7 | Type definitions | Already the codebase language |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | Pure Vue composable integration | No additional dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Computed in useActionController | Separate composable | Keeps animation gating close to action execution logic |
| Pass isAnimating directly to ActionPanel | Pass through controller | Controller provides unified interface, easier for custom UIs |

**Installation:**
No new dependencies required.

## Architecture Patterns

### Integration Data Flow

```
useAnimationEvents (from Phase 61)
  - isAnimating: Ref<boolean>
  - registerHandler()
           |
           v
useActionController (this phase)
  - NEW: animationsPending: ComputedRef<boolean>
  - NEW: showActionPanel: ComputedRef<boolean>
  - Accepts: animationEvents option
           |
           v
ActionPanel.vue
  - Gates UI on showActionPanel
  - Shows "animations pending" indicator
           |
           v
useAutoAnimations (this phase)
  - NEW: eventHandlers option
  - Registers handlers with animation events
```

### Recommended API Changes

#### useActionController Changes

```typescript
// src/ui/composables/useActionController.ts

export interface UseActionControllerOptions {
  // ... existing options ...

  /**
   * Animation events instance (from createAnimationEvents).
   * When provided, useActionController exposes animationsPending and showActionPanel
   * which gate action UI on animation completion.
   */
  animationEvents?: UseAnimationEventsReturn;
}

export interface UseActionControllerReturn {
  // ... existing return values ...

  /**
   * Whether animations are currently pending/playing.
   * True when animationEvents.isAnimating is true.
   * Always false if animationEvents not provided.
   */
  animationsPending: ComputedRef<boolean>;

  /**
   * Whether to show the action panel to the user.
   * True when: isMyTurn && !animationsPending
   * Use this to gate ActionPanel visibility/interactivity.
   */
  showActionPanel: ComputedRef<boolean>;
}
```

#### Implementation Pattern

```typescript
// Inside useActionController function

const animationsPending = computed(() => {
  return options.animationEvents?.isAnimating.value ?? false;
});

const showActionPanel = computed(() => {
  // Show panel when:
  // 1. It's my turn
  // 2. No animations are pending
  return isMyTurn.value && !animationsPending.value;
});

return {
  // ... existing returns ...
  animationsPending,
  showActionPanel,
};
```

#### useAutoAnimations Changes

```typescript
// src/ui/composables/useAutoAnimations.ts

export interface AutoAnimationsOptions {
  // ... existing options ...

  /**
   * Event handlers to register with animation events.
   * Key is event type, value is handler function.
   * Handlers are registered when composable is created.
   *
   * @example
   * ```typescript
   * eventHandlers: {
   *   cardMove: async (event) => {
   *     await flyCard(event.data.cardId, event.data.from, event.data.to);
   *   },
   *   combat: async (event) => {
   *     await showExplosion(event.data.position);
   *   },
   * }
   * ```
   */
  eventHandlers?: Record<string, AnimationHandler>;

  /**
   * Animation events instance (from createAnimationEvents).
   * Required when using eventHandlers option.
   */
  animationEvents?: UseAnimationEventsReturn;
}
```

#### Implementation Pattern

```typescript
// Inside useAutoAnimations function

// Register event handlers with animation events if provided
if (options.eventHandlers && options.animationEvents) {
  for (const [eventType, handler] of Object.entries(options.eventHandlers)) {
    options.animationEvents.registerHandler(eventType, handler);
  }
}
```

### GameShell Integration

GameShell.vue already creates the actionController. The integration adds:

```typescript
// In GameShell.vue setup
import { createAnimationEvents, provideAnimationEvents } from '../composables/useAnimationEvents';

// Create animation events instance
const animationEvents = createAnimationEvents({
  events: () => state.value?.animationEvents,
  acknowledge: (upToId) => {
    // Call server endpoint to acknowledge
    fetch(`${props.apiUrl}/games/${gameId.value}/acknowledge-animations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: playerSeat.value, upToId }),
    });
  },
});

// Provide to component tree
provideAnimationEvents(animationEvents);

// Pass to action controller
const actionController = useActionController({
  // ... existing options ...
  animationEvents, // NEW: enables animation-gated action panel
});

// Expose to slot props
<slot name="game-board"
  :animation-events="animationEvents"
  :is-animating="animationEvents.isAnimating"
  ...
/>
```

### ActionPanel Gating

```typescript
// In ActionPanel.vue
const actionController = inject<UseActionControllerReturn>('actionController');

// Use showActionPanel from controller for gating
const canShowActions = computed(() => actionController?.showActionPanel.value ?? true);

// Or check animationsPending directly for custom UI
const isWaitingForAnimations = computed(() => actionController?.animationsPending.value ?? false);
```

```vue
<template>
  <!-- Show pending indicator when animations are playing -->
  <div v-if="isWaitingForAnimations" class="animations-pending">
    Waiting for animations...
    <button @click="skipAnimations">Skip</button>
  </div>

  <!-- Normal action panel, gated on showActionPanel -->
  <div v-else-if="canShowActions" class="action-panel">
    <!-- action buttons -->
  </div>

  <!-- Not my turn -->
  <div v-else class="waiting-message">
    Waiting for other player...
  </div>
</template>
```

### File Organization

```
src/ui/
├── composables/
│   ├── useActionController.ts         # Add animationsPending, showActionPanel
│   ├── useActionControllerTypes.ts    # Add option/return types
│   ├── useAutoAnimations.ts           # Add eventHandlers option
│   └── useAnimationEvents.ts          # Already complete (Phase 61)
├── components/
│   └── auto-ui/
│       └── ActionPanel.vue            # Gate on showActionPanel
└── index.ts                           # useAnimationEvents already exported
```

### Anti-Patterns to Avoid

- **Anti-pattern: Blocking action execution during animations** - The controller should NOT prevent execute() from being called. Only the UI should be gated. If a custom UI wants to execute during animations, that's their choice.

- **Anti-pattern: Tight coupling between animation types and controller** - The controller should only know about `isAnimating` boolean, not specific animation types. Event handlers are registered separately.

- **Anti-pattern: Making animationEvents required** - Should be optional with sensible defaults (animationsPending = false, showActionPanel = isMyTurn) when not provided.

- **Anti-pattern: Duplicate animation state tracking** - Don't create new refs for animation state in ActionPanel. Use the controller's computed properties as single source of truth.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Animation state tracking | Custom refs in ActionPanel | useActionController.animationsPending | Single source of truth |
| Gating logic | Multiple checks in template | useActionController.showActionPanel | Encapsulates logic |
| Handler registration | Manual registration in game boards | useAutoAnimations.eventHandlers option | Declarative, auto-cleanup |
| Animation event consumption | Direct watch on events | useAnimationEvents (Phase 61) | Handles queue, acknowledgment |

**Key insight:** The existing composables already handle the hard parts. This phase just wires them together.

## Common Pitfalls

### Pitfall 1: Breaking Custom UIs That Don't Use Animation Events
**What goes wrong:** Custom UIs that don't pass animationEvents stop working
**Why it happens:** Making animationEvents required or having bad defaults
**How to avoid:** animationEvents is optional. When not provided: animationsPending = false, showActionPanel = isMyTurn
**Warning signs:** TypeScript errors in existing game boards

### Pitfall 2: Circular Dependency Between Composables
**What goes wrong:** useActionController imports useAnimationEvents which imports useActionController
**Why it happens:** Trying to couple them too tightly
**How to avoid:** useActionController accepts UseAnimationEventsReturn as option, doesn't import implementation
**Warning signs:** Build errors, infinite loops

### Pitfall 3: ActionPanel Shows Flash Before Animations Start
**What goes wrong:** Brief flash of action buttons before animations begin
**Why it happens:** Animation events haven't been processed yet when component mounts
**How to avoid:** animationsPending should check for pending events in queue, not just isAnimating
**Warning signs:** UI flicker on state transitions

### Pitfall 4: Handlers Not Cleaned Up on Component Unmount
**What goes wrong:** Handlers accumulate, memory leak, stale closures
**Why it happens:** eventHandlers registered but not unregistered
**How to avoid:** Store cleanup functions, call in onUnmounted
**Warning signs:** Multiple animations for same event, console errors

### Pitfall 5: showActionPanel Doesn't Account for followUp Actions
**What goes wrong:** Action panel flashes during followUp transitions
**Why it happens:** pendingFollowUp not considered in showActionPanel
**How to avoid:** showActionPanel should also check !pendingFollowUp.value
**Warning signs:** Brief button flash between followUp actions

## Code Examples

### useActionController Integration

```typescript
// src/ui/composables/useActionController.ts
// Add to options interface
export interface UseActionControllerOptions {
  // ... existing ...

  /**
   * Animation events instance for animation-gated action panel.
   * When provided, animationsPending and showActionPanel become functional.
   */
  animationEvents?: UseAnimationEventsReturn;
}

// Add to function body
export function useActionController(options: UseActionControllerOptions): UseActionControllerReturn {
  // ... existing code ...

  // Animation gating - gates action panel on animation completion
  const animationsPending = computed((): boolean => {
    return options.animationEvents?.isAnimating.value ?? false;
  });

  const showActionPanel = computed((): boolean => {
    // Show when:
    // 1. It's my turn
    // 2. No animations pending
    // 3. No followUp action pending
    return isMyTurn.value && !animationsPending.value && !pendingFollowUp.value;
  });

  return {
    // ... existing returns ...
    animationsPending,
    showActionPanel,
  };
}
```

### useAutoAnimations Integration

```typescript
// src/ui/composables/useAutoAnimations.ts
import type { AnimationHandler, UseAnimationEventsReturn } from './useAnimationEvents.js';

export interface AutoAnimationsOptions {
  // ... existing ...

  /**
   * Event handlers to register with animation events.
   * Keys are event types, values are handler functions.
   */
  eventHandlers?: Record<string, AnimationHandler>;

  /**
   * Animation events instance. Required when using eventHandlers.
   */
  animationEvents?: UseAnimationEventsReturn;
}

export function useAutoAnimations(options: AutoAnimationsOptions): AutoAnimationsReturn {
  // ... existing setup ...

  // Register event handlers if provided
  const handlerCleanups: Array<() => void> = [];

  if (options.eventHandlers && options.animationEvents) {
    for (const [eventType, handler] of Object.entries(options.eventHandlers)) {
      const cleanup = options.animationEvents.registerHandler(eventType, handler);
      handlerCleanups.push(cleanup);
    }
  }

  // Add cleanup to reset function
  function reset(): void {
    // ... existing reset code ...

    // Note: handlers persist across reset - only clean up on unmount
  }

  // Cleanup on scope dispose (composable unmount)
  // Note: Vue 3.4+ has onScopeDispose, for now rely on consumer to call cleanup

  return {
    // ... existing returns ...
    // Optionally expose cleanup for manual control
  };
}
```

### ActionPanel Gating

```vue
<!-- src/ui/components/auto-ui/ActionPanel.vue -->
<script setup lang="ts">
import { inject } from 'vue';
import { useAnimationEvents, ANIMATION_EVENTS_KEY } from '../../composables/useAnimationEvents';

// Get animation events for skip functionality
const animationEvents = inject(ANIMATION_EVENTS_KEY);

// Use controller's computed for gating
const showActionPanel = computed(() => actionController.showActionPanel.value);
const animationsPending = computed(() => actionController.animationsPending.value);

function skipAnimations() {
  animationEvents?.skipAll();
}
</script>

<template>
  <!-- Animations pending indicator -->
  <div v-if="animationsPending" class="animations-pending">
    <span class="pending-text">Playing animations...</span>
    <button class="skip-btn" @click="skipAnimations">Skip</button>
  </div>

  <!-- Normal action panel -->
  <div v-else-if="showActionPanel" class="action-panel">
    <!-- existing action panel content -->
  </div>

  <!-- Not my turn -->
  <div v-else class="waiting-message">
    Waiting for other player...
  </div>
</template>
```

### GameShell Integration Example

```typescript
// In GameShell.vue <script setup>
import {
  createAnimationEvents,
  provideAnimationEvents,
  useActionController,
} from '../composables';

// Create animation events (must be before actionController)
const animationEvents = createAnimationEvents({
  events: () => state.value?.animationEvents,
  acknowledge: async (upToId) => {
    if (!gameId.value) return;
    await fetch(`${props.apiUrl}/games/${gameId.value}/acknowledge-animations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: playerSeat.value, upToId }),
    });
  },
});

// Provide to component tree
provideAnimationEvents(animationEvents);

// Action controller with animation gating
const actionController = useActionController({
  sendAction: async (actionName, args) => { /* ... */ },
  availableActions,
  actionMetadata,
  isMyTurn,
  gameView,
  playerSeat,
  autoFill: autoEndTurn,
  autoExecute: true,
  externalArgs: actionArgs,
  fetchSelectionChoices: async (...args) => { /* ... */ },
  selectionStep: async (...args) => { /* ... */ },
  // NEW: Animation events for gating
  animationEvents,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No animation awareness | ActionController exposes animationsPending | This phase | UI can gate on animations |
| Manual handler registration | eventHandlers option in useAutoAnimations | This phase | Declarative, cleaner API |
| Spread animation state | Single source via controller | This phase | Unified state management |

**Deprecated/outdated:**
- None for this phase - extending existing patterns

## Implementation Strategy

### Task 1: Add Animation Options to useActionControllerTypes.ts
1. Add `animationEvents?: UseAnimationEventsReturn` to `UseActionControllerOptions`
2. Add `animationsPending: ComputedRef<boolean>` to `UseActionControllerReturn`
3. Add `showActionPanel: ComputedRef<boolean>` to `UseActionControllerReturn`

### Task 2: Implement Animation Computed Properties in useActionController.ts
1. Import `UseAnimationEventsReturn` type (type-only import)
2. Add `animationsPending` computed: `options.animationEvents?.isAnimating.value ?? false`
3. Add `showActionPanel` computed: `isMyTurn.value && !animationsPending.value && !pendingFollowUp.value`
4. Add both to return object

### Task 3: Add eventHandlers Option to useAutoAnimations.ts
1. Import `AnimationHandler` and `UseAnimationEventsReturn` types
2. Add `eventHandlers?: Record<string, AnimationHandler>` to options interface
3. Add `animationEvents?: UseAnimationEventsReturn` to options interface
4. Register handlers in function body when both options provided
5. Store cleanup functions for potential future cleanup needs

### Task 4: Update ActionPanel.vue for Animation Gating
1. Inject animation events for skip functionality
2. Use `actionController.showActionPanel` for main gating logic
3. Use `actionController.animationsPending` for pending indicator
4. Add "Playing animations..." state with Skip button
5. Style the pending indicator

### Task 5: Verify useAnimationEvents is Exported (UI-09)
1. Confirm `useAnimationEvents` is already exported from `src/ui/index.ts` (done in Phase 61)
2. No changes needed - just verification

### Task 6: Write Tests
1. Unit tests for new animationsPending computed
2. Unit tests for new showActionPanel computed
3. Unit tests for eventHandlers registration in useAutoAnimations
4. Integration test verifying ActionPanel gates on animations

## Open Questions

Things that couldn't be fully resolved:

1. **Should showActionPanel also consider isExecuting?**
   - What we know: Currently isExecuting disables buttons but doesn't hide panel
   - What's unclear: Should executing hide panel entirely?
   - Recommendation: Keep current behavior - disable, don't hide. showActionPanel gates on turn/animations only.

2. **Should eventHandlers cleanup be automatic or manual?**
   - What we know: Vue composables don't have automatic cleanup hooks like React
   - What's unclear: How to handle cleanup when game board unmounts
   - Recommendation: Document that handlers persist for composable lifetime. For HMR, rely on component re-creation.

3. **Should there be a timeout for stuck animations?**
   - What we know: A handler that never resolves would block forever
   - What's unclear: What's a reasonable timeout?
   - Recommendation: Defer to future phase. Current skipAll provides manual escape hatch.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionController.ts` - Current implementation, 1447 lines
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionControllerTypes.ts` - Type definitions
- `/Users/jtsmith/BoardSmith/src/ui/composables/useAutoAnimations.ts` - Current implementation, 278 lines
- `/Users/jtsmith/BoardSmith/src/ui/composables/useAnimationEvents.ts` - Phase 61 output, 274 lines
- `/Users/jtsmith/BoardSmith/src/ui/components/auto-ui/ActionPanel.vue` - Current implementation, 2035 lines
- `/Users/jtsmith/BoardSmith/src/ui/components/GameShell.vue` - Integration point, 1297 lines
- `/Users/jtsmith/BoardSmith/src/ui/index.ts` - Export surface, 318 lines

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/.planning/phases/61-animation-playback/61-RESEARCH.md` - Phase 61 design context
- `/Users/jtsmith/BoardSmith/.planning/STATE.md` - Prior decisions on animation gating

### Tertiary (LOW confidence)
- Vue 3 Composition API documentation - Standard patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Pure Vue composable integration, no dependencies
- Architecture: HIGH - Clear integration points from existing code
- Implementation: HIGH - Well-defined changes to existing composables
- Pitfalls: HIGH - Based on known patterns and prior phase learnings

**Research date:** 2026-01-22
**Valid until:** Indefinite - internal integration work with stable requirements
