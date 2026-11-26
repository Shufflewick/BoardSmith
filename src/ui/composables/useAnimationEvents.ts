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
 * the event type and ID, the event is skipped, and the queue continues. A board
 * that registers no handlers at all (AutoUI) calls `claimNoEvents()`, and while it
 * holds that claim and no handler is registered, an unhandled event is skipped at
 * once, without a warning.
 *
 * @example
 * ```typescript
 * // In GameShell setup (root component)
 * const animationEvents = createAnimationEvents({
 *   events: () => state.value?.animationEvents,
 * });
 * provide(ANIMATION_EVENTS_KEY, animationEvents);
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
import { computed, ref, shallowRef, watch, onScopeDispose, type ComputedRef, type Ref, type InjectionKey, inject } from 'vue';
import type { AnimationEvent } from '../../engine/index.js';
import type { GameRootView } from '../types.js';

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

/** How a wait for a handler ended: the handler that registered, its timeout, or skipAll or a claim cutting it short. */
type WaitOutcome = AnimationHandler | 'timeout' | 'interrupted';

/**
 * The parts of a seat's frame the queue reads. A seat's `PlayerGameState` is one.
 */
export interface AnimationFrame {
  /** The events this frame carries. */
  animationEvents?: AnimationEvent[];
  /** The frame's view, which becomes `playingView` while each event that arrived with it plays. */
  view?: GameRootView;
  /**
   * The game, how many times its runner was restored, and the seat whose
   * numbers the ids are (UNDO-04, #489). Each seat numbers only the events it
   * may see, and a restore numbers them again, so a CHANGE in these starts a
   * new sequence: the queue resumes that timeline's watermark, or starts from
   * 0, so replayed beats are delivered instead of silently dropped. A frame
   * that does not name all three gives no signal, which is never a rewind.
   * It is not an action count: a count of every seat's actions would let a
   * seat count another seat's secret ones (#449).
   */
  gameInstanceId?: string;
  restoreEpoch?: number;
  viewerSeat?: number;
}

/**
 * Options for creating an animation events instance
 */
export interface UseAnimationEventsOptions {
  /** Getter for the seat's latest frame: one object, replaced whole when a frame lands. */
  frame: () => AnimationFrame | undefined;
  /**
   * Time to wait for a handler to register before skipping an unhandled event (ms, default: 3000).
   * Set to 0 to skip immediately (no wait).
   */
  handlerWaitTimeout?: number;
}

/**
 * The timeline a seat's frame names (see {@link AnimationFrame.gameInstanceId}):
 * this game, how many times its runner was restored, and the seat the frame
 * was built for. `undefined` (no signal) when any is missing, so a state that
 * does not name all three can never look like a rewind or a change of seat.
 */
export function animationTimeline(
  state: { gameInstanceId?: string; restoreEpoch?: number; viewerSeat?: number } | undefined,
): string | undefined {
  if (state?.gameInstanceId === undefined || state.restoreEpoch === undefined || state.viewerSeat === undefined) {
    return undefined;
  }
  return `${state.gameInstanceId}:${state.restoreEpoch}:${state.viewerSeat}`;
}

/**
 * Return type for the animation events composable
 */
export interface UseAnimationEventsReturn {
  /** Register a handler for an event type. Returns unregister function. */
  registerHandler: (eventType: string, handler: AnimationHandler, options: AnimationHandlerOptions) => () => void;
  /**
   * Declare that the mounted board handles no event types, so while no handler is
   * registered an event is skipped at once instead of waiting for one to mount. Returns the release function.
   */
  claimNoEvents: () => () => void;
  /** Whether animations are currently playing */
  isAnimating: Ref<boolean>;
  /** Whether playback is paused */
  paused: Ref<boolean>;
  /** Skip all remaining animations in the queue */
  skipAll: () => void;
  /** Number of pending events (for UI indicators) */
  pendingCount: Ref<number>;
  /**
   * The view of the frame the playing event arrived with, or undefined when
   * nothing plays. It is set before the event's handler is called and cleared
   * when the queue runs dry or is skipped.
   */
  playingView: Readonly<Ref<GameRootView | undefined>>;
}

/**
 * Injection key for animation events
 */
export const ANIMATION_EVENTS_KEY: InjectionKey<UseAnimationEventsReturn> = Symbol('animationEvents');

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
  const { frame: getFrame, handlerWaitTimeout = 3000 } = options;

  // Handler registry
  const handlers = new Map<string, { handler: AnimationHandler; skip: 'run' | 'drop' }>();

  // Internal queue of events to process, each with the view of the frame it arrived in
  const queue: Array<{ event: AnimationEvent; view: GameRootView | undefined }> = [];

  // Reactive state
  const isAnimating = ref(false);
  const paused = ref(false);
  const pendingCount = ref(0);
  const playingView = shallowRef<GameRootView>();

  // The watermark: the highest id queued in the current timeline, so an event
  // is queued once however many frames carry it. A timeline change resets it.
  let lastQueuedId = 0;

  // Last timeline a frame named (UNDO-04 rewind signal). `undefined` means "no
  // observation yet", so the first frame never spuriously looks like a change.
  let lastTimeline: string | undefined;

  // Processing state
  let isProcessing = false;
  let skipRequested = false;

  // Abort controller for the currently-running handler
  let currentHandlerAbort: AbortController | null = null;

  // Pause/resume synchronization
  let unpauseResolve: (() => void) | null = null;

  // Wait-for-handler synchronization
  let waitingForType: string | null = null;
  let waitResolve: ((outcome: WaitOutcome) => void) | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  const noEventClaims = new Set<symbol>();
  // The wait would otherwise fire and warn after the owning shell has unmounted (#749).
  onScopeDispose(() => {
    if (waitTimer !== null) clearTimeout(waitTimer);
  }, true);

  /**
   * Wait for pause to be lifted
   */
  function waitForUnpause(): Promise<void> {
    return new Promise<void>((resolve) => {
      unpauseResolve = resolve;
    });
  }

  /** A claim counts only while no board registers handlers on this queue, so one that does keeps its waits. */
  function claimedNone(): boolean {
    return noEventClaims.size > 0 && handlers.size === 0;
  }

  /**
   * Wait for a handler to register for the given event type, or timeout.
   * Resolves with the handler, 'timeout', or 'interrupted' (skipAll or a claim ended the wait).
   */
  function waitForHandler(type: string, timeout: number): Promise<WaitOutcome> {
    return new Promise((resolve) => {
      waitingForType = type;
      waitResolve = resolve;
      waitTimer = setTimeout(() => {
        if (waitingForType === type) {
          waitResolve = null;
          waitingForType = null;
          waitTimer = null;
          resolve('timeout');
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

      const { event, view } = queue.shift()!;
      pendingCount.value = queue.length;

      let handler = handlers.get(event.type)?.handler;
      let timedOut = false;
      if (!handler) playingView.value = undefined;
      while (!handler && handlerWaitTimeout > 0 && !claimedNone() && !skipRequested) {
        const outcome = await waitForHandler(event.type, handlerWaitTimeout);
        if (outcome === 'timeout') {
          timedOut = true;
          break;
        }
        // An interrupted wait looks again: a claim may have been released before the queue resumed.
        handler = outcome === 'interrupted' ? handlers.get(event.type)?.handler : outcome;
      }
      if (skipRequested) break;
      if (timedOut) {
        console.warn(
          `Animation event "${event.type}" (id: ${event.id}) skipped: no handler registered after ${handlerWaitTimeout}ms`
        );
        continue;
      }

      if (handler) {
        const abort = new AbortController();
        currentHandlerAbort = abort;
        playingView.value = view;
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
      // No handler and nothing to wait for (timeout 0, or the board claims no events) -- skip
    }

    isProcessing = false;
    playingView.value = undefined;
    isAnimating.value = false;
    // Events taken in while a skipped loop wound down found it still running, so they start here.
    if (queue.length > 0) void processQueue();
  }

  /**
   * Skip all remaining animations
   */
  function skipAll(): void {
    // Collect 'run' events from the queue before clearing
    const runOnSkipEvents: AnimationEvent[] = [];
    for (const { event } of queue) {
      const entry = handlers.get(event.type);
      if (entry?.skip === 'run') runOnSkipEvents.push(event);
    }

    // The watermark stays where it is: it already covers every event queued in
    // this timeline, and the queue may still hold events from an earlier one (a
    // seat the page no longer shows, #489), whose numbers mean nothing here.

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
    endWait('interrupted');

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
    playingView.value = undefined;
    isAnimating.value = false;
  }

  /** End the current wait for a handler, if any, handing the queue `outcome`. */
  function endWait(outcome: AnimationHandler | 'interrupted'): void {
    if (!waitResolve) return;
    const resolve = waitResolve;
    waitResolve = null;
    waitingForType = null;
    if (waitTimer !== null) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }
    resolve(outcome);
  }

  /**
   * Register a handler for an event type
   */
  function registerHandler(eventType: string, handler: AnimationHandler, handlerOptions: AnimationHandlerOptions): () => void {
    const entry = { handler, skip: handlerOptions.skip };
    handlers.set(eventType, entry);

    // If the queue is waiting for this type, resume processing immediately
    if (waitingForType === eventType) endWait(handler);

    return () => {
      // Another component may have replaced this handler since; leave theirs.
      if (handlers.get(eventType) === entry) handlers.delete(eventType);
    };
  }

  function claimNoEvents(): () => void {
    const claim = Symbol('no animation events');
    noEventClaims.add(claim);
    if (claimedNone()) endWait('interrupted');
    return () => {
      noEventClaims.delete(claim);
    };
  }

  // Watch for pause state changes - resume when unpaused
  watch(paused, (newPaused) => {
    if (!newPaused && unpauseResolve) {
      unpauseResolve();
      unpauseResolve = null;
    }
  });

  // One watcher takes in every frame as it lands ('sync'): a frame that a
  // later one replaced before Vue flushed still queues its events, each with
  // that frame's view. A change of timeline resumes that timeline's
  // watermark, or starts from 0, before the frame's events are filtered.
  const watermarks = new Map<string, number>();
  let lastEvents: AnimationEvent[] | undefined;
  const framesTakenIn = ref(0);
  watch(
    getFrame,
    (frame) => {
      const timeline = animationTimeline(frame);
      let moved = false;
      if (timeline !== undefined) {
        if (lastTimeline !== undefined && timeline !== lastTimeline) {
          watermarks.set(lastTimeline, lastQueuedId);
          lastQueuedId = watermarks.get(timeline) ?? 0;
          // The queued events' views belong to the old timeline, perhaps another seat's, so they play over the latest view.
          for (const entry of queue) entry.view = undefined;
          playingView.value = undefined;
          moved = true;
        }
        lastTimeline = timeline;
      }
      const events = frame?.animationEvents;
      // The shell keeps an unchanged events array, so a replay may be the very array already taken in.
      if (events === lastEvents && !moved) return;
      lastEvents = events;
      const newEvents = (events ?? []).filter((e) => e.id > lastQueuedId);
      if (newEvents.length === 0) return;
      queue.push(...newEvents.map((event) => ({ event, view: frame?.view })));
      lastQueuedId = Math.max(lastQueuedId, ...newEvents.map((e) => e.id));
      pendingCount.value = queue.length;
      framesTakenIn.value++;
    },
    { immediate: true, flush: 'sync' },
  );
  // Playback starts when Vue flushes, not inside the code that set the state.
  watch(framesTakenIn, () => void processQueue(), { immediate: true });

  return {
    registerHandler,
    claimNoEvents,
    isAnimating,
    paused,
    skipAll,
    pendingCount,
    playingView,
  };
}

/**
 * The view a table's board draws so each queued animation event plays over the
 * frame it arrived with, not a later one: the playing event's view, or
 * `gameView` when nothing plays, outside a shell, or while the debug panel
 * shows history. Pass the board's props.
 */
export function useAnimatedView(
  board: { gameView: GameRootView | null; isViewingHistory: boolean },
): ComputedRef<GameRootView | null> {
  const animations = useAnimationEvents();
  return computed(() => (board.isViewingHistory ? board.gameView : (animations?.playingView.value ?? board.gameView)));
}
