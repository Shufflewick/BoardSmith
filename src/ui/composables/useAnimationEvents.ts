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
 * const animationEvents = createAnimationEvents({ frame: () => state.value?.state });
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
import { computed, ref, shallowRef, watch, onScopeDispose, type Ref, type InjectionKey, inject } from 'vue';
import type { AnimationEvent } from '../../engine/index.js';

/**
 * Context passed to animation handlers as the second argument.
 */
export interface AnimationHandlerContext {
  /** AbortSignal that fires when playback stops during this handler: Skip, an undo, a restore, a change of seat or unmount. */
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
 * The parts of a seat's frame the queue reads. A seat's `PlayerGameState` is one.
 */
export interface AnimationFrame {
  /** The events this frame carries. */
  animationEvents?: AnimationEvent[];
  /**
   * The game, how many times its runner was restored, and the seat whose
   * numbers the ids are (UNDO-04, #489). Each seat numbers only the events it
   * may see, and a restore numbers them again, so a CHANGE in these starts a
   * new timeline: the queue skips what it still holds and takes in the new
   * timeline's events above the highest id it ever queued in that timeline,
   * so a return to a seat never replays what it played there. A frame that
   * does not name all three gives no signal, which is never a change.
   * It is not an action count: a count of every seat's actions would let a
   * seat count another seat's secret ones (#449).
   */
  gameInstanceId?: string;
  restoreEpoch?: number;
  viewerSeat?: number;
}

/**
 * Where playback is. Only `waiting` holds a timer and only `playing` an abort controller, so neither outlives its state.
 * `starting` is an event whose handler is not yet called, so a watcher of isAnimating that skips it skips a queued event.
 */
type Playback =
  | { kind: 'idle' }
  | { kind: 'starting'; event: AnimationEvent }
  | { kind: 'waiting'; event: AnimationEvent; timer: ReturnType<typeof setTimeout> }
  | { kind: 'playing'; event: AnimationEvent; abort: AbortController }
  | { kind: 'disposed' };

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
function animationTimeline(state: AnimationFrame | undefined): string | undefined {
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
  /** Whether an event is playing or waiting for its handler */
  isAnimating: Readonly<Ref<boolean>>;
  /** Skip all remaining animations in the queue */
  skipAll: () => void;
  /** Number of pending events (for UI indicators) */
  pendingCount: Readonly<Ref<number>>;
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

  const handlers = new Map<string, { handler: AnimationHandler; skip: 'run' | 'drop' }>();
  const noEventClaims = new Set<symbol>();
  // Holds only the current timeline's events: a change of timeline stops playback first.
  const queue: AnimationEvent[] = [];
  const pendingCount = ref(0);
  const state = shallowRef<Playback>({ kind: 'idle' });
  const isAnimating = computed(() => state.value.kind !== 'idle' && state.value.kind !== 'disposed');

  // The highest id queued in each timeline, kept for good, so an event is
  // queued once however many frames carry it, and a return to a seat replays nothing.
  const watermarks = new Map<string | undefined, number>();
  let timeline: string | undefined;

  /** A claim counts only while no board registers handlers on this queue, so one that does keeps its waits. */
  function claimedNone(): boolean {
    return noEventClaims.size > 0 && handlers.size === 0;
  }

  /** The wait for a handler to register, or none when the event is skipped at once. */
  function waitFor(event: AnimationEvent): Playback | undefined {
    if (handlerWaitTimeout === 0 || claimedNone()) return undefined;
    return { kind: 'waiting', event, timer: setTimeout(timeOut, handlerWaitTimeout) };
  }

  /**
   * Start the next event while idle: hand it to its handler, wait for one to register, or skip it.
   * Every state change is published before any game code runs, and the state is checked again after.
   */
  function pump(): void {
    let idle = state.value;
    // A Stop or a frame landing from that code replaces the state; the frame's own pump then starts its events, after Vue draws it.
    while (idle.kind === 'idle' && state.value === idle && queue.length > 0) {
      const event = queue.shift()!;
      const next: Playback = handlers.has(event.type) ? { kind: 'starting', event } : (waitFor(event) ?? idle);
      state.value = next;
      pendingCount.value = queue.length;
      if (state.value !== next) return;
      if (next.kind === 'starting') idle = play(event);
    }
  }

  /** Call the event's handler, returning the state that leaves: playing, or the wait or skip when the handler unregistered as the event started. */
  function play(event: AnimationEvent): Playback {
    const entry = handlers.get(event.type);
    if (!entry) {
      const next = waitFor(event) ?? { kind: 'idle' };
      state.value = next;
      return next;
    }
    const abort = new AbortController();
    const playing: Playback = { kind: 'playing', event, abort };
    state.value = playing;
    let settled: Promise<void>;
    try {
      // A handler written in JavaScript may return no promise.
      settled = Promise.resolve(entry.handler(event, { signal: abort.signal }));
    } catch (error) {
      settled = Promise.reject(error);
    }
    void settled
      .catch((error: unknown) => {
        // A skipped handler's error is noise; any other is logged and the queue goes on, so one handler cannot break the chain.
        if (!abort.signal.aborted) console.error(`Animation handler error for event type '${event.type}':`, error);
      })
      .then(() => {
        const now = state.value;
        if (now.kind === 'playing' && now.abort === abort) {
          state.value = { kind: 'idle' };
          pump();
        }
      });
    return playing;
  }

  function timeOut(): void {
    const now = state.value;
    if (now.kind !== 'waiting') return;
    console.warn(
      `Animation event "${now.event.type}" (id: ${now.event.id}) skipped: no handler registered after ${handlerWaitTimeout}ms`
    );
    state.value = { kind: 'idle' };
    pump();
  }

  /** Hand the waiting event to its handler, if one is still registered. */
  function resume(): void {
    const now = state.value;
    if (now.kind !== 'waiting' || !handlers.has(now.event.type)) return;
    clearTimeout(now.timer);
    queue.unshift(now.event);
    state.value = { kind: 'idle' };
    pump();
  }

  /** Skip the waiting event when the board claims no events. */
  function skipUnclaimedWait(): void {
    const now = state.value;
    if (now.kind !== 'waiting' || !claimedNone()) return;
    clearTimeout(now.timer);
    state.value = { kind: 'idle' };
    pump();
  }

  /**
   * End playback in `next` and empty the queue, returning the events that never started: the waiting or starting one first.
   * The abort comes last, so a listener that calls back in finds the queue already stopped.
   */
  function stop(next: Playback): AnimationEvent[] {
    const now = state.value;
    if (now.kind === 'disposed') return [];
    const skipped = now.kind === 'waiting' || now.kind === 'starting' ? [now.event, ...queue] : [...queue];
    queue.length = 0;
    pendingCount.value = 0;
    if (now.kind === 'waiting') clearTimeout(now.timer);
    state.value = next;
    if (now.kind === 'playing') now.abort.abort();
    return skipped;
  }

  /** Stop, then call the skip: 'run' handler of each event that never started, with its signal already aborted. */
  function skipAll(): void {
    const aborted = AbortSignal.abort();
    for (const event of stop({ kind: 'idle' })) {
      if (state.value.kind === 'disposed') return;
      const entry = handlers.get(event.type);
      if (entry?.skip !== 'run') continue;
      try {
        void Promise.resolve(entry.handler(event, { signal: aborted })).catch((error: unknown) => {
          console.error(`Handler error during skipAll for '${event.type}':`, error);
        });
      } catch (error) {
        console.error(`Handler error during skipAll for '${event.type}':`, error);
      }
    }
  }

  function registerHandler(eventType: string, handler: AnimationHandler, handlerOptions: AnimationHandlerOptions): () => void {
    const entry = { handler, skip: handlerOptions.skip };
    handlers.set(eventType, entry);
    // Not in this call stack: the registering board's setup has not finished.
    if (state.value.kind === 'waiting' && state.value.event.type === eventType) queueMicrotask(resume);
    return () => {
      // Another component may have replaced this handler since; leave theirs.
      if (handlers.get(eventType) !== entry) return;
      handlers.delete(eventType);
      if (state.value.kind === 'waiting') queueMicrotask(skipUnclaimedWait);
    };
  }

  function claimNoEvents(): () => void {
    const claim = Symbol('no animation events');
    noEventClaims.add(claim);
    // Not in this call stack either, so a claim released at once leaves the wait in place.
    if (state.value.kind === 'waiting') queueMicrotask(skipUnclaimedWait);
    return () => {
      noEventClaims.delete(claim);
    };
  }

  /** Follow the timeline the frame names. A change skips what the queue holds; the first one named is no change. */
  function followTimeline(frame: AnimationFrame | undefined): void {
    const next = animationTimeline(frame);
    if (next === undefined || next === timeline) return;
    if (timeline === undefined) watermarks.set(next, watermarks.get(undefined) ?? 0);
    else skipAll();
    timeline = next;
  }

  /** Queue the frame's events above its timeline's watermark. */
  function takeIn(frame: AnimationFrame | undefined): void {
    if (state.value.kind === 'disposed') return;
    const watermark = watermarks.get(timeline) ?? 0;
    const newEvents = (frame?.animationEvents ?? []).filter((e) => e.id > watermark);
    if (newEvents.length === 0) return;
    queue.push(...newEvents);
    watermarks.set(timeline, Math.max(watermark, ...newEvents.map((e) => e.id)));
    pendingCount.value = queue.length;
  }

  // Every frame is taken in as it lands ('sync'), so a frame that a later one
  // replaced before Vue flushed still queues its events.
  const framesLanded = ref(0);
  watch(
    getFrame,
    (frame) => {
      framesLanded.value++;
      followTimeline(frame);
      takeIn(frame);
    },
    { immediate: true, flush: 'sync' },
  );
  // Playback starts once Vue has drawn the frame and run its unmount and mount hooks, so a child it replaced has handed over its handlers.
  watch(framesLanded, () => queueMicrotask(pump), { immediate: true, flush: 'post' });

  // The wait would otherwise fire and warn after the owning shell has unmounted (#749).
  onScopeDispose(() => stop({ kind: 'disposed' }), true);

  return {
    registerHandler,
    claimNoEvents,
    isAnimating,
    skipAll,
    pendingCount,
  };
}
