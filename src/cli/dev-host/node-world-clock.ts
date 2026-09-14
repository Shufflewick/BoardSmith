/**
 * THE SHIPPED CLOCK for the local world host (#197).
 *
 * A world's timers are its own units, not Node's: a season that ends in 180
 * days is an ordinary schedule, and `setTimeout` cannot hold it. Node stores a
 * delay in a 32-bit signed integer, so anything past 2,147,483,647 ms is
 * silently rewritten to 1 ms -- the host then wakes immediately, finds the
 * event still in the future, re-arms the same overflowing delay, and spins,
 * warning on stderr every millisecond.
 *
 * So a long wait is served as a CHAIN OF BOUNDED SLEEPS against one deadline.
 * The deadline is the truth; each native arm is only the next chunk of it, and
 * `fire` is called once, when the whole delay has actually elapsed.
 */
import type { WorldHostClock } from '../../world/host/index.js';

export type { WorldHostClock };

/** The largest delay Node's `setTimeout` can hold without overflowing. */
export const NATIVE_TIMER_MAX_MS = 2_147_483_647;

/**
 * `Date.now` plus one chained timer.
 *
 * One timer, replaced whole by every `arm`, because the host arms for the
 * earliest pending event and nothing else: a second live timer would be a
 * second opinion about when this world next wakes.
 */
export function createNodeWorldClock(): WorldHostClock {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const disarm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    now: () => Date.now(),
    // NODE'S OWN TURN. `setImmediate` runs after the current poll phase and
    // before any timer, which is what "let everything else go once" means in a
    // Node process; a `setTimeout(0)` would sit behind pending I/O instead.
    yieldTurn: () => new Promise<void>((resolve) => { setImmediate(resolve); }),
    arm(delayMs, fire) {
      disarm();
      if (delayMs === null) return;
      // THE DEADLINE, NOT THE DELAY, is what the chain preserves. Each wake
      // re-measures against the wall clock, so a laptop that slept through a
      // chunk does not add the time it was suspended to the wait.
      const deadline = Date.now() + Math.max(0, delayMs);
      const step = (): void => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          timer = null;
          fire();
          return;
        }
        timer = setTimeout(step, Math.min(remaining, NATIVE_TIMER_MAX_MS));
      };
      timer = setTimeout(step, Math.min(Math.max(0, delayMs), NATIVE_TIMER_MAX_MS));
    },
  };
}
