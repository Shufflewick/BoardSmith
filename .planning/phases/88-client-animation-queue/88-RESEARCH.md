# Phase 88: Client Animation Queue - Research

**Researched:** 2026-02-07
**Domain:** Vue 3 composables, client-side FIFO queue, reactive state management
**Confidence:** HIGH

## Summary

This phase transforms the existing `createAnimationEvents()` composable into a queue with wait-for-handler semantics. The current composable already implements FIFO processing, sequential handler execution, `isAnimating`/`pendingCount` reactive state, `skipAll()`, `registerHandler()`, and provide/inject wiring. The existing code is ~90% of the way there -- what's missing is specifically the **wait-for-handler with timeout** behavior (CLI-02 through CLI-05, CLI-07).

Currently, when an event arrives with no registered handler, it is either skipped immediately (default) or delayed by `defaultDuration` ms. The new behavior must instead **pause the queue** and wait up to a configurable timeout (default 3s) for a handler to register, then resume if one appears or warn + skip if timeout expires.

**Primary recommendation:** Modify the existing `createAnimationEvents()` composable in-place. No new files needed. The change is surgical: replace the "no handler" branch in `processQueue()` with a wait-for-handler mechanism, add a timeout option, and wire `registerHandler()` to resolve any pending wait.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | 3.x | `ref`, `watch`, `computed`, `provide/inject` | Already used throughout the UI module |

### Supporting
No additional libraries needed. This is pure TypeScript + Vue reactivity.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual Promise resolve/reject for wait | RxJS observable queue | Massive overkill -- the composable is 100 lines |
| setTimeout for timeout | AbortController signal | More complex than needed for a simple timeout |

## Architecture Patterns

### Existing File Structure (no changes needed)
```
src/ui/composables/
  useAnimationEvents.ts       # The composable to modify
  useAnimationEvents.test.ts  # Existing tests to extend
src/ui/components/
  GameShell.vue               # Creates + provides the composable
  auto-ui/ActionPanel.vue     # Consumes via useAnimationEvents(), gates on isAnimating
```

### Pattern 1: Wait-for-Handler with Promise Resolution
**What:** When `processQueue()` dequeues an event and finds no handler, it creates a Promise that can be resolved either by (a) `registerHandler()` registering the needed type, or (b) a timeout expiring.
**When to use:** This is the core mechanism for CLI-02, CLI-03, CLI-05, CLI-07.

**Implementation approach:**
```typescript
// Inside processQueue(), when no handler found for event.type:
let waitingForType: string | null = null;
let waitResolve: ((handler: AnimationHandler | null) => void) | null = null;

// In processQueue:
const handler = handlers.get(event.type);
if (!handler) {
  // Wait for handler registration or timeout
  const result = await waitForHandler(event.type, handlerWaitTimeout);
  if (result === null) {
    // Timeout expired -- warn and skip
    console.warn(
      `Animation event "${event.type}" (id: ${event.id}) skipped: ` +
      `no handler registered after ${handlerWaitTimeout}ms`
    );
    continue; // skip to next event
  }
  // Handler registered -- use it
  await result(event);
}

// In registerHandler:
function registerHandler(eventType: string, handler: AnimationHandler) {
  handlers.set(eventType, handler);
  // If queue is waiting for this type, resume immediately
  if (waitingForType === eventType && waitResolve) {
    waitResolve(handler);
    waitResolve = null;
    waitingForType = null;
  }
  return () => { handlers.delete(eventType); };
}

// Wait helper:
function waitForHandler(type: string, timeout: number): Promise<AnimationHandler | null> {
  return new Promise((resolve) => {
    waitingForType = type;
    waitResolve = resolve;
    const timer = setTimeout(() => {
      if (waitingForType === type) {
        waitResolve = null;
        waitingForType = null;
        resolve(null); // timeout
      }
    }, timeout);
    // Store timer ref so skipAll can clear it
  });
}
```

### Pattern 2: Acknowledge Callback Becomes No-Op
**What:** The `acknowledge` callback in `UseAnimationEventsOptions` is currently required but wired to `() => {}` in GameShell. Since Phase 85 removed server-side acknowledgment, it's dead code. However, CLI-10 (removing it) is scoped to Phase 89, not 88. For this phase, keep `acknowledge` in the interface but note it's a no-op.
**When to use:** Phase 88 should NOT remove `acknowledge` -- that's CLI-10 in Phase 89.

