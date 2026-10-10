// @vitest-environment jsdom
/**
 * BROWSING HISTORY CANCELS THE PICK IN PROGRESS (#553).
 *
 * While the debug panel shows history, the board and the Action Panel are
 * handed no actions and no turn (#516, #520), and the controller refuses every
 * commit. A pick the player had already started stayed open on both anyway:
 * the panel still asked for it beside a past board. Entering history cancels
 * it, as the panel's own Cancel button does, so the panel and a custom board
 * agree; returning to the live position offers the action again. An action
 * the server already holds is the exception: a cancel would reach the live
 * game, so it stays open.
 *
 * Driven on the REAL GameShell with the REAL ActionPanel; the debug panel's own
 * `time-travel` event enters and leaves history.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick, type Ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { useBoardInteraction } from '../composables/useBoardInteraction.js';
import ActionPanel from './auto-ui/ActionPanel.vue';
import {
  DEBUG_TABLE_PLAYERS,
  leaveIframe,
  mountTableWithDebugPanel,
} from './GameShell.platform-mount.test-helper.js';

/** A custom board that draws the action the board interaction says is in progress. */
const PickBoard = defineComponent({
  name: 'PickBoard',
  setup() {
    const board = useBoardInteraction();
    return () => h('div', { 'data-testid': 'board-pick' }, board.currentAction ?? 'none');
  },
});

/** Seat 1's only action, `move`, asks one choice, so auto mode starts it and the pick is open. */
const MOVE_WITH_A_PICK = {
  actionMetadata: {
    move: {
      name: 'move',
      prompt: 'Move',
      selections: [{
        name: 'to',
        type: 'choice',
        prompt: 'Where to?',
        choices: [{ value: 'north', display: 'North' }, { value: 'south', display: 'South' }],
      }],
    },
  },
};

afterEach(() => {
  leaveIframe();
  document.body.innerHTML = '';
});

describe('GameShell cancels the pick in progress while viewing history (#553)', () => {
  it('shows the pick on neither the Action Panel nor the board in history, and offers it again on return', async () => {
    const { wrapper, debugPanel } = await mountTableWithDebugPanel(PickBoard, MOVE_WITH_A_PICK);
    await flushPromises();
    const panel = () => wrapper.findComponent(ActionPanel);
    const boardPick = () => wrapper.find('[data-testid="board-pick"]').text();

    expect(panel().find('.cancel-btn').exists()).toBe(true);
    expect(panel().text()).toContain('Where to?');
    expect(boardPick()).toBe('move');

    debugPanel.vm.$emit('time-travel', { view: {}, players: DEBUG_TABLE_PLAYERS }, 3, null);
    await flushPromises();
    expect(wrapper.find('.time-travel-banner').exists()).toBe(true);
    expect(panel().find('.cancel-btn').exists()).toBe(false);
    expect(panel().text()).not.toContain('Where to?');
    expect(boardPick()).toBe('none');

    debugPanel.vm.$emit('time-travel', null, null, null);
    await flushPromises();
    await nextTick();
    expect(panel().text()).toContain('Where to?');
    expect(boardPick()).toBe('move');
    wrapper.unmount();
  });

  /**
   * A follow-up the server already holds for this seat is open on the server,
   * not only on this page: a cancel would reach the LIVE game and throw the
   * chain away for good. Browsing history must leave it alone.
   */
  it('leaves a server-held follow-up open, sends no cancel, and still has it on return', async () => {
    const { wrapper, debugPanel, posted } = await mountTableWithDebugPanel(PickBoard, {
      followUp: {
        action: 'loot',
        args: {},
        metadata: {
          name: 'loot',
          prompt: 'Loot',
          selections: [{
            name: 'site',
            type: 'choice',
            prompt: 'Loot which site?',
            choices: [{ value: 'cave', display: 'Cave' }, { value: 'ruin', display: 'Ruin' }],
          }],
        },
      },
    });
    await flushPromises();
    // The host answers the follow-up's choice fetch, as a live server does.
    const fetch = posted.find((message) => (message as { op?: string }).op === 'resolve_choices') as { requestId: string };
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        source: 'shufflewick',
        type: 'server_response',
        requestId: fetch.requestId,
        result: { success: true, choices: [{ value: 'cave', display: 'Cave' }, { value: 'ruin', display: 'Ruin' }] },
      },
    }));
    await flushPromises();
    expect(wrapper.findComponent(ActionPanel).text()).toContain('Loot which site?');
    const controller = (wrapper.vm as unknown as { actionController: { currentAction: Ref<string | null>; pendingOnServer: Ref<boolean> } }).actionController;
    expect(controller.currentAction.value).toBe('loot');
    expect(controller.pendingOnServer.value).toBe(true);
    const ops = () => posted.map((message) => (message as { op?: string }).op);

    debugPanel.vm.$emit('time-travel', { view: {}, players: DEBUG_TABLE_PLAYERS }, 3, null);
    await flushPromises();
    debugPanel.vm.$emit('time-travel', null, null, null);
    await flushPromises();

    expect(ops()).not.toContain('cancel_action');
    expect(controller.currentAction.value).toBe('loot');
    expect(controller.pendingOnServer.value).toBe(true);
    expect(wrapper.findComponent(ActionPanel).text()).toContain('Loot which site?');
    wrapper.unmount();
  });
});

