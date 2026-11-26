/**
 * Animation Event Playback Composable
 *
 * Plays a seat's animation events through the handlers its board registers,
 * one at a time, in order. The contract a board can rely on is written in
 * docs/ui-components.md § "The playback contract", and the queue's random-walk
 * test asserts it:
 *
 * - Each event the seat may see is offered once, in order, one at a time.
 * - A handler is called only while the component that registered it is
 *   mounted, and only after the board has drawn the event's frame.
 * - From a frame landing until its last event ends, `isAnimating` is true.
 * - The signal aborts on Skip, undo, restore, seat change, shell unmount or the
 *   registering component's unmount, and the queue has already moved on.
 * - A skipped event that never started calls a `'run'` handler once with an
 *   aborted signal, and never calls a `'drop'` handler.
 * - With no handler, the queue waits `handlerWaitTimeout` (3s), warns and
 *   skips. A board that claimed none skips at once.
 * - A call into the queue from a handler, abort listener or watcher is allowed,
 *   and takes effect after the current step.
 *
 * @example
 * ```typescript
 * // In GameShell setup (root component)
 * const animationEvents = createAnimationEvents({ frame: () => state.value?.state });
 * provide(ANIMATION_EVENTS_KEY, animationEvents);
 *
 * // In a board's setup: the handler is released when the board unmounts.
 * useAnimationEvents()?.registerHandler('combat', async (event, { signal }) => {
 *   await playExplosionAnimation(event.data);
 *   if (signal.aborted) return; // skip was pressed
 *   await playAftermath(event.data);
 * }, { skip: 'drop' });
 * ```
 */
import { computed, getCurrentScope, nextTick, ref, shallowRef, watch, onScopeDispose, type Ref, type InjectionKey, inject } from 'vue';
import type { AnimationEvent } from '../../engine/index.js';

/**
 * Context passed to animation handlers as the second argument.
 */
