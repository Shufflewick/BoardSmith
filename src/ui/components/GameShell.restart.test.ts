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
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';
import {
  DEBUG_TABLE_PLAYERS,
  enterIframe,
  leaveIframe,
  mountPlatformShell,
  mountTableWithDebugPanel,
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

describe('a new game ends time travel (#587)', () => {
  /**
   * The dev host does not reload this frame on a restart: "New game" in its
   * header and `debug:restart` both ask the server for a new session and relay
   * its first `game_state` into the same page. A snapshot of the old game left
   * on screen would describe a game that no longer exists, and one with fewer
   * seats than the new game makes the #player-stats slot's player lookup fail.
   */
  it('shows the new game live, with every seat, when it arrives while the debug panel shows history', async () => {
    const statsSeats: number[] = [];
    const playerStats = (slotProps: Record<string, unknown>) => {
      statsSeats.push((slotProps.player as { seat: number }).seat);
      return h('span', { class: 'stats' });
    };
    const { wrapper, debugPanel } = await mountTableWithDebugPanel(
      defineComponent({ name: 'Board', setup: () => () => h('div') }),
      { gameInstanceId: 'game-1' },
      { 'player-stats': playerStats },
    );
    const errors: unknown[] = [];
    wrapper.vm.$.appContext.config.errorHandler = (error) => { errors.push(error); };
    const exposed = wrapper.vm as unknown as { state: { flowState: unknown } | null; players: unknown[] };

    debugPanel.vm.$emit('time-travel', { view: {}, players: DEBUG_TABLE_PLAYERS }, 3, null);
    await nextTick();
    expect(wrapper.find('.time-travel-banner').exists()).toBe(true);

    const newPlayers = [...DEBUG_TABLE_PLAYERS, { name: 'P3', seat: 3 }];
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        source: 'shufflewick',
        type: 'game_state',
        view: {
          flowState: { currentPlayer: 1, awaitingInput: true, availableActions: ['move'] },
          state: {
            view: {}, players: newPlayers, currentPlayer: 1, isMyTurn: true, availableActions: ['move'],
            gameInstanceId: 'game-2',
          },
        },
        winners: [],
      },
    }));
    await flushPromises();

    expect(errors).toEqual([]);
    expect(wrapper.find('.time-travel-banner').exists()).toBe(false);
    expect(exposed.state?.flowState).not.toBeNull();
    expect(exposed.players).toEqual(newPlayers);
    expect(statsSeats.slice(-3).sort()).toEqual([1, 2, 3]);
    wrapper.unmount();
  });
});
