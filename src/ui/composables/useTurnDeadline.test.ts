/**
 * THE HOST'S DEADLINE, MEASURED ON THE HOST'S CLOCK (#301).
 *
 * A phone's clock is wrong by whatever it is wrong by, so a countdown drawn
 * from `deadlineAt - Date.now()` is wrong by the same amount. The host sends
 * `serverNow` beside `deadlineAt`, and the parent page stamps `receivedAt` when
 * the frame came off its socket; the difference is the offset between the two
 * clocks. The parent re-posts the SAME frame on iframe load and on
 * `request-state`, so the offset has to come from the frame's own stamps and
 * never from when the iframe happened to read it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import {
  readTurnDeadlineFrame,
  useTurnDeadline,
  type TurnDeadlineFrame,
} from './useTurnDeadline.js';

const PAGE_T0 = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(PAGE_T0);
});

afterEach(() => {
  vi.useRealTimers();
});

function track(frame: TurnDeadlineFrame | null) {
  const source = ref<TurnDeadlineFrame | null>(frame);
  const scope = effectScope();
  const deadline = scope.run(() => useTurnDeadline(source))!;
  return { source, scope, deadline };
}

describe('useTurnDeadline', () => {
  it('measures the remaining time on the host clock when the host runs 10 s ahead of the page', () => {
    // The host's clock read PAGE_T0 + 10 s at the moment the page's read PAGE_T0.
    const { deadline, scope } = track({
      deadlineAt: PAGE_T0 + 40_000,
      serverNow: PAGE_T0 + 10_000,
      receivedAt: PAGE_T0,
    });

    // Host now is PAGE_T0 + 10 s, so 30 s are left -- not the 40 s the page's
    // own clock would claim.
    expect(deadline.value).toEqual({ deadlineAt: PAGE_T0 + 40_000, remainingMs: 30_000 });

    vi.advanceTimersByTime(5_000);
    expect(deadline.value?.remainingMs).toBe(25_000);
    scope.stop();
  });

  it('gives a re-posted frame the same offset as the original, so a reload does not add time back', () => {
    const original: TurnDeadlineFrame = {
      deadlineAt: PAGE_T0 + 40_000,
      serverNow: PAGE_T0 + 10_000,
      receivedAt: PAGE_T0,
    };
    const { deadline, source, scope } = track(original);
    vi.advanceTimersByTime(20_000);
    const beforeRepost = deadline.value?.remainingMs;

    // The iframe reloads and the parent re-posts its cached frame, stamps and all.
    source.value = { ...original };
    expect(deadline.value?.remainingMs).toBe(beforeRepost);
    expect(deadline.value?.remainingMs).toBe(10_000);
    scope.stop();
  });

  it('floors the remaining time at zero once the deadline has passed', () => {
    const { deadline, scope } = track({
      deadlineAt: PAGE_T0 - 5_000,
      serverNow: PAGE_T0,
      receivedAt: PAGE_T0,
    });
    expect(deadline.value).toEqual({ deadlineAt: PAGE_T0 - 5_000, remainingMs: 0 });
    scope.stop();
  });

  it('is null when there is no deadline', () => {
    const { deadline, scope } = track(null);
    expect(deadline.value).toBeNull();
    scope.stop();
  });

  it('ticks every consumer from one shared interval, and stops it when none is counting', async () => {
    const frame: TurnDeadlineFrame = {
      deadlineAt: PAGE_T0 + 30_000,
      serverNow: PAGE_T0,
      receivedAt: PAGE_T0,
    };
    const a = track(frame);
    const b = track(frame);
    await nextTick();
    expect(vi.getTimerCount()).toBe(1);

    a.scope.stop();
    expect(vi.getTimerCount()).toBe(1);
    b.scope.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops ticking at zero, and starts again when the next window arrives', async () => {
    const { deadline, source, scope } = track({
      deadlineAt: PAGE_T0 + 2_000,
      serverNow: PAGE_T0,
      receivedAt: PAGE_T0,
    });
    await nextTick();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(3_000);
    await nextTick();
    expect(deadline.value?.remainingMs).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    source.value = { deadlineAt: Date.now() + 10_000, serverNow: Date.now(), receivedAt: Date.now() };
    await nextTick();
    expect(deadline.value?.remainingMs).toBe(10_000);
    expect(vi.getTimerCount()).toBe(1);
    scope.stop();
  });
});

describe('readTurnDeadlineFrame', () => {
  it('reads nothing from a frame that carries none of the fields (a host that predates them)', () => {
    expect(readTurnDeadlineFrame({ type: 'game_state' })).toEqual({ frame: null });
  });

  it('reads nothing when the host says there is no deadline', () => {
    expect(
      readTurnDeadlineFrame({ deadlineAt: null, serverNow: PAGE_T0, receivedAt: PAGE_T0 }),
    ).toEqual({ frame: null });
  });

  it('reads all three values when the host sends a deadline', () => {
    expect(
      readTurnDeadlineFrame({ deadlineAt: PAGE_T0 + 1, serverNow: PAGE_T0, receivedAt: PAGE_T0 - 3 }),
    ).toEqual({ frame: { deadlineAt: PAGE_T0 + 1, serverNow: PAGE_T0, receivedAt: PAGE_T0 - 3 } });
  });

  it('refuses a deadline without the stamps it is measured by, naming what is missing', () => {
    const result = readTurnDeadlineFrame({ deadlineAt: PAGE_T0, serverNow: PAGE_T0 });
    expect(result.frame).toBeNull();
    expect(result.error).toMatch(/receivedAt/);
    expect(result.error).toMatch(/parent page/);
  });

  it('refuses a deadline that is not a number', () => {
    const result = readTurnDeadlineFrame({ deadlineAt: '2026-09-23', serverNow: PAGE_T0, receivedAt: PAGE_T0 });
    expect(result.frame).toBeNull();
    expect(result.error).toMatch(/deadlineAt/);
  });
});
