/**
 * Animation Event Playback Composable
 *
 * Enables game UIs to register handlers for animation events and play them back
 * with Promise-based timing control. This is the UI-side consumer of the
 * animation event system established in Phases 59-60.
 *
 * Uses provide/inject for component tree access (following useBoardInteraction pattern).
 *
 * @example
 * ```typescript
 * // In GameShell setup (root component)
 * const animationEvents = createAnimationEvents({
 *   events: () => state.value?.animationEvents,
 *   acknowledge: (upToId) => session.acknowledgeAnimations(upToId),
 * });
 * provideAnimationEvents(animationEvents);
 *
 * // In child components
 * const animations = useAnimationEvents();
 * if (animations) {
 *   animations.registerHandler('combat', async (event) => {
 *     await playExplosionAnimation(event.data);
 *   });
 * }
 * ```
 */
import { ref, watch, type Ref, type InjectionKey, provide, inject } from 'vue';
import type { AnimationEvent } from '../../engine/index.js';

/**
 * Handler function for animation events.
 * Must return a Promise that resolves when the animation is complete.
 */
export interface AnimationHandler {
  (event: AnimationEvent): Promise<void>;
}

/**
 * Options for creating an animation events instance
 */
export interface UseAnimationEventsOptions {
  /** Getter that returns animation events from PlayerGameState */
  events: () => AnimationEvent[] | undefined;
  /** Callback to acknowledge events (calls session.acknowledgeAnimations) */
  acknowledge: (upToId: number) => void;
  /** Default delay for events without handlers (ms, default: 0) */
  defaultDuration?: number;
}

/**
 * Return type for the animation events composable
 */
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

/**
 * Injection key for animation events
 */
export const ANIMATION_EVENTS_KEY: InjectionKey<UseAnimationEventsReturn> = Symbol('animationEvents');

/**
 * Provide animation events to descendant components
 */
export function provideAnimationEvents(instance: UseAnimationEventsReturn): void {
  provide(ANIMATION_EVENTS_KEY, instance);
}

/**
 * Use animation events from an ancestor component
 */
export function useAnimationEvents(): UseAnimationEventsReturn | undefined {
  return inject(ANIMATION_EVENTS_KEY);
}

/**
 * Create an animation events instance.
 *
 * Call this in a root component (e.g., GameShell) and provide it to descendants.
 *
 * @param options Configuration options
 * @returns Animation events controller
 */
export function createAnimationEvents(options: UseAnimationEventsOptions): UseAnimationEventsReturn {
  const { events: getEvents, acknowledge, defaultDuration = 0 } = options;

  // Handler registry
  const handlers = new Map<string, AnimationHandler>();

  // Internal queue of events to process
  const queue: AnimationEvent[] = [];

  // Reactive state
  const isAnimating = ref(false);
  const paused = ref(false);
  const pendingCount = ref(0);

  // Track last processed ID to avoid re-processing
  let lastProcessedId = 0;

  // Track highest queued ID to avoid re-queueing during processing
  let lastQueuedId = 0;

  // Processing state
  let isProcessing = false;
  let skipRequested = false;

  // Pause/resume synchronization
  let unpauseResolve: (() => void) | null = null;

  /**
   * Wait for pause to be lifted
   */
  function waitForUnpause(): Promise<void> {
    return new Promise<void>((resolve) => {
      unpauseResolve = resolve;
    });
  }

  /**
   * Process the event queue sequentially
   */
  async function processQueue(): Promise<void> {
    // Guard against re-entry
    if (isProcessing) {
      return;
    }

    // Nothing to process
    if (queue.length === 0) {
      return;
    }

    isProcessing = true;
    isAnimating.value = true;
    skipRequested = false;

    let lastId = lastProcessedId;

    while (queue.length > 0 && !skipRequested) {
      // If paused, wait for resume
      if (paused.value) {
        await waitForUnpause();
        // Check skip again after resuming
        if (skipRequested) {
          break;
        }
      }

      const event = queue.shift()!;
      pendingCount.value = queue.length;

      const handler = handlers.get(event.type);

      if (handler) {
        try {
          await handler(event);
        } catch (error) {
          // Log error but continue processing - don't let one handler break the chain
          console.error(`Animation handler error for event type '${event.type}':`, error);
        }
      } else if (defaultDuration > 0) {
        // No handler, but default duration configured - wait
        await new Promise<void>((resolve) => setTimeout(resolve, defaultDuration));
      }
      // No handler and no default duration - skip immediately

      lastId = event.id;
      lastProcessedId = event.id;
    }

    // Acknowledge processed events (if any were processed)
    if (lastId > 0 && lastId !== lastProcessedId - 1) {
      // We processed at least one event
      acknowledge(lastId);
    } else if (lastId > 0) {
      // Edge case: we're at the end of processing
      acknowledge(lastId);
    }

    isProcessing = false;
    isAnimating.value = false;
  }

  /**
   * Skip all remaining animations
   */
  function skipAll(): void {
    // If we have queued events, acknowledge them all
    if (queue.length > 0) {
      const lastEvent = queue[queue.length - 1];
      acknowledge(lastEvent.id);
      lastProcessedId = lastEvent.id;
      lastQueuedId = lastEvent.id;
    }

    // Clear the queue
    queue.length = 0;
    pendingCount.value = 0;
    skipRequested = true;

    // If paused, resolve the unpause promise to exit the wait
    if (unpauseResolve) {
      unpauseResolve();
      unpauseResolve = null;
    }

    // Reset animating state immediately
    isAnimating.value = false;
  }

  /**
   * Register a handler for an event type
   */
  function registerHandler(eventType: string, handler: AnimationHandler): () => void {
    handlers.set(eventType, handler);
    return () => {
      handlers.delete(eventType);
    };
  }

  // Watch for pause state changes - resume when unpaused
  watch(paused, (newPaused) => {
    if (!newPaused && unpauseResolve) {
      unpauseResolve();
      unpauseResolve = null;
    }
  });

  // Watch for new events
  watch(
    getEvents,
    (events) => {
      if (!events || events.length === 0) {
        return;
      }

      // Filter to only new events (id > lastQueuedId)
      // Use lastQueuedId instead of lastProcessedId to avoid re-queueing during processing
      const newEvents = events.filter((e) => e.id > lastQueuedId);

      if (newEvents.length === 0) {
        return;
      }

      // Add to queue and update lastQueuedId
      queue.push(...newEvents);
      lastQueuedId = Math.max(lastQueuedId, ...newEvents.map((e) => e.id));
      pendingCount.value = queue.length;

      // Start processing (non-blocking)
      void processQueue();
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
