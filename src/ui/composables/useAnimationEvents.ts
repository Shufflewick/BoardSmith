/**
 * Animation Event Playback Composable
 *
 * Enables game UIs to register handlers for animation events and play them back
 * with Promise-based timing control. This is the UI-side consumer of the
 * animation event system established in Phases 59-60.
 *
 * Uses provide/inject for component tree access (following useBoardInteraction pattern).
 *
 * When the queue encounters an event type with no registered handler, it pauses
 * (up to a configurable timeout, default 3s) to allow lazily-mounted components
 * to register their handlers. If a handler registers during the wait, processing
 * resumes immediately. If the timeout expires, a console warning is logged with
 * the event type and ID, the event is skipped, and the queue continues.
 *
 * @example
 * ```typescript
 * // In GameShell setup (root component)
 * const animationEvents = createAnimationEvents({
 *   events: () => state.value?.animationEvents,
 * });
 * provideAnimationEvents(animationEvents);
 *
 * // In child components
 * const animations = useAnimationEvents();
 * if (animations) {
 *   animations.registerHandler('combat', async (event, { signal }) => {
 *     await playExplosionAnimation(event.data);
 *     if (signal.aborted) return; // skip was pressed
 *     await playAftermath(event.data);
 *   }, { skip: 'drop' });
 * }
 * ```
 */
import { ref, watch, type Ref, type InjectionKey, provide, inject } from 'vue';
import type { AnimationEvent } from '../../engine/index.js';

/**
 * Context passed to animation handlers as the second argument.
 */
export interface AnimationHandlerContext {
  /** AbortSignal that fires when skipAll() is called during this handler's execution. */
  signal: AbortSignal;
}

/**
 * Handler function for animation events.
 * Must return a Promise that resolves when the animation is complete.
 * The optional second argument provides a signal for cooperative skip support.
 */
export interface AnimationHandler {
  (event: AnimationEvent, context: AnimationHandlerContext): Promise<void>;
}

/**
 * Options for registering an animation handler.
 *
 * Every handler must declare its skip behavior — there is no default.
 * This forces developers to consider what happens when a user skips animations.
 */
export interface AnimationHandlerOptions {
  /**
   * What happens to this handler when skipAll() is called:
   * - `'run'`: Handler is called with a pre-aborted signal (skips delays, runs cleanup/sync logic).
   * - `'drop'`: Handler is not called — the event is silently discarded.
   */
  skip: 'run' | 'drop';
}

/**
 * Options for creating an animation events instance
 */
export interface UseAnimationEventsOptions {
  /** Getter that returns animation events from PlayerGameState */
  events: () => AnimationEvent[] | undefined;
  /** Default delay for events without handlers (ms, default: 0) */
  defaultDuration?: number;
  /**
   * Time to wait for a handler to register before skipping an unhandled event (ms, default: 3000).
   * Set to 0 to skip immediately (no wait).
   */
  handlerWaitTimeout?: number;
}

/**
 * Return type for the animation events composable
 */