### Pattern 3: Existing Provide/Inject Pattern
**What:** `createAnimationEvents()` is called in GameShell, results provided via `provideAnimationEvents()`. Child components call `useAnimationEvents()` to get the instance. This is identical to `useBoardInteraction` pattern.
**When to use:** No change needed. The existing pattern is correct and the `registerHandler()` API already exists.

### Anti-Patterns to Avoid
- **Polling for handler registration:** Do NOT use setInterval to check if handlers exist. Use Promise resolution triggered by `registerHandler()`.
- **Creating a new composable:** The existing `createAnimationEvents` composable handles everything. Modifying it in-place preserves all existing tests and integration.
- **Removing acknowledge in this phase:** CLI-10 is Phase 89. Don't mix phases.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FIFO queue | Custom linked list | Plain array with `shift()` | Already working in existing code |
| Reactive state | Custom event emitter | Vue `ref()` | Already working in existing code |
| Component injection | Context object | Vue `provide/inject` | Already working in existing code |
| Timeout + cancel | Custom timer manager | `setTimeout` + clear in `skipAll` | Simple, testable |

**Key insight:** The existing composable handles 7 of 9 requirements. The work is adding wait-for-handler semantics to the "no handler" branch, not building a new system.

## Common Pitfalls

### Pitfall 1: Timer Leak on skipAll
**What goes wrong:** If `skipAll()` is called while the queue is waiting for a handler (timeout pending), the timeout continues running after the queue is cleared, potentially resolving the wait promise after the queue has moved on.
**Why it happens:** `skipAll()` currently only clears the queue array and resolves the unpause promise. It doesn't know about a pending wait-for-handler timeout.
**How to avoid:** Store the timeout ID and clear it in `skipAll()`. Also resolve the waitResolve with null to unblock processQueue.
**Warning signs:** Console warnings appearing after skipAll is called.

### Pitfall 2: Race Between registerHandler and processQueue
**What goes wrong:** If `registerHandler('combat', fn)` is called just before processQueue checks for the handler, the wait might be created unnecessarily. Or if it's called just after the timeout fires, the handler is set but the event was already skipped.
**Why it happens:** JavaScript is single-threaded but async operations interleave at await points.
**How to avoid:** In `processQueue()`, always check `handlers.get(event.type)` AFTER the await returns from waitForHandler. The `registerHandler` function resolves the wait promise synchronously, so if it's called during the wait, the next microtask picks up the handler.
**Warning signs:** Events being skipped despite handlers being registered.

### Pitfall 3: Interaction with Existing Pause/Resume
**What goes wrong:** The composable already has a `paused` ref and `waitForUnpause()`. Adding a second wait mechanism (wait-for-handler) could create confusing interactions -- e.g., what happens if paused AND waiting for handler?
**Why it happens:** Two independent wait mechanisms sharing the same processing loop.
**How to avoid:** The pause check happens at the TOP of the loop iteration (before dequeuing an event). The wait-for-handler happens AFTER dequeuing but before executing. They operate at different points in the loop, so they don't conflict. Document this clearly.
**Warning signs:** Queue stuck permanently when both paused and waiting for handler.

### Pitfall 4: pendingCount Not Updated During Wait
**What goes wrong:** `pendingCount` is currently decremented when the event is shifted from the queue (before handler execution). If the queue waits for a handler, the event has already been dequeued, so pendingCount shows one fewer than expected.
**Why it happens:** The current code does `queue.shift()` then sets `pendingCount.value = queue.length`.
**How to avoid:** This is actually fine -- the event IS being processed (waiting for handler), so it's correct to not count it as "pending." The `isAnimating` flag covers the "something is happening" state. But consider whether the dequeued-but-waiting event should count toward `pendingCount`. Requirement CLI-09 says "reactive state preserved" which means existing behavior should be maintained -- current behavior doesn't count the in-progress event in pendingCount.
**Warning signs:** None -- this is the existing behavior.

### Pitfall 5: Timeout Value of 0
**What goes wrong:** If someone sets `handlerWaitTimeout: 0`, the setTimeout fires immediately (next microtask), but `registerHandler` might be called synchronously in the same tick.
**Why it happens:** setTimeout(fn, 0) fires after current synchronous code but before other microtasks.
**How to avoid:** Document that 0 means "skip immediately if no handler" (equivalent to current behavior). This is actually a useful escape hatch for tests.
**Warning signs:** Tests that rely on synchronous handler registration failing with timeout 0.

## Code Examples

