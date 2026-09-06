// @vitest-environment jsdom
/**
 * AN ANCHORED CANDIDATE MUST BE FINDABLE BY WHAT THE PLAYER READS (BoardSmith #189).
 *
 * Since #185 the panel hands an element pick to the BOARD and keeps showing the
 * action list, so the panel has no button for the candidate. #172 requires that
 * placement. The consequence is that the only path into the commonest world verb
 * is a pointer landing on a rendered board: the board writes the element's NAME
 * (`holding-1`) while the panel would have shown its display text (`Holding 1`),
 * so neither a panel button nor a text match finds the candidate.
 *
 * Every other surface of the shell is nameable from outside -- `bs-seats`,
 * `bs-log-line`, `bs-board`, `bs-action-panel`, `data-bs-disabled-reason`. The
 * anchored candidate was the one interaction with no hook at all.
 *
 * These tests wire the REAL controller, the REAL bridge, the REAL board
 * substrate and the REAL AutoUI board under a REAL mounted ActionPanel, because
 * the gap is precisely what reaches the DOM: a mocked board cannot show it.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, provide, ref } from 'vue';
import ActionPanel from '../ActionPanel.vue';
import AutoUI from '../AutoUI.vue';
import { useActionController } from '../../../composables/useActionController.js';
import { useBoardActionBridge } from '../../../composables/useBoardActionBridge.js';
import {
  createBoardInteraction,
  provideBoardInteraction,
  type BoardInteraction,
} from '../../../composables/useBoardInteraction.js';
import { GAME_CONTEXT_KEYS } from '../../../composables/useGameContext.js';
import type { ActionMetadata } from '../../../composables/useActionControllerTypes.js';

async function flush(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

// example-rts's world: holdings the engine names `holding-N` and the panel would
// have labelled `Holding N`. Holding 1 is a leaf (PieceRenderer); Holding 2 owns
// a child so it resolves to SpaceRenderer -- two different renderers, one hook.
const GAME_VIEW = {
  id: 1,
  className: 'World',
  name: 'world',
  children: [
    { id: 11, className: 'Holding', name: 'holding-1', attributes: {}, children: [] },
    {
      id: 12,
      className: 'Holding',
      name: 'holding-2',
      attributes: {},
      children: [{ id: 121, className: 'Log', name: 'log', attributes: {}, children: [] }],
    },
  ],
};

// `tend` chooses a NEIGHBOURING holding by element (#169), and its candidates
// arrive from the server, not from the action metadata.
const tendAction: ActionMetadata = {
  name: 'tend',
  prompt: 'Tend',
  selections: [{ name: 'neighbour', type: 'element', prompt: 'Choose a holding' }],
};

// A no-selection action keeps auto-start out of the way.
const waitAction: ActionMetadata = { name: 'wait', prompt: 'Wait', selections: [] };

const AVAILABLE = ['tend', 'wait'];
const METADATA = { tend: tendAction, wait: waitAction };

interface Harness {
  board: BoardInteraction;
  wrapper: ReturnType<typeof mount>;
  sendAction: ReturnType<typeof vi.fn>;
}

/** Mount the real panel and the real AutoUI board over one bridge, as a shell does. */
function mountHarness(): Harness {
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const fetchPickChoices = vi.fn(() =>
    Promise.resolve({
      success: true,
      validElements: [
        { id: 11, display: 'Holding 1' },
        { id: 12, display: 'Holding 2' },
      ],
    }),
  );

  let board!: BoardInteraction;

  const Host = defineComponent({
    name: 'CandidateHookHost',
    setup() {
      board = createBoardInteraction();
      provideBoardInteraction(board);
      const controller = useActionController({
        sendAction,
        availableActions: ref(AVAILABLE),
        actionMetadata: ref(METADATA),
        isMyTurn: ref(true),
        autoFill: false,
        autoExecute: true,
        fetchPickChoices,
      });
      provide(GAME_CONTEXT_KEYS.actionController, controller);
      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(false),
        actionMetadata: ref(METADATA),
        availableActions: ref(AVAILABLE),
        disabledActions: ref({}),
        isViewingHistory: ref(false),
        restoreEpoch: ref(undefined),
      });
      return () =>
        h('div', [
          h(ActionPanel, {
            availableActions: AVAILABLE,
            actionMetadata: METADATA,
            playerSeat: 0,
            isMyTurn: true,
            autoEndTurn: false,
          }),
          h(AutoUI, { gameView: GAME_VIEW, playerSeat: 0 }),
        ]);
    },
  });

  const wrapper = mount(Host, { attachTo: document.body });
  return { board, wrapper, sendAction };
}

describe('an anchored candidate carries a stable hook (#189)', () => {
  it('is findable by the display text the panel would have shown', async () => {
    const { wrapper } = mountHarness();
    await flush();

    await wrapper.find('[data-bs-action="tend"]').trigger('click');
    await flush();

    // The panel yields to the board, so nothing in the panel names the holding.
    const hits = wrapper.findAll('[data-bs-candidate="Holding 1"]');
    expect(hits).toHaveLength(1);
    expect(hits[0].attributes('data-bs-el-id')).toBe('11');

    wrapper.unmount();
  });

  it('answers the selection when that candidate is pressed', async () => {
    const { wrapper, sendAction } = mountHarness();
    await flush();

    await wrapper.find('[data-bs-action="tend"]').trigger('click');
    await flush();

    await wrapper.find('[data-bs-candidate="Holding 2"]').trigger('click');
    await flush();

    expect(sendAction).toHaveBeenCalledWith('tend', { neighbour: 12 });
    wrapper.unmount();
  });

  it('marks every candidate and nothing else', async () => {
    const { wrapper } = mountHarness();
    await flush();

    await wrapper.find('[data-bs-action="tend"]').trigger('click');
    await flush();

    const labels = wrapper
      .findAll('[data-bs-candidate]')
      .map(w => w.attributes('data-bs-candidate'))
      .sort();
    // The two holdings -- not the world that contains them, nor the log inside one.
    expect(labels).toEqual(['Holding 1', 'Holding 2']);

    wrapper.unmount();
  });

  it('leaves no candidate hook behind when the pick is over', async () => {
    const { board, wrapper } = mountHarness();
    await flush();

    await wrapper.find('[data-bs-action="tend"]').trigger('click');
    await flush();
    expect(wrapper.findAll('[data-bs-candidate]').length).toBe(2);

    board.clear();
    await flush();

    expect(wrapper.findAll('[data-bs-candidate]')).toHaveLength(0);
    wrapper.unmount();
  });
});
