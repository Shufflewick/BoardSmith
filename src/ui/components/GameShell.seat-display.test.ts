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
  { seat: 1, name: 'Ann', color: '#e74c3c' },
  { seat: 2, name: '', color: '#3498db' },
];
const SEAT_2_COLOUR = 'rgb(52, 152, 219)';

async function mountAsSeat(seat: number) {
  enterIframe();
  const wrapper = mountPlatformShell();
  mounted.push(wrapper);
  await nextTick();
  post({ type: 'init', seat });
  await settle();
  return wrapper;
}

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
    const wrapper = await mountAsSeat(2);
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

  it('is named "Player 2" on its player card while it is its turn (#906)', async () => {
    const wrapper = await mountAsSeat(1);
    post({
      type: 'game_state',
      view: {
        flowState: { awaitingInput: true, complete: false, currentPlayer: 2, availableActions: ['play'] },
        state: { view: {}, players: PLAYERS, currentPlayer: 2, isMyTurn: false, availableActions: [] },
      },
      winners: [],
    });
    await settle();
    // The action bar is down while another seat acts in a turn-based step, so
    // the seat's turn is told by its player card.
    expect(wrapper.find('.waiting-message').exists()).toBe(false);
    const cards = wrapper.findAll('.side-scroll .player-card');
    expect(cards.map((c) => c.find('.player-name').text())).toEqual(['Ann', 'Player 2']);
    expect(cards[1].find('.turn-status').text()).toBe('Player 2 is playing');
  });

  it('is named "Player 2" in the waiting line of a simultaneous step', async () => {
    const wrapper = await mountAsSeat(1);
    post({
      type: 'game_state',
      view: {
        flowState: {
          awaitingInput: true,
          complete: false,
          awaitingPlayers: [
            { playerIndex: 1, availableActions: ['discard'], completed: true },
            { playerIndex: 2, availableActions: ['discard'], completed: false },
          ],
        },
        state: { view: {}, players: PLAYERS, isMyTurn: false, availableActions: [] },
      },
      winners: [],
    });
    await settle();
    const seats = wrapper.findAll('.waiting-message .awaiting-seat');
    expect(seats.map((s) => s.text())).toEqual(['Player 2']);
    expect(seats[0].attributes('style')).toContain(SEAT_2_COLOUR);
  });
});