describe('GameShell defers a held follow-up that arrives while viewing history (#585)', () => {
  /** The host's message, as a live server sends it. */
  const fromHost = (data: Record<string, unknown>) =>
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'shufflewick', ...data } }));
  const LOOT = {
    name: 'loot',
    prompt: 'Loot',
    selections: [{
      name: 'site',
      type: 'choice',
      prompt: 'Loot which site?',
      choices: [{ value: 'cave', display: 'Cave' }, { value: 'ruin', display: 'Ruin' }],
    }],
  };

  it('opens no pick beside a past board, and opens it on return', async () => {
    const { wrapper, debugPanel, posted } = await mountTableWithDebugPanel(PickBoard, MOVE_WITH_A_PICK);
    await flushPromises();
    const controller = (wrapper.vm as unknown as { actionController: { currentAction: Ref<string | null> } }).actionController;
    // The loot pick's choice fetches: the move pick open at mount fetched its own.
    const fetches = () => posted.filter((message) => {
      const request = message as { op?: string; payload?: { actionName?: string } };
      return request.op === 'resolve_choices' && request.payload?.actionName === 'loot';
    });

    debugPanel.vm.$emit('time-travel', { view: {}, players: DEBUG_TABLE_PLAYERS }, 3, null);
    await flushPromises();
    // The server hands the seat a follow-up while the player looks at the past.
    fromHost({
      type: 'game_state',
      view: {
        flowState: { currentPlayer: 1, awaitingInput: true, availableActions: [] },
        state: {
          view: {}, players: DEBUG_TABLE_PLAYERS, currentPlayer: 1, isMyTurn: true, availableActions: [],
          followUp: { action: 'loot', args: {}, metadata: LOOT },
        },
      },
      winners: [],
    });
    await flushPromises();
    expect(wrapper.find('.time-travel-banner').exists()).toBe(true);
    expect(controller.currentAction.value).toBeNull();
    expect(fetches()).toHaveLength(0);

    debugPanel.vm.$emit('time-travel', null, null, null);
    await flushPromises();
    expect(controller.currentAction.value).toBe('loot');
    const fetch = fetches()[0] as { requestId: string };
    fromHost({
      type: 'server_response',
      requestId: fetch.requestId,
      result: { success: true, choices: [{ value: 'cave', display: 'Cave' }, { value: 'ruin', display: 'Ruin' }] },
    });
    await flushPromises();
    expect(wrapper.findComponent(ActionPanel).text()).toContain('Loot which site?');
    expect(wrapper.find('[data-testid="board-pick"]').text()).toBe('loot');
    wrapper.unmount();
  });
});
