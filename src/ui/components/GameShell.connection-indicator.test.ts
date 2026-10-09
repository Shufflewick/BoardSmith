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
 * The shell talks to a host only when it is in an iframe, detected synchronously at setup as
 * `window.parent !== window`, so the test redefines `window.parent` before mount.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

function mountShell() {
  return mountPlatformShell();
}

afterEach(leaveIframe);

describe('GameShell connection indicator (IA-01 / #179)', () => {
  it('renders the dot while the platform connection is still connecting', async () => {
    enterIframe();
    const wrapper = mountShell();
    await nextTick();

    // Inside a host the play surface -- and its dot -- is up from the start.
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

  it('shows no dot outside a host, where only the "runs inside a host" sentence renders', async () => {
    const wrapper = mountShell();
    await nextTick();
    expect(wrapper.find('[data-testid="bs-connection"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