export interface UseAnimationEventsReturn {
  /** Register a handler for an event type. Returns unregister function. */
  registerHandler: (eventType: string, handler: AnimationHandler, options: AnimationHandlerOptions) => () => void;
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
 * Use animation events from an ancestor component.
 * Returns undefined if not provided (no warning logged).
 */
export function useAnimationEvents(): UseAnimationEventsReturn | undefined {
  // Pass undefined as default to suppress Vue's "injection not found" warning
  // Animation events are optional - components handle undefined gracefully
  return inject(ANIMATION_EVENTS_KEY, undefined);
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
  const { events: getEvents, defaultDuration = 0, handlerWaitTimeout = 3000 } = options;

  // Handler registry
  const handlers = new Map<string, { handler: AnimationHandler; skip: 'run' | 'drop' }>();

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

  // Abort controller for the currently-running handler
  let currentHandlerAbort: AbortController | null = null;

  // Pause/resume synchronization
  let unpauseResolve: (() => void) | null = null;

  // Wait-for-handler synchronization
  let waitingForType: string | null = null;
  let waitResolve: ((handler: AnimationHandler | null) => void) | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Wait for pause to be lifted
   */
  function waitForUnpause(): Promise<void> {
    return new Promise<void>((resolve) => {
      unpauseResolve = resolve;
    });
  }

  /**
   * Wait for a handler to register for the given event type, or timeout.
   * Returns the handler if one registers, or null if timeout expires.
   */
  function waitForHandler(type: string, timeout: number): Promise<AnimationHandler | null> {
    return new Promise((resolve) => {
      waitingForType = type;
      waitResolve = resolve;
      waitTimer = setTimeout(() => {
        if (waitingForType === type) {
          waitResolve = null;
          waitingForType = null;
          waitTimer = null;
          resolve(null); // timeout -- no handler arrived
        }
      }, timeout);
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

      let handler: AnimationHandler | null | undefined = handlers.get(event.type)?.handler;

      if (!handler && handlerWaitTimeout > 0) {
        // Wait for handler registration or timeout
        handler = await waitForHandler(event.type, handlerWaitTimeout);

        if (!handler) {
          // skipAll may have resolved the wait -- check before warning
          if (skipRequested) {
            break;
          }
          // Timeout expired -- warn and skip
          console.warn(
            `Animation event "${event.type}" (id: ${event.id}) skipped: no handler registered after ${handlerWaitTimeout}ms`
          );
          lastProcessedId = event.id;
          continue;
        }
      }

      if (handler) {
        const abort = new AbortController();
        currentHandlerAbort = abort;
        try {
          // Race handler against abort so skipAll() unblocks the queue immediately
          await Promise.race([
            handler(event, { signal: abort.signal }),
            new Promise<void>((resolve) => {
              if (abort.signal.aborted) { resolve(); return; }
              abort.signal.addEventListener('abort', () => resolve(), { once: true });
            }),
          ]);
        } catch (error) {
          // Suppress errors from aborted handlers
          if (!abort.signal.aborted) {
            // Log error but continue processing - don't let one handler break the chain
            console.error(`Animation handler error for event type '${event.type}':`, error);
          }
        }
        currentHandlerAbort = null;
      }
      // No handler and handlerWaitTimeout is 0 -- skip immediately (backward compat)

      lastProcessedId = event.id;
    }

    isProcessing = false;
    isAnimating.value = false;
  }

  /**
   * Skip all remaining animations
   */
  function skipAll(): void {
    // Collect 'run' events from the queue before clearing
    const runOnSkipEvents: AnimationEvent[] = [];
    for (const event of queue) {
      const entry = handlers.get(event.type);
      if (entry?.skip === 'run') runOnSkipEvents.push(event);
    }

    if (queue.length > 0) {
      const lastEvent = queue[queue.length - 1];
      lastProcessedId = lastEvent.id;
      lastQueuedId = lastEvent.id;
    }

    // Clear the queue
    queue.length = 0;
    pendingCount.value = 0;
    skipRequested = true;

    // Abort the currently-running handler so the queue unblocks immediately
    if (currentHandlerAbort) {
      currentHandlerAbort.abort();
      currentHandlerAbort = null;
    }

    // If paused, resolve the unpause promise to exit the wait
    if (unpauseResolve) {
      unpauseResolve();
      unpauseResolve = null;
    }

    // If waiting for a handler, cancel the wait
    if (waitResolve) {
      const resolve = waitResolve;
      waitResolve = null;
      waitingForType = null;
      if (waitTimer !== null) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }
      resolve(null); // unblock processQueue
    }

    // Execute 'run' handlers with pre-aborted signal (fire-and-forget)
    const abortedSignal = AbortSignal.abort();
    for (const event of runOnSkipEvents) {
      const entry = handlers.get(event.type);
      if (entry) {
        try {
          void entry.handler(event, { signal: abortedSignal }).catch((err) => {
            console.error(`Handler error during skipAll for '${event.type}':`, err);
          });
        } catch (error) {
          console.error(`Handler error during skipAll for '${event.type}':`, error);
        }
      }
    }

    // Reset animating state immediately
    isAnimating.value = false;
  }

  /**
   * Register a handler for an event type
   */
  function registerHandler(eventType: string, handler: AnimationHandler, options: AnimationHandlerOptions): () => void {
    handlers.set(eventType, { handler, skip: options.skip });

    // If the queue is waiting for this type, resume processing immediately
    if (waitingForType === eventType && waitResolve) {
      const resolve = waitResolve;
      waitResolve = null;
      waitingForType = null;
      if (waitTimer !== null) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }
      resolve(handler);
    }

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
