// @vitest-environment jsdom
/**
 * AFTER A NEW GAME THE PANEL OFFERS THE NEW DEAL, NOT THE OLD ONE (#356).
 *
 * Found in `boardsmith dev` on cribbage: seat 1's Action Panel had the discard
 * multi-select open over six cards, the Dev header's New game dealt a new hand
 * at the same discard step, and the panel went on listing the old six. Ticking
 * two of them sent the old element ids and the move was refused ("Element ID 55
 * is not a valid choice for cards").
 *
 * Wired the way both shells wire it: the real controller, the real bridge and
 * the real panel, fed the runner identity the shell reads off each broadcast.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, provide, ref } from 'vue';
import ActionPanel from './ActionPanel.vue';
import { useActionController } from '../../composables/useActionController.js';
import { useBoardActionBridge, type RunnerIdentity } from '../../composables/useBoardActionBridge.js';
import { createBoardInteraction, provideBoardInteraction } from '../../composables/useBoardInteraction.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import type { ActionMetadata } from '../../composables/useActionControllerTypes.js';

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

const discard: ActionMetadata = {
  name: 'discard',
  prompt: 'Discard to the crib',
  selections: [{ name: 'cards', type: 'elements', prompt: 'Select 2 cards to discard', multiSelect: { min: 2, max: 2 } }],
};
const ACTIONS = ['discard'];
const METADATA = { discard };

/** What the server deals, by card id; the test swaps it for a new game. */
function dealer(first: Record<number, string>) {
  let hand = first;
  return {
    deal(next: Record<number, string>) { hand = next; },
    fetchPickChoices: vi.fn(async () => ({
      success: true,
      validElements: Object.entries(hand).map(([id, display]) => ({ id: Number(id), display })),
      multiSelect: { min: 2, max: 2 },
    })),
  };
}

function mountTable(fetchPickChoices: ReturnType<typeof dealer>['fetchPickChoices']) {
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const runnerIdentity = ref<RunnerIdentity | undefined>({ gameInstanceId: 'deal-1', restoreEpoch: 0 });

  const Table = defineComponent({
    setup() {
      const board = createBoardInteraction();
      provideBoardInteraction(board);
      const controller = useActionController({
        sendAction,
        availableActions: ref(ACTIONS),
        actionMetadata: ref(METADATA),
        isMyTurn: ref(true),
        autoExecute: true,
        fetchPickChoices,
      });
      provide(GAME_CONTEXT_KEYS.actionController, controller);
      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref(METADATA),
        availableActions: ref(ACTIONS),
        disabledActions: ref({}),
        isViewingHistory: ref(false),
        runnerIdentity,
      });
      return () => h(ActionPanel, { availableActions: ACTIONS, actionMetadata: METADATA, playerSeat: 1, isMyTurn: true });
    },
  });

  return { wrapper: mount(Table), sendAction, runnerIdentity };
}

describe('the Action Panel after a new game (#356)', () => {
  it('lists the new hand with nothing ticked, and a fresh pick submits the new ids', async () => {
    const server = dealer({ 55: 'KH', 56: 'JC', 57: '8H', 58: '10H', 59: '6C', 60: '4D' });
    const { wrapper, sendAction, runnerIdentity } = mountTable(server.fetchPickChoices);
    await settle();

    const labels = () => wrapper.findAll('label.multi-select-choice').map((l) => l.text());
    const ticked = () => wrapper.findAll('label.multi-select-choice input').filter((i) => (i.element as HTMLInputElement).checked);
    expect(labels()).toEqual(['KH', 'JC', '8H', '10H', '6C', '4D']);

    // One card ticked, then the host deals a new game at the same step.
    await wrapper.findAll('label.multi-select-choice input')[0].trigger('click');
    await settle();
    expect(ticked()).toHaveLength(1);

    server.deal({ 46: '10C', 47: '8S', 48: 'AH', 49: '6S', 50: '9H', 51: 'JH' });
    runnerIdentity.value = { gameInstanceId: 'deal-2', restoreEpoch: 0 };
    await settle();

    expect(labels()).toEqual(['10C', '8S', 'AH', '6S', '9H', 'JH']);
    expect(ticked()).toHaveLength(0);

    // A fresh pick from the new hand goes through with the new hand's ids: an
    // exact-count multi-select submits itself on the second tick.
    const boxes = wrapper.findAll('label.multi-select-choice input');
    await boxes[0].trigger('click');
    await boxes[2].trigger('click');
    await settle();
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith('discard', { cards: [46, 48] });
    wrapper.unmount();
  });
});
