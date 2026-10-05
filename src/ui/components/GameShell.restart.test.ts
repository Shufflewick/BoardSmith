// @vitest-environment jsdom
/**
 * GameShell — forward-exit routing (D11 / ENDGAME-02), on the REAL shell.
 *
 * "New game" in the controls menu restarts through the SAME path as Rematch:
 * a `debug:restart` request to the host, which owns the session.
 *
 * The menu offers no "Leave game" (#515). Leaving used to drop the iframe onto
 * a lobby screen that talked to a deleted HTTP server; the host page around
 * the frame is where a player leaves a game.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import ControlsMenu from './ControlsMenu.vue';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

afterEach(() => {
  leaveIframe();
  document.body.innerHTML = '';
});

function requestsFor(posted: unknown[], op: string): unknown[] {
  return posted.filter((m) => {
    const message = m as { type?: unknown; op?: unknown };
    return message.type === 'server_request' && message.op === op;
  });
}

describe('GameShell — "New game" routing (D11)', () => {
  it('asks the host to restart through debug:restart', async () => {
    const posted = enterIframe();
    const wrapper = mountPlatformShell();
    await nextTick();

    wrapper.findComponent(ControlsMenu).vm.$emit('menu-item-click', 'new-game');
    await nextTick();

    expect(requestsFor(posted, 'debug:restart')).toHaveLength(1);
    wrapper.unmount();
  });
});

describe('the controls menu (#515)', () => {
  it('offers no "Leave game" item', async () => {
    enterIframe();
    const wrapper = mountPlatformShell();
    await nextTick();

    await wrapper.find('button[aria-label="Game controls"]').trigger('click');
    await nextTick();

    expect(document.body.textContent).toContain('New game');
    expect(document.body.textContent).not.toContain('Leave game');
    wrapper.unmount();
  });
});
