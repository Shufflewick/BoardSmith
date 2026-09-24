/**
 * The host's deadline for the current step, counted down on the host's clock
 * (#301).
 *
 * A host that closes a step at a fixed time sends three numbers on every
 * platform `game_state` message, at the top level beside `winners`:
 *
 * - `deadlineAt`: epoch ms on the HOST's clock when the step closes, or `null`.
 * - `serverNow`: epoch ms on the host's clock when the host sent the frame.
 * - `receivedAt`: epoch ms on the PAGE's clock when the parent page took the
 *   frame off its socket. The parent stamps it there and forwards it unchanged,
 *   including when it re-posts a cached frame on iframe load or on
 *   `request-state`, because a stamp taken at re-post time would pair an old
 *   `serverNow` with a new page time and add the frame's age back on.
 *
 * `serverNow - receivedAt` is how far the host's clock is ahead of this page's,
 * so the countdown is right even when the phone's clock is not.
 *
 * `GameShell` reads the frame with {@link readTurnDeadlineFrame}, builds the one
 * countdown with {@link useTurnDeadline}, and publishes it as `turnDeadline` on
 * the game context, where the Action Panel and a custom UI both read it.
 *
 * @module
 */
import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue';

/** The three values a frame carries when the host has set a deadline. */
export interface TurnDeadlineFrame {
  /** Host clock, epoch ms, when the step closes. */
  deadlineAt: number;
  /** Host clock, epoch ms, when the frame was sent. */
  serverNow: number;
  /** Page clock, epoch ms, when the parent page received the frame. */
  receivedAt: number;
}

/** What a UI draws: when the step closes, and how long is left on the host clock. */
export interface TurnDeadline {
  /** Host clock, epoch ms, when the step closes. */
  deadlineAt: number;
  /** Time left before the host closes the step, floored at zero. */
  remainingMs: number;
}

/**
 * How often the shared clock re-reads the time. Four times a second keeps a
 * whole-second display from visibly skipping a number.
 */
const TICK_MS = 250;

/**
 * ONE interval for every countdown on the page. Each consumer holds it while
 * it has time left to count and lets go at zero or on dispose; the interval
 * runs only while someone holds it.
 */
const tick = ref(0);
let holders = 0;
let interval: ReturnType<typeof setInterval> | null = null;

function holdClock(): void {
  holders += 1;
  if (interval === null) {
    interval = setInterval(() => {
      tick.value += 1;
    }, TICK_MS);
  }
}

function releaseClock(): void {
  holders -= 1;
  if (holders === 0 && interval !== null) {
    clearInterval(interval);
    interval = null;
  }
}

const isEpochMs = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Read the deadline fields off a `game_state` message.
 *
 * `frame` is null when the message carries no `deadlineAt` (a host that does
 * not send deadlines) or `deadlineAt: null` (no deadline on this step).
 * `error` is set when a deadline arrives without the stamps it is measured by,
 * which is a host bug: counting it down on the page's own clock would draw a
 * countdown that is wrong by however wrong the phone's clock is.
 */
export function readTurnDeadlineFrame(
  data: Record<string, unknown>,
): { frame: TurnDeadlineFrame | null; error?: string } {
  const { deadlineAt, serverNow, receivedAt } = data;
  if (deadlineAt === undefined || deadlineAt === null) return { frame: null };

  const problems: string[] = [];
  if (!isEpochMs(deadlineAt)) problems.push('`deadlineAt` must be epoch milliseconds on the host clock, or null');
  if (!isEpochMs(serverNow)) problems.push('`serverNow` must be epoch milliseconds on the host clock when the frame was sent');
  if (!isEpochMs(receivedAt)) {
    problems.push('`receivedAt` must be epoch milliseconds on the parent page\'s clock, stamped when the frame came off the socket');
  }
  if (problems.length > 0) {
    return {
      frame: null,
      error:
        `The host sent a turn deadline this page cannot count down, so no countdown is shown: ${problems.join('; ')}. ` +
        'The host sends `deadlineAt` and `serverNow`; the parent page stamps `receivedAt` on receipt and forwards all three unchanged.',
    };
  }
  return { frame: { deadlineAt: deadlineAt as number, serverNow: serverNow as number, receivedAt: receivedAt as number } };
}

/**
 * Count down to the host's deadline from the latest frame.
 *
 * Null when there is no deadline. `remainingMs` is measured on the host's clock
 * using the frame's own stamps, floors at zero, and updates on the one shared
 * interval while there is time left.
 */
export function useTurnDeadline(frame: Ref<TurnDeadlineFrame | null>): ComputedRef<TurnDeadline | null> {
  const deadline = computed<TurnDeadline | null>(() => {
    void tick.value;
    const current = frame.value;
    if (current === null) return null;
    const hostNow = Date.now() + (current.serverNow - current.receivedAt);
    return { deadlineAt: current.deadlineAt, remainingMs: Math.max(0, current.deadlineAt - hostNow) };
  });

  let holding = false;
  const setHolding = (next: boolean): void => {
    if (next === holding) return;
    holding = next;
    if (next) holdClock();
    else releaseClock();
  };

  watch(
    () => deadline.value !== null && deadline.value.remainingMs > 0,
    setHolding,
    { immediate: true },
  );
  onScopeDispose(() => setHolding(false));

  return deadline;
}
