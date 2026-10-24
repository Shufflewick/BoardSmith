// @vitest-environment jsdom
/**
 * Tests proving GameShell's announcer wiring:
 *  - parity: a custom-UI-style descendant and an AutoUI-style descendant
 *    mounted under the same provider both receive the same announcer and
 *    drive the same live-region ref.
 *  - live regions: the seat's announcer writes its own live regions and
 *    posts nothing to any window (#1466).
 *
 * Does NOT mount the real GameShell.vue — see GameShell.live-region.test.ts
 * for the rationale (extensive client/session mocking required). Instead this
 * mounts minimal inline components that exercise the same
 * createAnnouncer/ANNOUNCER_KEY/useAnnouncer wiring GameShell installs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ref, defineComponent, h, nextTick, provide } from 'vue';
import { mount } from '@vue/test-utils';
import {
  createAnnouncer,
  createLiveRegion,
  useAnnouncer,
  ANNOUNCER_KEY,
  type UseAnnouncerReturn,
} from '../composables/useAnnouncer.js';

// A "custom-UI-style" descendant: directly calls useAnnouncer() from a leaf component.
const CustomUiDescendant = defineComponent({
  setup() {
    const { announce } = useAnnouncer();
    return { announce };
  },
  render() {
    return h('div', { class: 'custom-ui-descendant' });
  },
});

// An "AutoUI-style" descendant: same inject path, different component identity,
// proving parity is about the injection mechanism, not the component type.
const AutoUiDescendant = defineComponent({
  setup() {
    const { announce } = useAnnouncer();
    return { announce };
  },
  render() {
    return h('div', { class: 'auto-ui-descendant' });
  },
});

describe('GameShell announcer wiring — parity', () => {
  it('a custom-UI descendant and an AutoUI descendant both receive the same injected announcer', () => {
    const mockAnnouncer: UseAnnouncerReturn = { announce: vi.fn() };

    const Host = defineComponent({
      components: { CustomUiDescendant, AutoUiDescendant },
      render() {
        return h('div', [h(CustomUiDescendant, { ref: 'custom' }), h(AutoUiDescendant, { ref: 'auto' })]);
      },
    });

    const wrapper = mount(Host, {
      global: { provide: { [ANNOUNCER_KEY as unknown as string]: mockAnnouncer } },
    });

    const customVm = wrapper.findComponent(CustomUiDescendant).vm as unknown as { announce: (m: string) => void };
    const autoVm = wrapper.findComponent(AutoUiDescendant).vm as unknown as { announce: (m: string) => void };

    customVm.announce('from custom UI');
    autoVm.announce('from auto UI');

    expect(mockAnnouncer.announce).toHaveBeenCalledTimes(2);
    expect(mockAnnouncer.announce).toHaveBeenNthCalledWith(1, 'from custom UI');
    expect(mockAnnouncer.announce).toHaveBeenNthCalledWith(2, 'from auto UI');
  });

  it('both descendants drive the same politeMessage ref through a real createAnnouncer', async () => {
    const politeMessage = ref('');
    const assertiveMessage = ref('');
    const announcer = createAnnouncer({ politeMessage, assertiveMessage });

    const Host = defineComponent({
      components: { CustomUiDescendant, AutoUiDescendant },
      setup() {
        provide(ANNOUNCER_KEY, announcer);
      },
      render() {
        return h('div', [h(CustomUiDescendant, { ref: 'custom' }), h(AutoUiDescendant, { ref: 'auto' })]);
      },
    });

    const wrapper = mount(Host);
    const customVm = wrapper.findComponent(CustomUiDescendant).vm as unknown as { announce: (m: string) => void };
    const autoVm = wrapper.findComponent(AutoUiDescendant).vm as unknown as { announce: (m: string) => void };

    customVm.announce('custom says hi');
    await nextTick();
    expect(politeMessage.value).toBe('custom says hi');

    autoVm.announce('auto says hi');
    await nextTick();
    expect(politeMessage.value).toBe('auto says hi');
  });
});

describe('createLiveRegion (#1466)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes each announcement to the seat's own live regions and posts nothing to any window", async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const { liveRegion, announcer } = createLiveRegion();

    announcer.announce('3 cards remain');
    announcer.announce('Invalid move', { assertive: true });
    await nextTick();

    expect(liveRegion.polite.value).toBe('3 cards remain');
    expect(liveRegion.assertive.value).toBe('Invalid move');
    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});
