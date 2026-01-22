/**
 * Tests for useAnimationEvents composable
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const handled: Array<{ type: string; id: number }> = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const order: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const timeline: Array<{ event: string; id: number }> = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const handled: number[] = [];
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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

    it('events without handlers are skipped (with optional delay)', async () => {
      const events = ref<AnimationEvent[]>([]);
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
        defaultDuration: 10,
      });

      instance.registerHandler('handled', async (event) => {
        handled.push(event.id);
      });

      const start = Date.now();
      events.value = [
        createEvent(1, 'unhandled'), // Should use default delay
        createEvent(2, 'handled'),
        createEvent(3, 'unhandled'), // Should use default delay
      ];
      await nextTick();
      await waitForIdle(instance);
      const elapsed = Date.now() - start;

      // Should have 2 unhandled events with 10ms delay each = ~20ms
      expect(elapsed).toBeGreaterThanOrEqual(15);
      expect(handled).toEqual([2]);
      expect(acknowledge).toHaveBeenCalledWith(3);
    });
  });

  describe('isAnimating state', () => {
    it('is false when no events', () => {
      const events = ref<AnimationEvent[]>([]);
      const acknowledge = vi.fn();

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
      });

      expect(instance.isAnimating.value).toBe(false);
    });

    it('is true during processing', async () => {
      const events = ref<AnimationEvent[]>([]);
      const acknowledge = vi.fn();
      let wasAnimatingDuringHandler = false;

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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

    it('acknowledges all pending event IDs', async () => {
      const events = ref<AnimationEvent[]>([]);
      const acknowledge = vi.fn();

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
      });

      instance.registerHandler('test', async (event) => {
        if (event.id === 1) {
          // Skip during first handler
          instance.skipAll();
        }
        await new Promise((r) => setTimeout(r, 10));
      });

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
        createEvent(3, 'test'),
      ];
      await nextTick();
      await waitForIdle(instance);

      // Should acknowledge up to event 3 (the last pending)
      expect(acknowledge).toHaveBeenCalledWith(3);
    });

    it('stops processing immediately', async () => {
      const events = ref<AnimationEvent[]>([]);
      const acknowledge = vi.fn();
      const handlerStarts: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      expect(acknowledge).toHaveBeenCalledWith(3);
    });
  });

  describe('paused state', () => {
    it('pausing stops processing at current event', async () => {
      const events = ref<AnimationEvent[]>([]);
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const counts: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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
      const acknowledge = vi.fn();
      const handled: number[] = [];

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
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

  describe('acknowledgment', () => {
    it('calls acknowledge after processing batch', async () => {
      const events = ref<AnimationEvent[]>([]);
      const acknowledge = vi.fn();

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
      });

      instance.registerHandler('test', async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      events.value = [
        createEvent(1, 'test'),
        createEvent(2, 'test'),
        createEvent(3, 'test'),
      ];
      await nextTick();
      await waitForIdle(instance);

      expect(acknowledge).toHaveBeenCalledWith(3);
    });

    it('passes correct upToId (last processed)', async () => {
      const events = ref<AnimationEvent[]>([]);
      const acknowledge = vi.fn();

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
      });

      instance.registerHandler('test', async () => {
        await new Promise((r) => setTimeout(r, 5));
      });

      events.value = [createEvent(5, 'test'), createEvent(10, 'test')];
      await nextTick();
      await waitForIdle(instance);

      expect(acknowledge).toHaveBeenCalledWith(10);
    });

    it('skipAll acknowledges remaining events', async () => {
      const events = ref<AnimationEvent[]>([]);
      const acknowledge = vi.fn();

      const instance = createAnimationEvents({
        events: () => events.value,
        acknowledge,
      });

      // Pause so events queue
      instance.paused.value = true;

      events.value = [
        createEvent(1, 'test'),
        createEvent(5, 'test'),
        createEvent(10, 'test'),
      ];
      await nextTick();

      instance.skipAll();

      // Should acknowledge up to the last event
      expect(acknowledge).toHaveBeenCalledWith(10);
    });

    it('does not acknowledge if no events processed', async () => {
      const events = ref<AnimationEvent[]>([]);
      const acknowledge = vi.fn();

      createAnimationEvents({
        events: () => events.value,
        acknowledge,
      });

      // Empty events array
      events.value = [];
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      expect(acknowledge).not.toHaveBeenCalled();
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
