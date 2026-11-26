/**
 * Animation Event Playback Composable
 *
 * Plays a seat's animation events through the handlers its board registers,
 * one at a time, in order. The contract a board can rely on is written in
 * docs/ui-components.md § "The playback contract", and
 * useAnimationEvents.contract.test.ts checks it.
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
import { computed, getCurrentInstance, getCurrentScope, inject, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch, type EffectScope, type InjectionKey, type Ref } from 'vue';
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

/**
 * A registration or claim, bound to the effect scope that made it.
 * `life` changes the moment Vue mounts the scope's component or stops the scope;
 * the queue's handler map and claims follow it as inputs, in the order they come.
 */
interface Lease {
  scope: EffectScope;
  life: 'mounting' | 'mounted' | 'released';
  /** Put it in the handler map or the claims, as a step. */
  add: () => void;
  /** Take it out, as a step. */
  drop: () => void;
}

interface HandlerEntry extends Lease {
  type: string;
  handler: AnimationHandler;
  skip: 'run' | 'drop';
}

interface Waiting { kind: 'waiting'; event: AnimationEvent; timer: ReturnType<typeof setTimeout> }
interface Playing { kind: 'playing'; event: AnimationEvent; entry: HandlerEntry; abort: AbortController }

/** Where playback is. Only `waiting` holds a timer and only `playing` an abort controller, so neither outlives its state. */
type Playback = { kind: 'idle' } | Waiting | Playing | { kind: 'disposed' };

/**
 * Options for creating an animation events instance
 */
