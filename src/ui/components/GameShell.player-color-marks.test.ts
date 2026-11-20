// @vitest-environment jsdom
/**
 * A GAME TURNS ON THE SEAT CARDS' COLOUR MARKS THROUGH GAMESHELL (#1733).
 *
 * A game never mounts PlayersPanel, so the marks are asserted on the real
 * GameShell, driven by the host's own messages, with the seat colours the state
 * carries.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';
import type { PlayerColorMark } from './PlayersPanel.vue';

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

async function mountAtTable(playerColorMarks?: readonly PlayerColorMark[]) {
  enterIframe();
  const wrapper = mountPlatformShell({ props: playerColorMarks ? { playerColorMarks } : {} });
  await nextTick();
  post({ type: 'init', seat: 0 });
  post({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 0, awaitingInput: true, availableActions: [] },
      state: { view: {}, players: [{ seat: 0, name: 'Alice', color: '#1a237e' }, { seat: 1, name: 'Bob', color: '#ffeb3b' }], currentPlayer: 0, isMyTurn: true, availableActions: [] },
    },
    winners: [],
  });
  await nextTick();
  await nextTick();
  return wrapper;
}

afterEach(leaveIframe);

describe('GameShell playerColorMarks (#1733)', () => {
  it('draws no stripe when the game says nothing', async () => {
    const wrapper = await mountAtTable();
    expect(wrapper.findAll('.player-card')).toHaveLength(2);
    expect(wrapper.findAll('.player-card.color-stripe')).toHaveLength(0);
    wrapper.unmount();
  });

  it('draws each seat\'s stripe in the colour the state gives it', async () => {
    const wrapper = await mountAtTable(['stripe']);
    const stripes = wrapper.findAll('.player-card.color-stripe');
    expect(stripes.map((card) => (card.element as HTMLElement).style.getPropertyValue('--bs-seat-color'))).toEqual(['#1a237e', '#ffeb3b']);
    wrapper.unmount();
  });
});
