// @vitest-environment jsdom
/**
 * BROWSING HISTORY CANCELS THE PICK IN PROGRESS (#553).
 *
 * While the debug panel shows history, the board and the Action Panel are
 * handed no actions and no turn (#516, #520), and the controller refuses every
 * commit. A pick the player had already started stayed open on both anyway:
 * the panel still asked for it beside a past board. Entering history cancels
 * it, as the panel's own Cancel button does, so the panel and a custom board
 * agree; returning to the live position offers the action again.
 *
 * Driven on the REAL GameShell with the REAL ActionPanel; the debug panel's own
 * `time-travel` event enters and leaves history.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
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
});
