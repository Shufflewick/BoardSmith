// @vitest-environment jsdom
/**
 * GameShell listens to its host page only (#719). Another frame or popup can post to this
 * window with any origin and any `data.source`; only `event.source` says who sent it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import ControlsMenu from './ControlsMenu.vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

function postState(source: unknown): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: source as MessageEventSource,
    data: {
      source: 'shufflewick',
      type: 'game_state',
      view: {
        flowState: { currentPlayer: 0, awaitingInput: true, availableActions: [] },
        state: { view: {}, players: [], currentPlayer: 0, isMyTurn: true, hasBotPlayers: true },
      },
    },
  }));
}

describe('GameShell — who may post to it', () => {
  afterEach(leaveIframe);

  it('ignores a game_state from a window other than its parent', async () => {
    enterIframe();
    const wrapper = mountPlatformShell();
    await nextTick();
    postState({ postMessage() {} });
    await nextTick();
    expect(wrapper.findComponent(ControlsMenu).props('showHint')).toBeUndefined();
    postState(window.parent);
    await nextTick();
    expect(wrapper.findComponent(ControlsMenu).props('showHint')).toBe(true);
    wrapper.unmount();
  });
});
