// @vitest-environment jsdom
/**
 * A browser without CSS `zoom` (Firefox before 126) is offered no zoom (#1361).
 *
 * There `.game-shell__zoom-container`'s `zoom` is dropped, so the slider moved
 * nothing. Driven on the REAL GameShell, where the controls menu is rendered.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';
import { withoutCssZoom } from '../composables/css-zoom.test-helper.js';

const mounted: Array<{ unmount(): void }> = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  leaveIframe();
  document.body.innerHTML = '';
});

async function zoomRowShown(): Promise<boolean> {
  enterIframe();
  const wrapper = mountPlatformShell();
  mounted.push(wrapper);
  await nextTick();
  await wrapper.find('button.menubtn').trigger('click');
  return document.querySelector('input.zoom-range') !== null;
}

describe('GameShell controls-menu zoom (#1361)', () => {
  it('offers the zoom slider where the browser applies CSS zoom', async () => {
    expect(await zoomRowShown()).toBe(true);
  });

  it('offers no zoom slider where the browser has no CSS zoom', async () => {
    const restore = withoutCssZoom();
    try {
      expect(await zoomRowShown()).toBe(false);
    } finally {
      restore();
    }
  });
});
