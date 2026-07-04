// @vitest-environment jsdom
/**
 * Tests proving GameShell's announcer wiring:
 *  - parity: a custom-UI-style descendant and an AutoUI-style descendant
 *    mounted under the same provider both receive the same announcer and
 *    drive the same live-region ref.
 *  - relay: each announce() fires the existing boardsmith-a11y postMessage
 *    relay unchanged.
 *
 * Does NOT mount the real GameShell.vue — see GameShell.live-region.test.ts
 * for the rationale (extensive client/session mocking required). Instead this
 * mounts minimal inline components that exercise the same
 * createAnnouncer/provideAnnouncer/useAnnouncer wiring GameShell installs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ref, defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import {
  createAnnouncer,
  provideAnnouncer,
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
    const emitAnnounce = vi.fn();
    const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce });

    const Host = defineComponent({
      components: { CustomUiDescendant, AutoUiDescendant },
      setup() {
        provideAnnouncer(announcer);
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

describe('GameShell announcer wiring — relay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calling announce fires window.postMessage with the boardsmith-a11y shape', () => {
    const politeMessage = ref('');
    const assertiveMessage = ref('');
    function emitAnnounce(level: 'polite' | 'assertive', text: string): void {
      window.postMessage({ source: 'boardsmith-a11y', type: 'announce', level, text }, '*');
    }
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce });
    announcer.announce('3 cards remain');

    expect(postMessageSpy).toHaveBeenCalledWith(
      { source: 'boardsmith-a11y', type: 'announce', level: 'polite', text: '3 cards remain' },
      '*'
    );

    announcer.announce('Invalid move', { assertive: true });
    expect(postMessageSpy).toHaveBeenCalledWith(
      { source: 'boardsmith-a11y', type: 'announce', level: 'assertive', text: 'Invalid move' },
      '*'
    );
  });
});
