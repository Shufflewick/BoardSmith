/**
 * Tests for useAutoRendererAnimations — RENDER-05 automated proof.
 *
 * Verifies:
 *   1. Handlers for deal/flip/reveal register and fire when events are enqueued.
 *   2. undefined animationEvents is graceful (no throw).
 *   3. A 'deal' event with empty data does not throw (defensive access).
 *   4. fly spy is called when a 'deal' event fires.
 *
 * No @vue/test-utils: tests use createAnimationEvents directly (mirrors useAnimationEvents.test.ts).
 * useAutoRendererAnimations is a plain function — no component mounting required.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { createAnimationEvents, type UseAnimationEventsReturn } from '../../composables/useAnimationEvents.js';
import type { AnimationEvent } from '../../../engine/index.js';
import { useAutoRendererAnimations } from './useAutoRendererAnimations.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEvent(
  id: number,
  type: string,
  data: Record<string, unknown> = {}
): AnimationEvent {
  return { id, type, data, timestamp: Date.now() };
}

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

function createFlyStub() {
  return vi.fn().mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Behavior 1: undefined animationEvents — no throw, registers nothing
// ---------------------------------------------------------------------------

describe('useAutoRendererAnimations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns without throwing when animationEvents is undefined', () => {
    const fly = createFlyStub();
    // Must not throw
    expect(() => useAutoRendererAnimations(undefined, { fly })).not.toThrow();
  });

  it('registers no handlers when animationEvents is undefined', () => {
    const fly = createFlyStub();
    useAutoRendererAnimations(undefined, { fly });
    // fly should never be called — there's nothing to call it
    expect(fly).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Behavior 2: deal event fires and fly spy is called
  // ---------------------------------------------------------------------------

  it('calls fly when a deal event is enqueued with source and destination data', async () => {
    const events = ref<AnimationEvent[]>([]);
    const instance = createAnimationEvents({ events: () => events.value, handlerWaitTimeout: 0 });
    const fly = createFlyStub();

    useAutoRendererAnimations(instance, { fly });

    events.value = [
      createEvent(1, 'deal', {
        sourceElementId: 10,
        destinationElementId: 20,
        sourceRect: { x: 0, y: 0, width: 50, height: 70, top: 0, left: 0, right: 50, bottom: 70 },
        destinationRect: { x: 100, y: 100, width: 50, height: 70, top: 100, left: 100, right: 150, bottom: 170 },
      }),
    ];

    await nextTick();
    await waitForIdle(instance);

    expect(fly).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Behavior 3: deal event with empty data does not throw
  // ---------------------------------------------------------------------------

  it('does not throw when a deal event has empty data', async () => {
    const events = ref<AnimationEvent[]>([]);
    const instance = createAnimationEvents({ events: () => events.value, handlerWaitTimeout: 0 });
    const fly = createFlyStub();

    useAutoRendererAnimations(instance, { fly });

    // Defensive: missing keys in data must not throw
    events.value = [createEvent(2, 'deal', {})];

    await nextTick();
    await expect(waitForIdle(instance)).resolves.not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Behavior 4: flip and reveal handlers are registered (they run without throwing)
  // ---------------------------------------------------------------------------

  it('handles a flip event without throwing', async () => {
    const events = ref<AnimationEvent[]>([]);
    const instance = createAnimationEvents({ events: () => events.value, handlerWaitTimeout: 0 });
    const fly = createFlyStub();

    useAutoRendererAnimations(instance, { fly });

    events.value = [createEvent(3, 'flip', { elementId: 5 })];

    await nextTick();
    await expect(waitForIdle(instance)).resolves.not.toThrow();
  });

  it('handles a reveal event without throwing', async () => {
    const events = ref<AnimationEvent[]>([]);
    const instance = createAnimationEvents({ events: () => events.value, handlerWaitTimeout: 0 });
    const fly = createFlyStub();

    useAutoRendererAnimations(instance, { fly });

    events.value = [createEvent(4, 'reveal', { elementId: 7 })];

    await nextTick();
    await expect(waitForIdle(instance)).resolves.not.toThrow();
  });
});
