// @vitest-environment jsdom
/**
 * PANEL-STARTED AND BOARD-STARTED ACTIONS MUST LEAVE THE BOARD IN THE SAME STATE
 * (BoardSmith #185).
 *
 * CLAUDE.md: "All UI interactions must work in a Custom UI and Action Panel in
 * parity with shared state through useBoardInteraction." That parity is exactly
 * what broke: `ActionPanel.startAction` called `boardInteraction.clear()` AFTER
 * `await actionController.start(...)` and then put back the action name alone.
 *
 * The bridge populates the board from INSIDE that await -- watcher E sets
 * `currentAction` and `onChoiceSelect`, watcher D sets `validElements` and
 * `onElementSelect` -- so the late `clear()` wiped all four, and neither watcher
 * re-ran because from their point of view nothing had changed. The board was
 * then dead for the whole action while `currentAction` still read the action's
 * name, so a custom board could not even detect the state to avoid drawing a
 * control it could not answer with.
 *
 * Measured in the field during #174: example-rts's `tend` pick never opened, and
 * sotf's compass rose rendered but refused every click.
 *
 * These tests wire the REAL controller + REAL bridge + REAL board substrate
 * under a REAL mounted ActionPanel, because that combination is the bug: a
 * mocked controller never suspends inside `start()`, which is where the whole
 * defect lives.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, provide, ref } from 'vue';
import ActionPanel from './ActionPanel.vue';
import { useActionController } from '../../composables/useActionController.js';
import { useBoardActionBridge } from '../../composables/useBoardActionBridge.js';
import {
  createBoardInteraction,
  provideBoardInteraction,
  type BoardInteraction,
} from '../../composables/useBoardInteraction.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import type { ActionMetadata } from '../../composables/useActionControllerTypes.js';

async function flush(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

// sotf's `move`: one choice pick whose options are compass directions the board
// draws itself. Every option carries a notation ref, so the panel routes them to
// its anchored list and the BOARD is the primary surface.
const COMPASS = [
  { value: 'north', display: 'North', refs: [{ ref: { notation: 'n' }, role: 'target' as const }] },
  { value: 'south', display: 'South', refs: [{ ref: { notation: 's' }, role: 'target' as const }] },
];

const moveAction: ActionMetadata = {
  name: 'move',
  prompt: 'Walk one sector',
  selections: [
    {
      name: 'direction',
      type: 'choice',
      prompt: 'Which way?',
      choices: COMPASS,
    },
  ],
};

// example-rts's `tend`: one element pick whose candidates arrive from the server.
const tendAction: ActionMetadata = {
  name: 'tend',
  prompt: 'Tend',
  selections: [{ name: 'plot', type: 'element', prompt: 'Choose a plot' }],
};

// Board-startable: its first pick is an element the metadata already names, so
// clicking that element on the board starts the action through the BRIDGE's own
// startAction -- the path the panel must not be fixed at the expense of.
const harvestAction: ActionMetadata = {
  name: 'harvest',
  prompt: 'Harvest',
  selections: [
    { name: 'plot', type: 'element', prompt: 'Choose a plot', validElements: [{ id: 21 }, { id: 22 }] },
    {
      name: 'direction',
      type: 'choice',
      prompt: 'Which way?',
      choices: COMPASS,
    },
  ],
};

// A no-selection action keeps auto-start out of the way, so every start under
// test is the one the test performed.
const waitAction: ActionMetadata = { name: 'wait', prompt: 'Wait', selections: [] };

const AVAILABLE = ['move', 'tend', 'harvest', 'wait'];
const METADATA = { move: moveAction, tend: tendAction, harvest: harvestAction, wait: waitAction };

interface Harness {
  board: BoardInteraction;
  controller: ReturnType<typeof useActionController>;
  wrapper: ReturnType<typeof mount>;
  sendAction: ReturnType<typeof vi.fn>;
}

/**
 * Mount the real panel over the real bridge, exactly as both shells do: the
 * shell creates the board substrate and runs the bridge, and PlayShell mounts
 * the panel inside it.
 */