### Current processQueue "no handler" branch (to be replaced)
```typescript
// Source: src/ui/composables/useAnimationEvents.ts lines 164-177
const handler = handlers.get(event.type);

if (handler) {
  try {
    await handler(event);
  } catch (error) {
    console.error(`Animation handler error for event type '${event.type}':`, error);
  }
} else if (defaultDuration > 0) {
  // No handler, but default duration configured - wait
  await new Promise<void>((resolve) => setTimeout(resolve, defaultDuration));
}
// No handler and no default duration - skip immediately
```

### New processQueue "no handler" branch (wait-for-handler)
```typescript
// After dequeuing event, check for handler:
let handler = handlers.get(event.type);

if (!handler) {
  // CLI-02: Wait for handler registration
  handler = await waitForHandler(event.type, handlerWaitTimeout);

  if (!handler) {
    // CLI-04/05: Timeout expired, warn and skip
    console.warn(
      `Animation event "${event.type}" (id: ${event.id}) skipped: ` +
      `no handler registered after ${handlerWaitTimeout}ms`
    );
    // Acknowledge and continue to next event
    acknowledge(event.id);
    lastProcessedId = event.id;
    continue;
  }
}

// Handler exists (either pre-registered or just registered)
try {
  await handler(event);
} catch (error) {
  console.error(`Animation handler error for event type '${event.type}':`, error);
}
```

### GameShell wiring (existing, no change needed)
```typescript
// Source: src/ui/components/GameShell.vue lines 168-172
const animationEvents = createAnimationEvents({
  events: () => state.value?.state?.animationEvents,
  acknowledge: () => {},
  // NEW: handlerWaitTimeout: 3000 (default, no need to specify)
});
provideAnimationEvents(animationEvents);
```

