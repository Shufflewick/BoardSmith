/**
 * Tests for useAnimationEvents composable
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import {
  createAnimationEvents,
  provideAnimationEvents,
  useAnimationEvents,
  ANIMATION_EVENTS_KEY,
  type UseAnimationEventsReturn,
} from './useAnimationEvents.js';
import type { AnimationEvent } from '../../engine/index.js';

/**
 * Helper to create test events
 */
function createEvent(
  id: number,
  type: string,
  data: Record<string, unknown> = {}
): AnimationEvent {
  return { id, type, data, timestamp: Date.now() };
}

/**
 * Helper to wait for animations to complete
 */
async function waitForIdle(
  instance: UseAnimationEventsReturn,
  timeout = 1000
): Promise<void> {
  const start = Date.now();
  while (instance.isAnimating.value && Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (instance.isAnimating.value) {
    throw new Error('Animation did not complete within timeout');
  }
}

describe('useAnimationEvents', () => {
  describe('handler registration', () => {
    it('registers handler for event type', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        handled.push(event.id);
      });

      events.value = [createEvent(1, 'test')];
      await nextTick();
      await waitForIdle(instance);

      expect(handled).toEqual([1]);
    });

    it('returns unregister function that removes handler', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        handlerWaitTimeout: 0,
      });

      const unregister = instance.registerHandler('test', async (event) => {
        handled.push(event.id);
      });

      // First event should be handled
      events.value = [createEvent(1, 'test')];
      await nextTick();
      await waitForIdle(instance);
      expect(handled).toEqual([1]);

      // Unregister
      unregister();

      // Second event should NOT be handled (no handler)
      events.value = [...events.value, createEvent(2, 'test')];
      await nextTick();
      await waitForIdle(instance);
      expect(handled).toEqual([1]); // Still only 1
    });

    it('multiple handlers for different types work independently', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: Array<{ type: string; id: number }> = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('typeA', async (event) => {
        handled.push({ type: 'A', id: event.id });
      });

      instance.registerHandler('typeB', async (event) => {
        handled.push({ type: 'B', id: event.id });
      });

      events.value = [
        createEvent(1, 'typeA'),
        createEvent(2, 'typeB'),
        createEvent(3, 'typeA'),
      ];
      await nextTick();
      await waitForIdle(instance);

      expect(handled).toEqual([
        { type: 'A', id: 1 },
        { type: 'B', id: 2 },
        { type: 'A', id: 3 },
      ]);
    });
  });

  describe('sequential processing', () => {
    it('processes events in order', async () => {
      const events = ref<AnimationEvent[]>([]);
      const order: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(event.id);
      });

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
        createEvent(3, 'test'),
      ];
      await nextTick();
      await waitForIdle(instance);

      expect(order).toEqual([1, 2, 3]);
    });

    it('waits for handler Promise before next event', async () => {
      const events = ref<AnimationEvent[]>([]);
      const timeline: Array<{ event: string; id: number }> = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        timeline.push({ event: 'start', id: event.id });
        await new Promise((r) => setTimeout(r, 30));
        timeline.push({ event: 'end', id: event.id });
      });

      events.value = [createEvent(1, 'test'), createEvent(2, 'test')];
      await nextTick();
      await waitForIdle(instance);

      // Should be: start 1, end 1, start 2, end 2 (not interleaved)
      expect(timeline).toEqual([
        { event: 'start', id: 1 },
        { event: 'end', id: 1 },
        { event: 'start', id: 2 },
        { event: 'end', id: 2 },
      ]);
    });

    it('handler errors do not stop subsequent events', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        if (event.id === 2) {
          throw new Error('Handler error');
        }
        handled.push(event.id);
      });

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'), // This will throw
        createEvent(3, 'test'),
      ];
      await nextTick();
      await waitForIdle(instance);

      // Event 1 and 3 should still be handled
      expect(handled).toEqual([1, 3]);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    it('events without handlers are skipped when handlerWaitTimeout is 0', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        handlerWaitTimeout: 0,
      });

      instance.registerHandler('handled', async (event) => {
        handled.push(event.id);
      });

      events.value = [
        createEvent(1, 'unhandled'), // Should skip immediately
        createEvent(2, 'handled'),
        createEvent(3, 'unhandled'), // Should skip immediately
      ];
      await nextTick();
      await waitForIdle(instance);

      // Only handled event should be processed
      expect(handled).toEqual([2]);
    });
  });

  describe('isAnimating state', () => {
    it('is false when no events', () => {
      const events = ref<AnimationEvent[]>([]);

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      expect(instance.isAnimating.value).toBe(false);
    });

    it('is true during processing', async () => {
      const events = ref<AnimationEvent[]>([]);
      let wasAnimatingDuringHandler = false;

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async () => {
        wasAnimatingDuringHandler = instance.isAnimating.value;
        await new Promise((r) => setTimeout(r, 20));
      });

      events.value = [createEvent(1, 'test')];
      await nextTick();

      // Check during processing
      expect(instance.isAnimating.value).toBe(true);

      await waitForIdle(instance);

      expect(wasAnimatingDuringHandler).toBe(true);
    });

    it('is false after all events processed', async () => {
      const events = ref<AnimationEvent[]>([]);

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      events.value = [createEvent(1, 'test')];
      await nextTick();
      await waitForIdle(instance);

      expect(instance.isAnimating.value).toBe(false);
    });
  });

  describe('skipAll', () => {
    it('clears pending events', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        handled.push(event.id);
        if (event.id === 1) {
          // Skip during first handler
          instance.skipAll();
        }
        await new Promise((r) => setTimeout(r, 20));
      });

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
        createEvent(3, 'test'),
      ];
      await nextTick();
      await waitForIdle(instance);

      // Only first event should be handled, rest skipped
      expect(handled).toEqual([1]);
      expect(instance.pendingCount.value).toBe(0);
    });

    it('stops processing immediately', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handlerStarts: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        handlerStarts.push(event.id);
        if (event.id === 1) {
          instance.skipAll();
        }
        await new Promise((r) => setTimeout(r, 10));
      });

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
      ];
      await nextTick();
      await waitForIdle(instance);

      // Only event 1 should have started
      expect(handlerStarts).toEqual([1]);
    });

    it('works when paused (resumes and clears)', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        handled.push(event.id);
        if (event.id === 1) {
          // Pause after first handler
          instance.paused.value = true;
        }
        await new Promise((r) => setTimeout(r, 10));
      });

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
        createEvent(3, 'test'),
      ];
      await nextTick();

      // Wait for first event to be processed and paused
      await new Promise((r) => setTimeout(r, 50));
      expect(instance.paused.value).toBe(true);
      expect(handled).toEqual([1]);

      // Skip should work even when paused
      instance.skipAll();

      await waitForIdle(instance);

      // Only first event handled, rest skipped
      expect(handled).toEqual([1]);
    });
  });

  describe('paused state', () => {
    it('pausing stops processing at current event', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        handled.push(event.id);
        if (event.id === 1) {
          instance.paused.value = true;
        }
        await new Promise((r) => setTimeout(r, 10));
      });

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
      ];
      await nextTick();

      // Wait for pause to take effect
      await new Promise((r) => setTimeout(r, 50));

      expect(handled).toEqual([1]);
      expect(instance.isAnimating.value).toBe(true); // Still animating (paused)
    });

    it('resuming continues from where it stopped', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        handled.push(event.id);
        if (event.id === 1) {
          instance.paused.value = true;
        }
        await new Promise((r) => setTimeout(r, 10));
      });

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
        createEvent(3, 'test'),
      ];
      await nextTick();

      // Wait for pause
      await new Promise((r) => setTimeout(r, 50));
      expect(handled).toEqual([1]);

      // Resume
      instance.paused.value = false;
      await waitForIdle(instance);

      expect(handled).toEqual([1, 2, 3]);
    });

    it('events still queue while paused', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        handled.push(event.id);
        if (event.id === 1) {
          instance.paused.value = true;
        }
        await new Promise((r) => setTimeout(r, 10));
      });

      events.value = [createEvent(1, 'test')];
      await nextTick();

      // Wait for pause
      await new Promise((r) => setTimeout(r, 50));

      // Add more events while paused
      events.value = [...events.value, createEvent(2, 'test'), createEvent(3, 'test')];
      await nextTick();

      expect(instance.pendingCount.value).toBe(2);

      // Resume
      instance.paused.value = false;
      await waitForIdle(instance);

      expect(handled).toEqual([1, 2, 3]);
    });
  });

  describe('pendingCount', () => {
    it('updates as events are added', async () => {
      const events = ref<AnimationEvent[]>([]);

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      // Pause so events queue up
      instance.paused.value = true;

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
        createEvent(3, 'test'),
      ];
      await nextTick();

      expect(instance.pendingCount.value).toBe(3);
    });

    it('decrements as events are processed', async () => {
      const events = ref<AnimationEvent[]>([]);
      const counts: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async () => {
        counts.push(instance.pendingCount.value);
        await new Promise((r) => setTimeout(r, 10));
      });

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
        createEvent(3, 'test'),
      ];
      await nextTick();
      await waitForIdle(instance);

      // pendingCount should decrease after each event is dequeued
      expect(counts).toEqual([2, 1, 0]);
    });

    it('is zero after skipAll', async () => {
      const events = ref<AnimationEvent[]>([]);

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      // Pause to queue events
      instance.paused.value = true;

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
        createEvent(3, 'test'),
      ];
      await nextTick();

      expect(instance.pendingCount.value).toBe(3);

      instance.skipAll();

      expect(instance.pendingCount.value).toBe(0);
    });
  });

  describe('event deduplication', () => {
    it('does not re-process events with same ID', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        handled.push(event.id);
      });

      // First batch
      events.value = [createEvent(1, 'test'), createEvent(2, 'test')];
      await nextTick();
      await waitForIdle(instance);

      // Same events again (simulate state update with same events)
      events.value = [createEvent(1, 'test'), createEvent(2, 'test')];
      await nextTick();
      await waitForIdle(instance);

      // Should only process each event once
      expect(handled).toEqual([1, 2]);
    });

    it('only queues events with id > lastProcessedId', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        handled.push(event.id);
      });

      // First batch
      events.value = [createEvent(1, 'test'), createEvent(2, 'test')];
      await nextTick();
      await waitForIdle(instance);

      // New batch with overlapping and new events
      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
        createEvent(3, 'test'),
      ];
      await nextTick();
      await waitForIdle(instance);

      // Should process 1, 2 from first batch, then only 3 from second
      expect(handled).toEqual([1, 2, 3]);
    });

    it('handles events arriving during processing', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('test', async (event) => {
        handled.push(event.id);
        if (event.id === 1) {
          // Add more events during processing
          events.value = [...events.value, createEvent(3, 'test')];
        }
        await new Promise((r) => setTimeout(r, 10));
      });

      events.value = [createEvent(1, 'test'), createEvent(2, 'test')];
      await nextTick();
      await waitForIdle(instance);

      // All events should be processed in order
      expect(handled).toEqual([1, 2, 3]);
    });
  });

  describe('wait-for-handler', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('event with no handler pauses queue, handler registration resumes processing', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: AnimationEvent[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      // Push event with no handler registered
      events.value = [createEvent(1, 'combat')];
      await nextTick();

      // Queue is processing (waiting for handler)
      expect(instance.isAnimating.value).toBe(true);

      // Register handler while waiting
      instance.registerHandler('combat', async (event) => {
        handled.push(event);
      });

      await waitForIdle(instance);

      // Handler was called with the event
      expect(handled).toHaveLength(1);
      expect(handled[0].id).toBe(1);
      expect(handled[0].type).toBe('combat');
    });

    it('timeout expires and event is skipped with console warning', async () => {
      vi.useFakeTimers();
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const events = ref<AnimationEvent[]>([]);

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      events.value = [createEvent(42, 'unknownType')];
      await nextTick();

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(3000);

      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('unknownType')
      );
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('42')
      );
      expect(instance.isAnimating.value).toBe(false);

      consoleWarn.mockRestore();
    });

    it('after timeout, processing continues to next event', async () => {
      vi.useFakeTimers();
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('handled', async (event) => {
        handled.push(event.id);
      });

      events.value = [
        createEvent(1, 'unhandled'),
        createEvent(2, 'handled'),
      ];
      await nextTick();

      // Advance past timeout for unhandled event
      await vi.advanceTimersByTimeAsync(3000);

      // Allow handled event to process
      await vi.advanceTimersByTimeAsync(0);

      expect(consoleWarn).toHaveBeenCalledTimes(1);
      expect(handled).toEqual([2]);

      consoleWarn.mockRestore();
    });

    it('handler registered during wait resumes immediately (no timeout)', async () => {
      vi.useFakeTimers();
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      events.value = [createEvent(1, 'lazy')];
      await nextTick();

      // Waiting for handler
      expect(instance.isAnimating.value).toBe(true);

      // Do NOT advance timers to 3000ms
      // Register handler while waiting
      instance.registerHandler('lazy', async (event) => {
        handled.push(event.id);
      });

      // Flush microtasks
      await vi.advanceTimersByTimeAsync(0);

      expect(handled).toEqual([1]);
      expect(consoleWarn).not.toHaveBeenCalled();

      consoleWarn.mockRestore();
    });

    it('skipAll during handler wait cancels the wait and clears queue', async () => {
      vi.useFakeTimers();
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const events = ref<AnimationEvent[]>([]);

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      events.value = [
        createEvent(1, 'unhandled'),
        createEvent(2, 'unhandled'),
      ];
      await nextTick();

      // Waiting for handler
      expect(instance.isAnimating.value).toBe(true);

      // Skip all
      instance.skipAll();

      // Allow microtasks to flush
      await vi.advanceTimersByTimeAsync(0);

      expect(instance.isAnimating.value).toBe(false);
      expect(instance.pendingCount.value).toBe(0);

      // Advance timers well past timeout -- verify no console.warn fires (timer was cleaned up)
      await vi.advanceTimersByTimeAsync(5000);
      expect(consoleWarn).not.toHaveBeenCalled();

      consoleWarn.mockRestore();
    });

    it('custom timeout value works', async () => {
      vi.useFakeTimers();
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const events = ref<AnimationEvent[]>([]);

      const instance = createAnimationEvents({
        events: () => events.value,
        handlerWaitTimeout: 500,
      });

      events.value = [createEvent(1, 'unhandled')];
      await nextTick();

      // At 499ms, still waiting
      await vi.advanceTimersByTimeAsync(499);
      expect(instance.isAnimating.value).toBe(true);
      expect(consoleWarn).not.toHaveBeenCalled();

      // At 500ms, timeout fires
      await vi.advanceTimersByTimeAsync(1);
      expect(consoleWarn).toHaveBeenCalled();

      consoleWarn.mockRestore();
    });

    it('handlerWaitTimeout: 0 skips immediately (backward compat)', async () => {
      const events = ref<AnimationEvent[]>([]);
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const instance = createAnimationEvents({
        events: () => events.value,
        handlerWaitTimeout: 0,
      });

      events.value = [createEvent(1, 'unhandled')];
      await nextTick();
      await waitForIdle(instance);

      // Event was skipped without waiting and without warning
      expect(consoleWarn).not.toHaveBeenCalled();

      consoleWarn.mockRestore();
    });

    it('multiple unhandled events each get their own wait', async () => {
      vi.useFakeTimers();
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      instance.registerHandler('known', async (event) => {
        handled.push(event.id);
      });

      events.value = [
        createEvent(1, 'unknown-a'),
        createEvent(2, 'known'),
        createEvent(3, 'unknown-b'),
      ];
      await nextTick();

      // Advance past first timeout (unknown-a)
      await vi.advanceTimersByTimeAsync(3000);

      // Allow known event to process, then advance past second timeout (unknown-b)
      await vi.advanceTimersByTimeAsync(3000);

      expect(consoleWarn).toHaveBeenCalledTimes(2);
      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('unknown-a'));
      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('unknown-b'));
      expect(handled).toEqual([2]);

      consoleWarn.mockRestore();
    });

    it('handler already registered before event -- no wait needed', async () => {
      const events = ref<AnimationEvent[]>([]);
      const handled: number[] = [];
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const instance = createAnimationEvents({
        events: () => events.value,
      });

      // Register handler BEFORE event arrives
      instance.registerHandler('preregistered', async (event) => {
        handled.push(event.id);
      });

      events.value = [createEvent(1, 'preregistered')];
      await nextTick();
      await waitForIdle(instance);

      expect(handled).toEqual([1]);
      expect(consoleWarn).not.toHaveBeenCalled();

      consoleWarn.mockRestore();
    });
  });

  describe('provide/inject', () => {
    it('ANIMATION_EVENTS_KEY is a Symbol', () => {
      expect(typeof ANIMATION_EVENTS_KEY).toBe('symbol');
    });

    it('provideAnimationEvents and useAnimationEvents are functions', () => {
      expect(typeof provideAnimationEvents).toBe('function');
      expect(typeof useAnimationEvents).toBe('function');
    });
  });
});
