// @vitest-environment jsdom
/**
 * THE DEBUG PANEL OFFERS ONE SEAT BUTTON PER SEAT IN THE RUNNING GAME (#525).
 *
 * The Controls tab drew its "switch player" buttons from a `playerCount` prop
 * each game hand-wrote on `GameShell`, defaulting to 2. That is not the number
 * of seats at the table: seven passes its minimum, so a 5-player game offered
 * two buttons and seats 3 to 5 could not be reached. The count now comes from
 * the players in the state the host sends.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import ControlsTab from './debug/ControlsTab.vue';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'shufflewick', ...data } }));
}

const players = (n: number) =>
  Array.from({ length: n }, (_, seat) => ({ name: `P${seat + 1}`, seat }));

afterEach(() => {
  leaveIframe();
  document.body.innerHTML = '';
});

describe('Debug panel seat buttons (#525)', () => {
  it('renders one seat button per seat in a 5-seat game, with no count handed to the shell', async () => {
    enterIframe();
    const wrapper = mountPlatformShell();
    await nextTick();

    post({ type: 'init', seat: 0 });
    post({ type: 'dev-debug-available', available: true });
    post({ type: 'dev-debug-toggle' });
    post({
      type: 'game_state',
      view: {
        flowState: { currentPlayer: 0, awaitingInput: true, availableActions: [] },
        state: { view: {}, players: players(5), currentPlayer: 0, isMyTurn: true },
      },
      winners: [],
    });
    await nextTick();
    await nextTick();

    const controls = wrapper.findComponent(ControlsTab);
    expect(controls.exists()).toBe(true);
    const seatButtons = controls.find('.player-buttons').findAll('button');
    expect(seatButtons.map((b) => b.text())).toEqual([
      'Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5',
    ]);
    expect(controls.text()).toContain('0 / 5');
    wrapper.unmount();
  });
});