### Component handler registration (existing pattern, no change needed)
```typescript
// Source: pattern from useAnimationEvents.ts JSDoc
const animations = useAnimationEvents();
if (animations) {
  animations.registerHandler('combat', async (event) => {
    await playExplosionAnimation(event.data);
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side theatre with acknowledgment | Client-side pure data events | Phase 85-87 | No server round-trip for animations |
| Fire-and-forget (skip if no handler) | Wait-for-handler with timeout | Phase 88 (this phase) | Components can mount lazily and still catch events |
| `defaultDuration` for unhandled events | Configurable `handlerWaitTimeout` | Phase 88 (this phase) | Replaces `defaultDuration` semantically |

**Deprecated/outdated:**
- `defaultDuration` option: Still functional but semantically replaced by `handlerWaitTimeout`. Consider whether to keep both or remove `defaultDuration`. Recommendation: keep `defaultDuration` for now (it serves a different purpose -- artificial delay even when no handler is needed), but the "no handler" path should use `handlerWaitTimeout` instead.

## Key Data Flow Analysis

### Event Flow: Server to Client Queue
```
1. Game code: game.animate('combat', { damage: 5 })
2. Engine: Creates ANIMATE command on command stack
3. Engine: pushAnimationEvent() adds to _animationEvents buffer
4. Session: buildPlayerState() reads game.pendingAnimationEvents
5. Session: Includes animationEvents[] in PlayerGameState
6. Wire: StateUpdate sent to client via WebSocket
7. Client: useGame() receives state update, stores in state ref
8. Client: GameShell passes () => state.value?.state?.animationEvents to createAnimationEvents
9. Composable: Vue watch triggers, filters new events by ID, adds to internal queue
10. Composable: processQueue() dequeues events FIFO, calls handlers
```

### Existing Deduplication
The composable tracks `lastQueuedId` and `lastProcessedId`. When the watcher fires with new events, only events with `id > lastQueuedId` are enqueued. This prevents re-processing when Vue reactivity triggers multiple times for the same state update.

### Buffer Lifecycle
The engine clears `pendingAnimationEvents` at `performAction()` boundaries. Each action's events replace the previous action's events. The composable's deduplication (via monotonic IDs) handles this correctly -- stale events from a previous update are filtered out by ID comparison.

## Interface Changes

### Options (add `handlerWaitTimeout`, keep backward compatible)
```typescript
export interface UseAnimationEventsOptions {
  events: () => AnimationEvent[] | undefined;
  acknowledge: (upToId: number) => void;   // Keep for Phase 89 removal
  defaultDuration?: number;                 // Keep for backward compat
  handlerWaitTimeout?: number;              // NEW: default 3000ms
}
```

### Return Type (no changes needed)
```typescript
export interface UseAnimationEventsReturn {
  registerHandler: (eventType: string, handler: AnimationHandler) => () => void;
  isAnimating: Ref<boolean>;
  paused: Ref<boolean>;
  skipAll: () => void;
  pendingCount: Ref<number>;
}
```

All existing exports and types remain unchanged. The only new option is `handlerWaitTimeout`.

## Requirement-to-Code Mapping

| Requirement | Already Implemented? | What to Do |
|-------------|---------------------|------------|
| CLI-01: FIFO processing | YES - `queue.shift()` in loop | Verify existing behavior |
| CLI-02: Wait for handler | NO - currently skips immediately | Add wait mechanism in processQueue |
| CLI-03: Configurable timeout (default 3s) | NO | Add `handlerWaitTimeout` option |
| CLI-04: Timeout console warning | NO | Add `console.warn` with event type, ID |
| CLI-05: Skip on timeout | NO - currently skips without wait | Wire timeout to skip + continue |
| CLI-06: registerHandler API | YES - `handlers.set(eventType, handler)` | Verify existing behavior |
| CLI-07: Resume on handler register | NO | Add resolve logic in registerHandler |
| CLI-08: skipAll clears queue | YES - `queue.length = 0` | Extend to clear wait timer |
| CLI-09: Reactive state preserved | YES - `isAnimating`, `pendingCount` | Verify still works with new wait |

## Test Strategy

### Existing Tests to Preserve (all should continue passing)
- Handler registration and unregistration
- Sequential FIFO processing
- Handler errors don't break chain
- isAnimating state transitions
- skipAll clears queue and acknowledges
- Pause/resume behavior
- Event deduplication by ID
- Per-event acknowledgment

### New Tests Needed
1. **Wait-for-handler:** Event with no handler pauses queue, handler registration resumes
2. **Timeout:** Unhandled event times out after configured duration
3. **Timeout warning:** console.warn called with correct event type and ID
4. **Timeout skip:** After timeout, processing continues to next event
5. **Register during wait:** Handler registered while waiting resumes immediately
6. **skipAll during wait:** skipAll clears pending timeout and resumes queue
7. **Custom timeout:** Non-default timeout value works correctly
8. **Multiple unhandled types:** Different event types each get their own wait
9. **Handler registered before event:** No wait needed (existing behavior preserved)

## Open Questions

1. **Should `defaultDuration` and `handlerWaitTimeout` coexist?**
   - What we know: `defaultDuration` currently provides a delay even when no handler exists. `handlerWaitTimeout` waits for a handler to appear.
   - What's unclear: Are these ever used together? If `defaultDuration` > 0 and `handlerWaitTimeout` > 0, which takes precedence for unhandled events?
   - Recommendation: `handlerWaitTimeout` replaces the "no handler" behavior. If `handlerWaitTimeout` is set (or defaults to 3000ms), ignore `defaultDuration` for the "no handler" case. If `handlerWaitTimeout` is 0, use `defaultDuration` as fallback (backward compat). This keeps the old behavior working while making the new behavior the default.

2. **Should `isAnimating` be true during handler wait?**
   - What we know: Currently `isAnimating` is true during the entire processQueue loop. The wait-for-handler would keep isAnimating true while waiting.
   - What's unclear: Is this the right UX? The ActionPanel gates on isAnimating -- if we're waiting for a handler that never comes, the action panel is blocked for 3 seconds.
   - Recommendation: Yes, `isAnimating` should be true during the wait. The event IS being processed (waiting for its handler). The 3s timeout is the safety valve. This matches the ActionPanel's existing behavior of showing "Playing animations..." during the wait.

## Sources

### Primary (HIGH confidence)
- `src/ui/composables/useAnimationEvents.ts` -- current implementation (267 lines)
- `src/ui/composables/useAnimationEvents.test.ts` -- current tests (857 lines, 25+ test cases)
- `src/engine/element/game.ts` -- AnimationEvent interface and buffer management
- `src/engine/command/types.ts` -- AnimateCommand type
- `src/session/types.ts` -- PlayerGameState.animationEvents field
- `src/ui/components/GameShell.vue` -- createAnimationEvents wiring
- `src/ui/components/auto-ui/ActionPanel.vue` -- animation gating
- `.planning/REQUIREMENTS.md` -- CLI-01 through CLI-09 requirements

### Secondary (MEDIUM confidence)
- `src/session/utils.ts` -- buildPlayerState includes animation events
- `src/ui/composables/useActionController.ts` -- animationsPending computed
- `.planning/phases/87-session-simplification/87-01-SUMMARY.md` -- prior phase context

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure modification of existing composable
- Architecture: HIGH -- all patterns already established, code is read and understood
- Pitfalls: HIGH -- identified from reading actual implementation, not speculation
- Requirements mapping: HIGH -- traced every CLI requirement to specific code location

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (stable internal codebase, no external dependencies)