export interface UseAnimationEventsOptions {
  /** Getter for the seat's latest frame: one object, replaced whole when a frame lands. */
  frame: () => AnimationFrame | undefined;
  /**
   * Time to wait for a handler to register before skipping an unhandled event (ms, default: 3000).
   * Set to 0 to skip at once, with no wait and no warning.
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
   * effect scope): the handler counts once the update that mounts that component has finished,
   * is released when the scope it was made in stops (a component's unmount, for its setup), and
   * its signal aborts if it is playing then. The returned function releases it earlier, the same
   * way, taking effect in order with every other input.
   */
  registerHandler: (eventType: string, handler: AnimationHandler, options: AnimationHandlerOptions) => () => void;
  /**
   * Declare that the mounted board handles no event types, so while no handler is
   * registered an event is skipped at once instead of waiting for one to mount. Call it in a
   * component's setup: the claim counts once that component has mounted, and is released when it
   * unmounts, or earlier by the returned function, in order with every other input.
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
  const noEventClaims = new Set<Lease>();
  // Holds only the current timeline's events, each with the number of the frame that brought it:
  // a change of timeline stops playback first. One whose frame Vue has not drawn yet may not start.
  const queue: Array<{ event: AnimationEvent; frame: number }> = [];
  let framesDrawn = 0;
  let state: Playback = { kind: 'idle' };
  // Events Skip ended before they started, run one per step in the order Skip ended them.
  const skipped: AnimationEvent[] = [];

  // The one published snapshot: isAnimating and pendingCount can never disagree.
  const snapshot = shallowRef({ busy: false, pending: 0 });
  const isAnimating = computed(() => snapshot.value.busy);
  const pendingCount = computed(() => snapshot.value.pending);

  // The highest id queued in each timeline, kept for good, so an event is
  // queued once however many frames carry it, and a return to a seat replays nothing.
  const watermarks = new Map<string | undefined, number>();
  let timeline: string | undefined;

  // Every input (a frame, a registration, a claim, a release, Skip, a settle, the timer, the unmount) is a step in this inbox.
  const inbox: Array<() => void> = [];
  // What a step calls out to (a handler, an abort), run once the step's snapshot is published.
  const callOuts: Array<() => void> = [];
  let stepping = false;

  /** Run a step, publish its snapshot, then make its call-outs. One sent meanwhile (from a call-out or a watcher) runs after. */
  function send(step: () => void): void {
    inbox.push(step);
    if (stepping) return;
    stepping = true;
    try {
      for (let next = inbox.shift(); next; next = inbox.shift()) {
        if (state.kind === 'disposed') continue;
        next();
        publish();
        for (let callOut = callOuts.shift(); callOut; callOut = callOuts.shift()) callOut();
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

  function skip(): void {
    const ended = stop({ kind: 'idle' });
    if (ended.length === 0) return;
    if (skipped.length === 0) inbox.push(runSkipped);
    for (const event of ended) skipped.push(event);
  }

  function settle(playing: Playing): void {
    if (state === playing) becomeIdle();
  }

  function timeOut(waiting: Waiting): void {
    if (state !== waiting) return;
    console.warn(
      `Animation event "${waiting.event.type}" (id: ${waiting.event.id}) skipped: no handler registered after ${handlerWaitTimeout}ms`
    );
    becomeIdle();
  }

  /** A claim counts only while no board registers handlers on this queue, so one that does keeps its waits. */
  function claimedNone(): boolean {
    return noEventClaims.size > 0 && handlers.size === 0;
  }

  /** Start the next event once the caller is done: after the Vue flush under way, so every unmount and mount hook in it has run. */
  function scheduleAdvance(): void {
    void nextTick(() => send(advance));
  }

  function becomeIdle(): void {
    state = { kind: 'idle' };
    scheduleAdvance();
  }

  /** Settle the wait, then hand the next drawn event to its handler, wait for one to register, or skip it. */
  function advance(): void {
    // This runs after a flush, so what it mounted and unmounted counts before a wait ends or an event is handed out.
    takeMounted();
    if (state.kind !== 'idle') return;
    while (queue.length > 0 && queue[0].frame <= framesDrawn) {
      const { event } = queue.shift()!;
      const entry = handlers.get(event.type);
      if (entry) return play(event, entry);
      if (handlerWaitTimeout !== 0 && !claimedNone()) {
        const waiting: Waiting = { kind: 'waiting', event, timer: setTimeout(() => send(() => timeOut(waiting)), handlerWaitTimeout) };
        state = waiting;
        return;
      }
    }
  }

  function play(event: AnimationEvent, entry: HandlerEntry): void {
    const playing: Playing = { kind: 'playing', event, entry, abort: new AbortController() };
    state = playing;
    callOuts.push(() => {
      // A watcher of the snapshot may have unmounted the handler's component; its release ends this play.
      if (!callable(entry)) return;
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
        .then(() => send(() => settle(playing)));
    });
  }

  /** Abort `playing` once the step's snapshot is out, so a listener finds the queue already moved on. */
  function abortAfter(playing: Playing): void {
    callOuts.push(() => playing.abort.abort());
  }

  /** End playback in `next` and empty the queue, returning the events that never started: the waiting one first. */
  function stop(next: Playback): AnimationEvent[] {
    const now = state;
    const ended = queue.map((queued) => queued.event);
    if (now.kind === 'waiting') ended.unshift(now.event);
    queue.length = 0;
    if (now.kind === 'waiting') clearTimeout(now.timer);
    if (now.kind === 'playing') abortAfter(now);
    state = next;
    return ended;
  }

  /** Call the skip: 'run' handler of the first skipped event, chosen as it is called, then take the next in a step of its own. */
  function runSkipped(): void {
    const event = skipped.shift()!;
    if (skipped.length > 0) inbox.push(runSkipped);
    callOuts.push(() => {
      const entry = handlers.get(event.type);
      if (entry?.skip !== 'run' || !callable(entry)) return;
      const logError = (error: unknown) => console.error(`Handler error during skipAll for '${event.type}':`, error);
      try {
        void Promise.resolve(entry.handler(event, { signal: AbortSignal.abort() })).catch(logError);
      } catch (error) {
        logError(error);
      }
    });
  }

  /** After the handlers or claims change: hand the waiting event back to the queue if it has a handler now, or skip it if the board claims none. */
  function reconsiderWait(): void {
    if (state.kind !== 'waiting') return;
    const { event, timer } = state;
    // It waited, so its frame was drawn.
    if (handlers.has(event.type)) queue.unshift({ event, frame: 0 });
    else if (!claimedNone()) return;
    clearTimeout(timer);
    becomeIdle();
  }

  /** A released handler that is playing is aborted and the queue moves on. */
  function dropHandler(entry: HandlerEntry): void {
    if (handlers.get(entry.type) === entry) handlers.delete(entry.type);
    if (state.kind === 'playing' && state.entry === entry) {
      abortAfter(state);
      becomeIdle();
    }
  }

  /** Vue marks a scope stopped before it runs the scope's dispose callbacks, so one of them calling in finds the lease not yet released. */
  function callable(entry: HandlerEntry): boolean {
    return entry.life === 'mounted' && entry.scope.active;
  }

  // Leases a Vue update mounts, taken in as one input once that update has finished.
  const mountedThisFlush: Lease[] = [];

  function takeMounted(): void {
    take(mountedThisFlush.splice(0));
  }

  function take(leases: Lease[]): void {
    for (const lease of leases) {
      if (lease.life !== 'mounting') continue;
      lease.life = 'mounted';
      lease.add();
    }
    reconsiderWait();
  }

  /** Mark `lease` released, returning whether the queue had taken it in. */
  function retire(lease: Lease): boolean {
    const taken = lease.life === 'mounted';
    lease.life = 'released';
    return taken;
  }

  /** Take a retired lease out, as a step. Whether a wait ends waits for the flush, in case the same update mounts what takes the event. */
  function dropRetired(lease: Lease): void {
    lease.drop();
    scheduleAdvance();
  }

  /** The live scope a registration or claim belongs to: the queue releases it when that scope stops. */
  function callerScope(method: string): EffectScope {
    const scope = getCurrentScope();
    if (!scope) {
      throw new Error(
        `${method}() must be called from a component's setup (or inside an effectScope), so the queue can release it when that component unmounts.`,
      );
    }
    if (!scope.active) {
      throw new Error(
        `${method}() was called in an effect scope that has already stopped (for example after an await in the setup of a component that has since unmounted), so the queue could never release it. Call it before the first await in setup.`,
      );
    }
    return scope;
  }

  /**
   * Bind `lease` to its scope: it is taken in once the caller's component has mounted, with every
   * other component the same update mounts, and released the moment the scope stops.
   */
  function bindToCaller(lease: Lease): () => void {
    onScopeDispose(() => { if (retire(lease)) send(() => dropRetired(lease)); });
    const instance = getCurrentInstance();
    if (!instance || instance.isMounted) {
      send(() => take([lease]));
    } else {
      onMounted(() => {
        if (mountedThisFlush.push(lease) === 1) void nextTick(() => send(takeMounted));
      });
    }
    // An explicit release is one input: it takes effect after the current step, before any input sent after it.
    return () => send(() => { if (retire(lease)) dropRetired(lease); });
  }

  /** Follow the timeline the frame names: a change skips what the queue holds, and the first timeline named is no change. */
  function followTimeline(frame: AnimationFrame | undefined): void {
    const next = animationTimeline(frame);
    if (next === undefined || next === timeline) return;
    if (timeline === undefined) watermarks.set(next, watermarks.get(undefined) ?? 0);
    else skip();
    timeline = next;
  }

  /** Follow the frame's timeline, then queue its events above that timeline's watermark. */
  function takeFrame(frame: AnimationFrame | undefined, number: number): void {
    followTimeline(frame);
    const floor = watermarks.get(timeline) ?? 0;
    let watermark = floor;
    // One event at a time: a spread of a frame's events into a call overflows the stack on a large frame.
    for (const event of frame?.animationEvents ?? []) {
      if (event.id <= floor) continue;
      queue.push({ event, frame: number });
      watermark = Math.max(watermark, event.id);
    }
    watermarks.set(timeline, watermark);
  }

  function registerHandler(eventType: string, handler: AnimationHandler, handlerOptions: AnimationHandlerOptions): () => void {
    const entry: HandlerEntry = {
      scope: callerScope('registerHandler'), life: 'mounting', type: eventType, handler, skip: handlerOptions.skip,
      add: () => handlers.set(eventType, entry),
      drop: () => dropHandler(entry),
    };
    return bindToCaller(entry);
  }

  function claimNoEvents(): () => void {
    const claim: Lease = { scope: callerScope('claimNoEvents'), life: 'mounting', add: () => noEventClaims.add(claim), drop: () => noEventClaims.delete(claim) };
    return bindToCaller(claim);
  }

  const framesLanded = ref(0);
  // Created first, so it sees the first frame land too. A 'pre' job runs in the flush that draws the
  // frames landed so far, or before it when a nested app's mount flushes Vue's queues early, so the
  // tick after it is always after that drawing.
  watch(framesLanded, (landed) => {
    void nextTick(() => send(() => {
      framesDrawn = Math.max(framesDrawn, landed);
      advance();
    }));
  }, { flush: 'pre' });
  // Every frame is taken in as it lands ('sync'), so a frame that a later one
  // replaced before Vue flushed still queues its events.
  watch(
    getFrame,
    (frame) => {
      const number = ++framesLanded.value;
      send(() => takeFrame(frame, number));
    },
    { immediate: true, flush: 'sync' },
  );

  // The wait would otherwise fire and warn after the owning shell has unmounted (#749).
  onScopeDispose(() => send(() => stop({ kind: 'disposed' })), true);

  return {
    registerHandler,
    claimNoEvents,
    isAnimating,
    skipAll: () => send(skip),
    pendingCount,
  };
}
