/**
 * The smoke walk's clock (#609): time counts only while the page and `boardsmith dev` answer, so a
 * machine too loaded to run them stretches every wait in the walk instead of failing it.
 *
 * Fake timers stand in for the machine: an answer that takes long is a page or host that was busy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anyWithinPageTime, ANSWER_TICK_MS, clocks, FROZEN_MS, lastErrorsLand, PageClock, PageTimeOverrun, withinPageTime } from './browser-smoke-clock.js';

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

describe('withinPageTime', () => {
  it('names the wait that ran past its page time, as the caller describes it (#670)', async () => {
    const { clock } = clockAnswering(() => 0);
    const page = {};
    clocks.set(page, clock);

    // A try that never settles, as a script Playwright runs in a held-up page does.
    const waiting = withinPageTime(page, 5_000, 'waiting for the seat switcher', () => new Promise<never>(() => undefined));
    const failed = expect(waiting).rejects.toThrow(
      new PageTimeOverrun('waiting for the seat switcher', 5_000).message,
    );
    await vi.advanceTimersByTimeAsync(6_000);

    await failed;
    clock.stop();
  });
});

describe('anyWithinPageTime (#926)', () => {
  const ranOutError = () => Object.assign(new Error('locator.waitFor: Timeout exceeded.'), { name: 'TimeoutError' });

  /** What `anyWithinPageTime` gives for `attempts` on a page that always answers, once 60s of (fake) time has passed. */
  async function outcome(...attempts: ((timeout: number) => Promise<unknown>)[]): Promise<boolean | Error> {
    const { clock } = clockAnswering(() => 0);
    const page = {};
    clocks.set(page, clock);
    const waiting = anyWithinPageTime(page, 5_000, 'waiting for a turn', attempts).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    clock.stop();
    return waiting;
  }

  /** A wait that runs out after its timeout, as a locator that never appears does. */
  const neverThere = (timeout: number) => new Promise<never>((_, fail) => setTimeout(() => fail(ranOutError()), timeout));

  it('is true once any wait is met', async () => {
    expect(await outcome(neverThere, () => Promise.resolve())).toBe(true);
  });

  it('is false when every wait ran out of page time', async () => {
    expect(await outcome(neverThere, neverThere)).toBe(false);
  });

  it('passes on any other error, as a frame detached under the wait, even when another wait ran out', async () => {
    const detached = new Error('locator.waitFor: Frame was detached');
    expect(await outcome(neverThere, () => Promise.reject(detached))).toBe(detached);
  });
});

describe('lastErrorsLand (#925)', () => {
  /** A page with its own clock, whose questions are answered after `answerMs` of (fake) time. */
  function pageAnswering(answerMs: number): { page: object; clock: PageClock } {
    const { clock } = clockAnswering(() => answerMs);
    const page = {};
    clocks.set(page, clock);
    return { page, clock };
  }

  /** Whether an error that reaches the page `atMs` after the last press has landed by the time `waiting` is done. */
  async function landsBefore(waiting: () => Promise<void>, atMs: number): Promise<boolean> {
    let landed = false;
    setTimeout(() => (landed = true), atMs);
    const seen = waiting().then(() => landed);
    await vi.advanceTimersByTimeAsync(5_000);
    return seen;
  }

  it('waits on the page clock, so an error a starved page shows 600 ms after the last press still lands', async () => {
    const starved = pageAnswering(300);

    expect(await landsBefore(() => lastErrorsLand([starved.page]), 600)).toBe(true);
    starved.clock.stop();
  });

  it("waits until every seat's browser has had the wait, so a starved second seat's late error still lands", async () => {
    const first = pageAnswering(0);
    const second = pageAnswering(300);

    expect(await landsBefore(() => lastErrorsLand([first.page, second.page]), 600)).toBe(true);
    first.clock.stop();
    second.clock.stop();
  });
});