function mountHarness(): Harness {
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const fetchPickChoices = vi.fn((_action: string, selectionName: string) =>
    selectionName === 'plot'
      ? Promise.resolve({ success: true, validElements: [{ id: 11 }, { id: 12 }] })
      : Promise.resolve({ success: true, choices: COMPASS }),
  );

  let board!: BoardInteraction;
  let controller!: ReturnType<typeof useActionController>;

  const Host = defineComponent({
    name: 'BridgeHost',
    setup() {
      board = createBoardInteraction();
      provideBoardInteraction(board);
      controller = useActionController({
        sendAction,
        availableActions: ref(AVAILABLE),
        actionMetadata: ref(METADATA),
        isMyTurn: ref(true),
        autoFill: false,
        // Matches GameShell: once every pick is filled the action goes.
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
        h(ActionPanel, {
          availableActions: AVAILABLE,
          actionMetadata: METADATA,
          playerSeat: 0,
          isMyTurn: true,
          autoEndTurn: false,
        });
    },
  });

  const wrapper = mount(Host);
  return { board, controller, wrapper, sendAction };
}

describe('ActionPanel start leaves the board wired (#185)', () => {
  it('keeps the choice callback a custom board answers with (sotf compass)', async () => {
    const { board, wrapper, sendAction } = mountHarness();
    await flush();

    await wrapper.find('[data-bs-action="move"]').trigger('click');
    await flush();

    expect(board.currentAction).toBe('move');
    expect(board.currentPickName).toBe('direction');
    // The documented way for a custom board to answer a non-element choice.
    // Pre-fix this was null while `currentAction` still read 'move'.
    expect(board.onChoiceSelect).not.toBeNull();

    board.triggerChoiceSelect('direction', 'north');
    await flush();
    expect(sendAction).toHaveBeenCalledWith('move', { direction: 'north' });
    wrapper.unmount();
  });

  it('keeps the element candidates a board click needs (example-rts tend)', async () => {
    const { board, wrapper, sendAction } = mountHarness();
    await flush();

    await wrapper.find('[data-bs-action="tend"]').trigger('click');
    await flush();

    expect(board.currentAction).toBe('tend');
    // Pre-fix: 0 valid elements and a null callback, so the pick "never opened".
    expect(board.validElements.map(e => e.id)).toEqual([11, 12]);
    expect(board.onElementSelect).not.toBeNull();

    board.triggerElementSelect({ id: 11 });
    await flush();
    expect(sendAction).toHaveBeenCalledWith('tend', { plot: 11 });
    wrapper.unmount();
  });

  it('still works when the BOARD starts the action, not the panel', async () => {
    // The other half of the parity rule: fixing the panel must not cost the
    // board-started path, which reaches the same sequence through the bridge.
    const { board, wrapper } = mountHarness();
    await flush();

    board.selectElement({ id: 21 });
    await flush();

    expect(board.currentAction).toBe('harvest');
    expect(board.currentPickName).toBe('direction');
    expect(board.onChoiceSelect).not.toBeNull();
    wrapper.unmount();
  });

  it('leaves no candidates from an abandoned action behind', async () => {
    // What the panel's late clear() was reaching for -- and doing it BEFORE the
    // start achieves it without wiping what the start just wired.
    const { board, controller, wrapper } = mountHarness();
    await flush();

    await wrapper.find('[data-bs-action="tend"]').trigger('click');
    await flush();
    expect(board.validElements.map(e => e.id)).toEqual([11, 12]);

    controller.cancel();
    await flush();

    await wrapper.find('[data-bs-action="move"]').trigger('click');
    await flush();

    expect(board.currentAction).toBe('move');
    expect(board.currentPickName).toBe('direction');
    // The compass points, not the plots the player walked away from.
    expect(board.validElements.map(e => e.ref.notation).sort()).toEqual(['n', 's']);
    wrapper.unmount();
  });
});
