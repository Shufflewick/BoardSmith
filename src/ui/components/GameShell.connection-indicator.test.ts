// @vitest-environment jsdom
/**
 * The connection dot the table half of #170 §2.5 promises (IA-01), asserted on
 * the REAL GameShell rather than a harness that restates its computed.
 *
 * BoardSmith #179: `connectionIndicator` read `props.platformMode` — a prop that
 * does not exist. `platformMode` is a local ref. So the computed's guard read
 * `undefined`, returned `null` unconditionally, and the dot NEVER rendered in
 * any game, in any state. A harness mirroring the computed would have been green
 * throughout, which is why this mounts the shell itself: the shell is the thing
 * that was broken.
 *
 * Platform mode is "am I in an iframe", detected synchronously at setup as
 * `window.parent !== window`, so the test redefines `window.parent` before mount.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, defineComponent, h } from 'vue';
import GameShell from './GameShell.vue';
import { defineGameUIs, defaultUI } from '../game-uis.js';

const StubBoard = defineComponent({ name: 'StubBoard', setup: () => () => h('div', 'board') });
const uis = defineGameUIs({ Stub: defaultUI(StubBoard) });

const realParent = Object.getOwnPropertyDescriptor(window, 'parent');

function enterIframe(): void {
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: { postMessage: vi.fn() },
  });
}

// jsdom ships no matchMedia; GameShell's compact-tier watch needs one.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function mountShell() {
  return mount(GameShell, {
    props: { gameType: 'indicator-test', uis },
    global: { stubs: { DisabledReasonTooltip: true, Toast: true } },
  });
}

afterEach(() => {
  if (realParent) Object.defineProperty(window, 'parent', realParent);
});

describe('GameShell connection indicator (IA-01 / #179)', () => {
  it('renders the dot while the platform connection is still connecting', async () => {
    enterIframe();
    const wrapper = mountShell();
    await nextTick();

    // Platform mode skips the lobby, so the play surface — and its dot — is up.
    const dot = wrapper.find('[data-testid="bs-connection"]');
    expect(dot.exists()).toBe(true);
    expect(dot.classes()).toContain('connecting');
    expect(dot.attributes('title')).toBe('Connecting…');
    wrapper.unmount();
  });

  it('takes the dot away once a heartbeat lands, and brings it back stale', async () => {
    vi.useFakeTimers();
    try {
      enterIframe();
      const wrapper = mountShell();
      await nextTick();

      window.dispatchEvent(
        new MessageEvent('message', { data: { source: 'shufflewick', type: 'heartbeat' } }),
      );
      await nextTick();
      // A healthy connection says nothing: a persistent green speck over the
      // board reads as a mystery, not as reassurance.
      expect(wrapper.find('[data-testid="bs-connection"]').exists()).toBe(false);

      vi.advanceTimersByTime(10_001);
      await nextTick();
      const dot = wrapper.find('[data-testid="bs-connection"]');
      expect(dot.exists()).toBe(true);
      expect(dot.classes()).toContain('stale');
      expect(dot.attributes('title')).toBe('Connection lost — reconnecting…');
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no dot outside platform mode — the GameHeader badge speaks there', async () => {
    const wrapper = mountShell();
    await nextTick();
    expect(wrapper.find('[data-testid="bs-connection"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
