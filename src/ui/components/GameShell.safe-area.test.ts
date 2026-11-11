// @vitest-environment jsdom
/**
 * THE HOST SENDS THE FRAME'S SAFE AREAS; THE SHELL NEVER GUESSES THEM (#1611).
 *
 * Inside an iframe `env(safe-area-inset-*)` cannot be trusted: Chrome reads 0
 * and Safari reads the parent page's values. So the host measures the four
 * insets over its frame and posts them as `safe_area`, again on every rotation,
 * and the shell exposes them as `--bsg-safe-top/right/bottom/left`. Until a
 * host says otherwise they are zero.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

function insets(): Record<string, string> {
  const root = getComputedStyle(document.documentElement);
  return Object.fromEntries(SIDES.map((side) => [side, root.getPropertyValue(`--bsg-safe-${side}`).trim()]));
}

function postFromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

afterEach(() => {
  leaveIframe();
  vi.restoreAllMocks();
  for (const side of SIDES) document.documentElement.style.removeProperty(`--bsg-safe-${side}`);
});

describe('GameShell safe areas (#1611)', () => {
  it('reads zero on every side until the host sends any', async () => {
    enterIframe();
    const wrapper = mountPlatformShell();
    await nextTick();
    expect(insets()).toEqual({ top: '0px', right: '0px', bottom: '0px', left: '0px' });
    wrapper.unmount();
  });

  it("exposes the host's insets as CSS variables, and the next message replaces them", async () => {
    enterIframe();
    const wrapper = mountPlatformShell();
    await nextTick();
    postFromHost({ type: 'safe_area', top: 0, right: 47, bottom: 21, left: 47 });
    expect(insets()).toEqual({ top: '0px', right: '47px', bottom: '21px', left: '47px' });
    // The phone turned upright.
    postFromHost({ type: 'safe_area', top: 47, right: 0, bottom: 34, left: 0 });
    expect(insets()).toEqual({ top: '47px', right: '0px', bottom: '34px', left: '0px' });
    wrapper.unmount();
  });

  it('refuses a malformed message out loud and keeps the insets it had', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    enterIframe();
    const wrapper = mountPlatformShell();
    await nextTick();
    postFromHost({ type: 'safe_area', top: 47, right: 0, bottom: 34, left: 0 });
    postFromHost({ type: 'safe_area', top: '20px', right: -1, bottom: Number.NaN });
    expect(insets()).toEqual({ top: '47px', right: '0px', bottom: '34px', left: '0px' });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('top, right, bottom, left'));
    wrapper.unmount();
  });

  it('ignores insets posted by anything but the host page', async () => {
    enterIframe();
    const wrapper = mountPlatformShell();
    await nextTick();
    window.dispatchEvent(new MessageEvent('message', {
      source: window, data: { source: 'shufflewick', type: 'safe_area', top: 47, right: 0, bottom: 34, left: 0 },
    }));
    expect(insets()).toEqual({ top: '0px', right: '0px', bottom: '0px', left: '0px' });
    wrapper.unmount();
  });
});
