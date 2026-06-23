// @vitest-environment jsdom
/**
 * AutoUI — retry event forwarding test (CR-01, Phase 102)
 *
 * Verifies that AutoUI forwards the 'retry' event emitted by AutoRenderer
 * upward to its own parent, completing the chain:
 *   button click → AutoRenderer emits 'retry' → AutoUI emits 'retry'
 *
 * AutoRenderer is stubbed at the component level so the test is instantaneous
 * (no 8-second timer needed).
 */

import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

// ---------------------------------------------------------------------------
// Mock composables that pull in window.matchMedia at module-load time.
// These must be hoisted before AutoUI.vue is imported.
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
import AutoUI from './AutoUI.vue';

// ---------------------------------------------------------------------------
// Stub child components
// ---------------------------------------------------------------------------
const stubs = {
  BoardLegend: true,
  // Stub AutoRenderer as a simple component that can emit 'retry' on demand.
  AutoRenderer: defineComponent({
    name: 'AutoRendererStub',
    emits: ['retry'],
    setup(_, { emit }) {
      // Expose a trigger so the test can call it programmatically.
      return { triggerRetry: () => emit('retry') };
    },
    render() {
      return h('div', { class: 'auto-renderer-stub' });
    },
  }),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AutoUI — retry event forwarding', () => {
  it('forwards the retry event from AutoRenderer to its own parent', async () => {
    const wrapper = mount(AutoUI, {
      props: {
        gameView: null,
        playerSeat: 0,
      },
      global: { stubs },
    });

    // Grab the AutoRenderer stub instance and trigger a retry emit.
    const rendererStub = wrapper.getComponent({ name: 'AutoRendererStub' });
    await (rendererStub.vm as unknown as { triggerRetry(): void }).triggerRetry();

    // AutoUI must have forwarded the event.
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });
});
