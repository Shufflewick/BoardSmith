/**
 * The smoke walk's clock (#609): time counts only while the page and `boardsmith dev` answer, so a
 * machine too loaded to run them stretches every wait in the walk instead of failing it.
 *
 * Fake timers stand in for the machine: an answer that takes long is a page or host that was busy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_TICK_MS, FROZEN_MS, PageClock } from './browser-smoke-clock.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A clock whose every question is answered after `answerMs()` of (fake) time. */
function clockAnswering(answerMs: () => number): { clock: PageClock; asked: () => number } {
  let asked = 0;
  const clock = new PageClock(() => {
    asked++;
    return new Promise<void>((done) => setTimeout(done, answerMs()));
  });
  clock.start();
  return { clock, asked: () => asked };
}

describe('PageClock', () => {
  it('counts all the time that passes while every question is answered at once', async () => {
    const { clock } = clockAnswering(() => 0);
    const since = clock.now();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(clock.now() - since).toBeGreaterThanOrEqual(30_000 - ANSWER_TICK_MS);
    expect(clock.now() - since).toBeLessThanOrEqual(30_000);
    clock.stop();
  });

  it('counts at most one tick and its slack for a question the page took 8s to answer, as a starved page does', async () => {
    let answer = 0;
    const { clock } = clockAnswering(() => answer);
    await vi.advanceTimersByTimeAsync(1_000);
    answer = 8_000;
    const since = clock.now();

    // One question asked after the next tick, answered 8s later.
    await vi.advanceTimersByTimeAsync(ANSWER_TICK_MS + 8_000);
    answer = 0;

    expect(clock.now() - since).toBeLessThanOrEqual(2 * ANSWER_TICK_MS);
    clock.stop();
  });

  it('says the page has stopped answering only once it has gone FROZEN_MS without answering', async () => {
    let answer = 0;
    const { clock } = clockAnswering(() => answer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clock.frozen()).toBe(false);
    answer = 10 * FROZEN_MS;

    await vi.advanceTimersByTimeAsync(FROZEN_MS / 2);
    expect(clock.frozen()).toBe(false);
    await vi.advanceTimersByTimeAsync(FROZEN_MS);

    expect(clock.frozen()).toBe(true);
    clock.stop();
  });

  it('counts a question the page refused as answered: a page that says no is still answering', async () => {
    const clock = new PageClock(() => Promise.reject(new Error('Execution context was destroyed')));
    clock.start();
    const since = clock.now();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(clock.now() - since).toBeGreaterThanOrEqual(10_000 - ANSWER_TICK_MS);
    expect(clock.frozen()).toBe(false);
    clock.stop();
  });

  it('asks nothing more once stopped', async () => {
    const { clock, asked } = clockAnswering(() => 0);
    await vi.advanceTimersByTimeAsync(1_000);
    clock.stop();
    const before = asked();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(asked()).toBe(before);
  });
});
