// @vitest-environment jsdom
/**
 * AutoUI registers no animation handlers, so the queue must not wait for one
 * while it is the board: that wait kept the Action Panel hidden for 3s per
 * event (#1758).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import AutoRenderer from './AutoRenderer.vue';
import { ANIMATION_EVENTS_KEY, createAnimationEvents } from '../../composables/useAnimationEvents.js';
import type { AnimationEvent } from '../../../engine/index.js';

afterEach(() => {
  vi.useRealTimers();
});

function mountWithAnimations(events: ReturnType<typeof ref<AnimationEvent[]>>) {
  const animationEvents = createAnimationEvents({ events: () => events.value });
  const wrapper = mount(AutoRenderer, {
    props: { gameView: null, playerSeat: 0 },
    global: { provide: { [ANIMATION_EVENTS_KEY as symbol]: animationEvents } },
  });
  return { wrapper, animationEvents };
}

describe('AutoRenderer animation events (#1758)', () => {
  it('skips an event no handler takes without waiting for one', async () => {
    vi.useFakeTimers();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = ref<AnimationEvent[]>([]);
    const { animationEvents } = mountWithAnimations(events);

    events.value = [{ id: 1, type: 'demo', data: {} }];
    await vi.advanceTimersByTimeAsync(0);

    expect(animationEvents.isAnimating.value).toBe(false);
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('waits for a handler again once AutoUI unmounts, so the next board can register one', async () => {
    vi.useFakeTimers();
    const events = ref<AnimationEvent[]>([]);
    const { wrapper, animationEvents } = mountWithAnimations(events);

    wrapper.unmount();
    events.value = [{ id: 1, type: 'demo', data: {} }];
    await vi.advanceTimersByTimeAsync(0);

    expect(animationEvents.isAnimating.value).toBe(true);
    animationEvents.skipAll();
  });
});
