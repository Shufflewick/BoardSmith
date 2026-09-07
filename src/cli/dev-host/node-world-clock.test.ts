/**
 * #197: A LONG WAIT IS A WAIT, NOT A SPIN.
 *
 * Node rewrites any `setTimeout` delay past 2,147,483,647 ms to 1 ms, so a
 * world whose next event is a 180-day season end used to wake the host every
 * millisecond and warn on stderr every time. Every fact below is one sentence
 * of that ticket: no native arm may exceed the maximum, nothing fires before
 * its deadline, and a long wait can still be replaced or cancelled.
 *
 * Fake timers, because the point is what gets ARMED -- and the delays are
 * observed directly, since a fake timer has no 32-bit limit to trip over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNodeWorldClock, NATIVE_TIMER_MAX_MS } from './node-world-clock.js';

const DAY_MS = 86_400_000;
const SEASON_MS = 180 * DAY_MS;

describe('the local world host clock', () => {
  let armed: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    armed = [];
    const native = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: Parameters<typeof setTimeout>[0],
      delay?: number,
      ...rest: unknown[]
    ) => {
      armed.push(delay ?? 0);
      return (native as (...args: unknown[]) => unknown)(fn, delay, ...rest);
    }) as typeof setTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('arms a short delay once, exactly as asked', () => {
    const fire = vi.fn();
    createNodeWorldClock().arm(600_000, fire);
    expect(armed).toEqual([600_000]);
    vi.advanceTimersByTime(599_999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('arms the native maximum itself in one go', () => {
    const fire = vi.fn();
    createNodeWorldClock().arm(NATIVE_TIMER_MAX_MS, fire);
    expect(armed).toEqual([NATIVE_TIMER_MAX_MS]);
    vi.advanceTimersByTime(NATIVE_TIMER_MAX_MS);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('a 180-day season fires on its own deadline and never overflows a native timer', () => {
    const fire = vi.fn();
    createNodeWorldClock().arm(SEASON_MS, fire);

    // Wake through the whole season in one-day steps. Nothing may fire early,
    // and no single native arm may exceed what Node can hold.
    for (let elapsed = 0; elapsed < SEASON_MS; elapsed += DAY_MS) {
      vi.advanceTimersByTime(DAY_MS);
      expect(armed.every((delay) => delay <= NATIVE_TIMER_MAX_MS)).toBe(true);
      if (elapsed + DAY_MS < SEASON_MS) expect(fire).not.toHaveBeenCalled();
    }
    expect(fire).toHaveBeenCalledTimes(1);
    // A chain, not a flood: a 180-day wait costs a handful of arms.
    expect(armed.length).toBeLessThanOrEqual(10);
  });

  it('a long wait can be disarmed before it is due', () => {
    const fire = vi.fn();
    const clock = createNodeWorldClock();
    clock.arm(SEASON_MS, fire);
    vi.advanceTimersByTime(90 * DAY_MS);
    clock.arm(null, () => {});
    vi.advanceTimersByTime(SEASON_MS);
    expect(fire).not.toHaveBeenCalled();
  });

  it('a long wait is replaced whole by the next arm', () => {
    const season = vi.fn();
    const soon = vi.fn();
    const clock = createNodeWorldClock();
    clock.arm(SEASON_MS, season);
    vi.advanceTimersByTime(30 * DAY_MS);
    clock.arm(60_000, soon);
    vi.advanceTimersByTime(60_000);
    expect(soon).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SEASON_MS);
    expect(season).not.toHaveBeenCalled();
  });

  it('an overdue delay fires without waiting', () => {
    const fire = vi.fn();
    createNodeWorldClock().arm(-5_000, fire);
    expect(armed).toEqual([0]);
    vi.advanceTimersByTime(0);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
