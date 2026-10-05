// @vitest-environment jsdom
/**
 * THE TURN CHIME SOUNDS WHEN THE TURN COMES TO YOU, NOT WHEN THE PAGE LOADS.
 *
 * The first state a page receives says whose turn it already is. Loading (or
 * reloading) the page on your own turn is not the turn arriving, so it stays
 * silent; only a later change from "not your turn" to "your turn" chimes.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { audioService } from '../../client/audio.js';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

function postState(isMyTurn: boolean): void {
  window.dispatchEvent(new MessageEvent('message', {
    data: {
      source: 'shufflewick',
      type: 'game_state',
      view: {
        flowState: { currentPlayer: isMyTurn ? 0 : 1, awaitingInput: true, availableActions: [] },
        state: { view: {}, players: [], currentPlayer: isMyTurn ? 0 : 1, isMyTurn },
      },
      winners: [],
    },
  }));
}

const mounted: Array<{ unmount(): void }> = [];

async function mountAtSeat0() {
  enterIframe();
  const chime = vi.spyOn(audioService, 'playTurnSound').mockResolvedValue(undefined);
  const wrapper = mountPlatformShell();
  mounted.push(wrapper);
  await nextTick();
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'shufflewick', type: 'init', seat: 0 } }));
  await nextTick();
  return { wrapper, chime };
}

afterEach(() => {
  // Unmount here, not at the end of each test: a failing assertion must not
  // leave a shell listening for the next test's messages.
  mounted.splice(0).forEach((w) => w.unmount());
  leaveIframe();
  vi.restoreAllMocks();
});

describe('GameShell turn chime', () => {
  it('stays silent when the first state already says it is your turn (a page load)', async () => {
    const { chime } = await mountAtSeat0();
    postState(true);
    await nextTick();

    expect(chime).not.toHaveBeenCalled();
  });

  it('chimes once when a later state hands you the turn', async () => {
    const { chime } = await mountAtSeat0();
    postState(false);
    await nextTick();
    postState(true);
    await nextTick();

    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('does not chime again while the turn stays yours', async () => {
    const { chime } = await mountAtSeat0();
    postState(false);
    await nextTick();
    postState(true);
    await nextTick();
    postState(true);
    await nextTick();

    expect(chime).toHaveBeenCalledTimes(1);
  });
});