export interface AnimationHandlerContext {
  /**
   * AbortSignal that fires when playback stops during this handler: Skip, an undo, a restore,
   * a change of seat, the shell's unmount or the unmount of the component that registered it.
   */
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

interface HandlerEntry {
  handler: AnimationHandler;
  skip: 'run' | 'drop';
}

interface Waiting { kind: 'waiting'; event: AnimationEvent; timer: ReturnType<typeof setTimeout> }
interface Playing { kind: 'playing'; event: AnimationEvent; entry: HandlerEntry; abort: AbortController }

/** Where playback is. Only `waiting` holds a timer and only `playing` an abort controller, so neither outlives its state. */
type Playback = { kind: 'idle' } | Waiting | Playing | { kind: 'disposed' };

/** Everything that can change the queue. Each runs to completion before the next, whoever sent it. */
type Input =
  | { kind: 'frame'; frame: AnimationFrame | undefined }
  | { kind: 'drawn' }
  | { kind: 'advance' }
  | { kind: 'register'; eventType: string; entry: HandlerEntry }
  | { kind: 'unregister'; eventType: string; entry: HandlerEntry }
  | { kind: 'claim'; claim: symbol }
  | { kind: 'release'; claim: symbol }
  | { kind: 'skip' }
  | { kind: 'runSkipped'; events: AnimationEvent[] }
  | { kind: 'settled'; playing: Playing }
  | { kind: 'timeout'; waiting: Waiting }
  | { kind: 'dispose' };

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
  /**
   * Register a handler for an event type. Call it in a component's setup (or inside an
   * effect scope): the handler is released when that component unmounts, and its signal
   * aborts if it is playing then. The returned function releases it earlier.
   */
  registerHandler: (eventType: string, handler: AnimationHandler, options: AnimationHandlerOptions) => () => void;
  /**
   * Declare that the mounted board handles no event types, so while no handler is
   * registered an event is skipped at once instead of waiting for one to mount. Call it in a
   * component's setup: the claim is released when that component unmounts, or earlier by the returned function.
   */
  claimNoEvents: () => () => void;
  /** Whether an event is playing, waiting for its handler or queued: true from a frame landing until its last event ends. */
  isAnimating: Readonly<Ref<boolean>>;
  /** Skip all remaining animations in the queue */
  skipAll: () => void;
  /** Number of events queued behind the one playing or waiting (for UI indicators) */
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

/** Release `release` when the caller's component unmounts, refusing a caller with no component to bind it to. */
function bindToCaller(method: string, release: () => void): () => void {
  if (!getCurrentScope()) {
    throw new Error(
      `${method}() must be called from a component's setup (or inside an effectScope), so the queue can release it when that component unmounts.`,
    );
  }
  onScopeDispose(release);
  return release;
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

  const handlers = new Map<string, HandlerEntry>();
  const noEventClaims = new Set<symbol>();
  // Holds only the current timeline's events: a change of timeline stops playback first.
  // The last `undrawn` of them came in frames Vue has not drawn yet, so none of them may start.
  const queue: AnimationEvent[] = [];
  let undrawn = 0;
  let state: Playback = { kind: 'idle' };

  // The one published snapshot: isAnimating and pendingCount can never disagree.
  const snapshot = shallowRef({ busy: false, pending: 0 });
  const isAnimating = computed(() => snapshot.value.busy);
  const pendingCount = computed(() => snapshot.value.pending);

  // The highest id queued in each timeline, kept for good, so an event is
  // queued once however many frames carry it, and a return to a seat replays nothing.
  const watermarks = new Map<string | undefined, number>();
  let timeline: string | undefined;

  const inbox: Input[] = [];
  let stepping = false;

  /** Take an input in. One sent while a step runs (from a handler, a listener or a watcher) runs after that step. */
  function send(input: Input): void {
    inbox.push(input);
    if (stepping) return;
    stepping = true;
    try {
      for (let next = inbox.shift(); next; next = inbox.shift()) {
        step(next);
        publish();
      }
    } finally {
      stepping = false;
    }
  }

  function publish(): void {
    const pending = queue.length;
    const busy = pending > 0 || state.kind === 'waiting' || state.kind === 'playing';
    if (busy !== snapshot.value.busy || pending !== snapshot.value.pending) snapshot.value = { busy, pending };
  }

  function step(input: Input): void {
    if (state.kind === 'disposed') return;
    switch (input.kind) {
      case 'frame': return takeFrame(input.frame);
      case 'drawn':
        // Vue has drawn every frame taken in, and a component it unmounted has already let go of its handlers.
        undrawn = 0;
        return advance();
      case 'advance': return advance();
      case 'register': return register(input.eventType, input.entry);
      case 'unregister': return unregister(input.eventType, input.entry);
      case 'claim':
        noEventClaims.add(input.claim);
        return skipUnclaimedWait();
      case 'release':
        noEventClaims.delete(input.claim);
        return;
      case 'skip': {
        const skipped = stop({ kind: 'idle' });
        if (skipped.length > 0) inbox.push({ kind: 'runSkipped', events: skipped });
        return;
      }
      case 'runSkipped': return runSkipped(input.events);
      case 'settled':
        if (state === input.playing) becomeIdle();
        return;
      case 'timeout':
        if (state !== input.waiting) return;
        console.warn(
          `Animation event "${input.waiting.event.type}" (id: ${input.waiting.event.id}) skipped: no handler registered after ${handlerWaitTimeout}ms`
        );
        return becomeIdle();
      case 'dispose':
        stop({ kind: 'disposed' });
        return;
    }
  }

  /** A claim counts only while no board registers handlers on this queue, so one that does keeps its waits. */
  function claimedNone(): boolean {
    return noEventClaims.size > 0 && handlers.size === 0;
  }

  /** Start the next event once the caller is done: after the Vue flush under way, so a component mounting in it has mounted. */
  function scheduleAdvance(): void {
    void nextTick(() => send({ kind: 'advance' }));
  }

  function becomeIdle(): void {
    state = { kind: 'idle' };
    scheduleAdvance();
  }

  /** Hand the next drawn event to its handler, wait for one to register, or skip it. */
  function advance(): void {
    if (state.kind !== 'idle') return;
    while (queue.length > undrawn) {
      const event = queue.shift()!;
      const entry = handlers.get(event.type);
      if (entry) return play(event, entry);
      if (handlerWaitTimeout !== 0 && !claimedNone()) {
        const waiting: Waiting = { kind: 'waiting', event, timer: setTimeout(() => send({ kind: 'timeout', waiting }), handlerWaitTimeout) };
        state = waiting;
        return;
      }
    }
  }

  function play(event: AnimationEvent, entry: HandlerEntry): void {
    const playing: Playing = { kind: 'playing', event, entry, abort: new AbortController() };
    state = playing;
    publish();
    const { signal } = playing.abort;
    let settled: Promise<void>;
    try {
      // A handler written in JavaScript may return no promise.
      settled = Promise.resolve(entry.handler(event, { signal }));
    } catch (error) {
      settled = Promise.reject(error);
    }
    void settled
      .catch((error: unknown) => {
        // A skipped handler's error is noise; any other is logged and the queue goes on, so one handler cannot break the chain.
        if (!signal.aborted) console.error(`Animation handler error for event type '${event.type}':`, error);
      })
      .then(() => send({ kind: 'settled', playing }));
  }

  /**
   * End playback in `next` and empty the queue, returning the events that never started: the waiting one first.
   * The abort comes last, so a listener finds the queue already moved on.
   */
  function stop(next: Playback): AnimationEvent[] {
    const now = state;
    const skipped = now.kind === 'waiting' ? [now.event, ...queue] : [...queue];
    queue.length = 0;
    undrawn = 0;
    if (now.kind === 'waiting') clearTimeout(now.timer);
    state = next;
    publish();
    if (now.kind === 'playing') now.abort.abort();
    return skipped;
  }

  /** Call the skip: 'run' handler of the first skipped event, then queue the rest behind whatever that handler sent. */
  function runSkipped([event, ...rest]: AnimationEvent[]): void {
    const entry = handlers.get(event.type);
    if (entry?.skip === 'run') {
      const logError = (error: unknown) => console.error(`Handler error during skipAll for '${event.type}':`, error);
      try {
        void Promise.resolve(entry.handler(event, { signal: AbortSignal.abort() })).catch(logError);
      } catch (error) {
        logError(error);
      }
    }
    if (rest.length > 0) inbox.push({ kind: 'runSkipped', events: rest });
  }

  function register(eventType: string, entry: HandlerEntry): void {
    handlers.set(eventType, entry);
    if (state.kind !== 'waiting' || state.event.type !== eventType) return;
    clearTimeout(state.timer);
    queue.unshift(state.event);
    becomeIdle();
  }

  function unregister(eventType: string, entry: HandlerEntry): void {
    // Another component may have replaced this handler since; leave theirs.
    if (handlers.get(eventType) === entry) handlers.delete(eventType);
    if (state.kind === 'playing' && state.entry === entry) {
      const { abort } = state;
      becomeIdle();
      publish();
      abort.abort();
      return;
    }
    skipUnclaimedWait();
  }

  /** Skip the waiting event when the board claims no events. */
  function skipUnclaimedWait(): void {
    if (state.kind !== 'waiting' || !claimedNone()) return;
    clearTimeout(state.timer);
    becomeIdle();
  }

  /** Follow the timeline the frame names, then queue its events above that timeline's watermark. */
  function takeFrame(frame: AnimationFrame | undefined): void {
    const next = animationTimeline(frame);
    if (next !== undefined && next !== timeline) {
      // A change skips what the queue holds; the first timeline named is no change.
      if (timeline === undefined) watermarks.set(next, watermarks.get(undefined) ?? 0);
      else step({ kind: 'skip' });
      timeline = next;
    }
    const watermark = watermarks.get(timeline) ?? 0;
    const newEvents = (frame?.animationEvents ?? []).filter((e) => e.id > watermark);
    if (newEvents.length === 0) return;
    watermarks.set(timeline, Math.max(watermark, ...newEvents.map((e) => e.id)));
    // Skipped at once, so a board that plays none never gates the Action Panel for a render.
    if (claimedNone()) return;
    queue.push(...newEvents);
    undrawn += newEvents.length;
  }

  function registerHandler(eventType: string, handler: AnimationHandler, handlerOptions: AnimationHandlerOptions): () => void {
    const entry = { handler, skip: handlerOptions.skip };
    const release = bindToCaller('registerHandler', () => send({ kind: 'unregister', eventType, entry }));
    send({ kind: 'register', eventType, entry });
    return release;
  }

  function claimNoEvents(): () => void {
    const claim = Symbol('no animation events');
    const release = bindToCaller('claimNoEvents', () => send({ kind: 'release', claim }));
    send({ kind: 'claim', claim });
    return release;
  }

  // Created first, so the first frame's count change reaches it once Vue has drawn that frame too.
  const framesLanded = ref(0);
  watch(framesLanded, () => send({ kind: 'drawn' }), { flush: 'post' });
  // Every frame is taken in as it lands ('sync'), so a frame that a later one
  // replaced before Vue flushed still queues its events.
  watch(
    getFrame,
    (frame) => {
      framesLanded.value++;
      send({ kind: 'frame', frame });
    },
    { immediate: true, flush: 'sync' },
  );

  // The wait would otherwise fire and warn after the owning shell has unmounted (#749).
  onScopeDispose(() => send({ kind: 'dispose' }), true);

  return {
    registerHandler,
    claimNoEvents,
    isAnimating,
    skipAll: () => send({ kind: 'skip' }),
    pendingCount,
  };
}
