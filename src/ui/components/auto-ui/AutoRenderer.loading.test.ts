// @vitest-environment jsdom
/**
 * AutoRenderer loading state tests — Phase 102, Plan 02 [TDD RED]
 *
 * Behaviors under test:
 *   1. When mounted with no gameView, the component renders a skeleton element
 *      (class "auto-renderer-skeleton") and does NOT render the old "Waiting…" text.
 *   2. The Retry button is hidden initially and becomes visible after the timeout elapses.
 *   3. Clicking Retry resets the timed-out state (retryVisible → false) and re-arms the timer.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

// ---------------------------------------------------------------------------
// useElementAnimation reads window.matchMedia at module-load time. Mock the
// composables that pull it in before AutoRenderer.vue is imported.
// vi.mock() calls are hoisted before imports by vitest.
// ---------------------------------------------------------------------------
vi.mock('../../composables/useFlyingElements.js', () => ({
  useFlyingElements: () => ({
    flyingElements: ref([]),
    fly: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../composables/useAnimationEvents.js', () => ({
  useAnimationEvents: () => undefined,
}));

vi.mock('./useAutoRendererAnimations.js', () => ({
  useAutoRendererAnimations: vi.fn(),
}));

// eslint-disable-next-line import/first -- must follow vi.mock calls
import AutoRenderer from './AutoRenderer.vue';

// ---------------------------------------------------------------------------
// Stub child components that are too expensive / require inject context
// ---------------------------------------------------------------------------
const stubs = {
  FlyingCardsOverlay: true,
  GridBoardTemplate: true,
  CardTemplate: true,
  TableauTemplate: true,
  UnsupportedTopologyPanel: true,
};

// ---------------------------------------------------------------------------
// Minimal wrapper that provides the injection context AutoRenderer expects
// ---------------------------------------------------------------------------
function mountAutoRenderer(gameView: null | undefined = null) {
  return mount(AutoRenderer, {
    props: {
      gameView,
      playerSeat: 0,
    },
    global: {
      stubs,
      // Provide required injection keys that child composables/components need
      provide: {
        animationEvents: undefined,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Behavior 1: skeleton rendered (no old "Waiting…" text)
// ---------------------------------------------------------------------------

describe('AutoRenderer loading state — skeleton', () => {
  it('renders the skeleton container when gameView is null', () => {
    const wrapper = mountAutoRenderer(null);
    expect(wrapper.find('.auto-renderer-skeleton').exists()).toBe(true);
  });

  it('does NOT render the old "Waiting for game state" text', () => {
    const wrapper = mountAutoRenderer(null);
    expect(wrapper.text()).not.toContain('Waiting for game state');
  });

  it('renders multiple placeholder bars inside the skeleton', () => {
    const wrapper = mountAutoRenderer(null);
    const bars = wrapper.findAll('.auto-renderer-skeleton .skeleton-bar');
    expect(bars.length).toBeGreaterThanOrEqual(3);
  });

  it('has aria-busy="true" on the skeleton container', () => {
    const wrapper = mountAutoRenderer(null);
    const skeleton = wrapper.find('.auto-renderer-skeleton');
    expect(skeleton.attributes('aria-busy')).toBe('true');
  });

  it('has a visually-hidden "Loading game…" text for screen readers', () => {
    const wrapper = mountAutoRenderer(null);
    // The sr-only span should exist with loading text
    const srOnly = wrapper.find('.sr-only');
    expect(srOnly.exists()).toBe(true);
    expect(srOnly.text()).toContain('Loading game');
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: Retry affordance — hidden initially, shown after timeout
// ---------------------------------------------------------------------------

describe('AutoRenderer loading state — retry affordance', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the retry button initially', () => {
    vi.useFakeTimers();
    const wrapper = mountAutoRenderer(null);
    // The retry block should not exist before timeout
    expect(wrapper.find('.auto-renderer-retry').exists()).toBe(false);
  });

  it('shows the retry affordance after the timeout elapses', async () => {
    vi.useFakeTimers();
    const wrapper = mountAutoRenderer(null);

    // Advance past the 8-second threshold
    await vi.advanceTimersByTimeAsync(8001);
    await flushPromises();

    expect(wrapper.find('.auto-renderer-retry').exists()).toBe(true);
  });

  it('does not show retry before the timeout has elapsed', async () => {
    vi.useFakeTimers();
    const wrapper = mountAutoRenderer(null);

    // Advance only halfway
    await vi.advanceTimersByTimeAsync(4000);
    await flushPromises();

    expect(wrapper.find('.auto-renderer-retry').exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: Clicking Retry resets state and re-arms the timer
// ---------------------------------------------------------------------------

describe('AutoRenderer loading state — retry click', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the retry affordance again after clicking Retry', async () => {
    vi.useFakeTimers();
    const wrapper = mountAutoRenderer(null);

    // Let the timeout fire
    await vi.advanceTimersByTimeAsync(8001);
    await flushPromises();

    expect(wrapper.find('.auto-renderer-retry').exists()).toBe(true);

    // Click Retry
    const retryBtn = wrapper.find('.auto-renderer-retry button');
    expect(retryBtn.exists()).toBe(true);
    await retryBtn.trigger('click');
    await flushPromises();

    // Retry affordance should hide again (timer re-armed)
    expect(wrapper.find('.auto-renderer-retry').exists()).toBe(false);
  });

  it('emits a "retry" event when the Retry button is clicked', async () => {
    vi.useFakeTimers();
    const wrapper = mountAutoRenderer(null);

    await vi.advanceTimersByTimeAsync(8001);
    await flushPromises();

    const retryBtn = wrapper.find('.auto-renderer-retry button');
    await retryBtn.trigger('click');

    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('re-arms the timer so retry affordance reappears after another 8s', async () => {
    vi.useFakeTimers();
    const wrapper = mountAutoRenderer(null);

    // First timeout
    await vi.advanceTimersByTimeAsync(8001);
    await flushPromises();
    const retryBtn = wrapper.find('.auto-renderer-retry button');
    await retryBtn.trigger('click');
    await flushPromises();

    // Should be hidden again
    expect(wrapper.find('.auto-renderer-retry').exists()).toBe(false);

    // Second timeout
    await vi.advanceTimersByTimeAsync(8001);
    await flushPromises();

    // Should reappear
    expect(wrapper.find('.auto-renderer-retry').exists()).toBe(true);
  });
});
