import type { WorldHostClock } from '../../world/host/index.js';

/**
 * A WORLD CLOCK A TEST MOVES BY HAND. `arm` is recorded nowhere and never
 * fires: every drain a case runs is one it asked for, so nothing runs between
 * an assertion and the line that set it up.
 */
export function frozenClock(start: number): WorldHostClock & { set(to: number): void } {
  let now = start;
  return {
    now: () => now,
    arm: () => {},
    yieldTurn: () =>
      new Promise<void>((resolve) => {
        setImmediate(resolve);
      }),
    set(to) {
      now = to;
    },
  };
}
