// @vitest-environment jsdom
/**
 * EVERY SURFACE OF THE SHELL SHOWS A SEAT THE SAME WAY (#1044).
 *
 * A seat with no name is "Player <seat>", seats start at 1, and its token is
 * the seat's PlayerToken. The action bar once wrote `Player ${seat + 1}` while
 * the game-over announcement wrote `Player ${seat}`, so seat 2 was "Player 3"
 * on its turn and "Player 2" when it won. Asserted on the REAL GameShell.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

const PLAYERS = [
  { seat: 1, name: 'Ann' },
  { seat: 2, name: '' },
];

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
}

const mounted: Array<{ unmount(): void }> = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  leaveIframe();
});

describe('an unnamed seat in the shell', () => {
  it('is "Player 2" on its turn and when it wins, with the same token', async () => {
    enterIframe();
    const wrapper = mountPlatformShell();
    mounted.push(wrapper);
    await nextTick();
    post({ type: 'init', seat: 2 });
    await settle();
    post({
      type: 'game_state',
      view: {
        flowState: { awaitingInput: true, complete: false, currentPlayer: 2, availableActions: ['play'] },
        state: { view: {}, players: PLAYERS, currentPlayer: 2, isMyTurn: true, availableActions: ['play'] },
      },
      winners: [],
    });
    await settle();
    expect(wrapper.find('.turn-token .ini').text()).toBe('2');

    post({
      type: 'game_state',
      view: {
        flowState: { awaitingInput: false, complete: true, winners: [2] },
        state: { view: {}, players: PLAYERS, isMyTurn: false, availableActions: [] },
      },
      winners: [2],
    });
    await settle();
    expect(wrapper.find('#game-over-title').text()).toBe('Player 2 wins');
    expect(wrapper.find('.game-over-card .ini').text()).toBe('2');
  });
});
