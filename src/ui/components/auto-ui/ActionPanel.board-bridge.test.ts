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
import { defineComponent, h, nextTick, provide, ref, watch } from 'vue';
import ActionPanel from './ActionPanel.vue';
import { useActionController } from '../../composables/useActionController.js';
import { useBoardActionBridge } from '../../composables/useBoardActionBridge.js';
import {
  createBoardInteraction,
  provideBoardInteraction,
  type BoardInteraction,
} from '../../composables/useBoardInteraction.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import type { EnrichedActionMetadata, PickStepResponse } from '../../composables/useActionControllerTypes.js';
import type { FollowUpOffer } from '../../../engine/action/types.js';

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

const moveAction: EnrichedActionMetadata = {
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
const tendAction: EnrichedActionMetadata = {
  name: 'tend',
  prompt: 'Tend',
  selections: [{ name: 'plot', type: 'element', prompt: 'Choose a plot' }],
};

// Board-startable: clicking one of its plots on the board starts the action
// through the BRIDGE's own startAction -- the path the panel must not be fixed
// at the expense of.
const harvestAction: EnrichedActionMetadata = {
  name: 'harvest',
  prompt: 'Harvest',
  selections: [
    { name: 'plot', type: 'element', prompt: 'Choose a plot' },
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
const waitAction: EnrichedActionMetadata = { name: 'wait', prompt: 'Wait', selections: [] };

// A pick whose onSelect makes the server answer it, after one the player can clear.
const boardAction: EnrichedActionMetadata = {
  name: 'board',
  prompt: 'Board',
  selections: [
    { name: 'ship', type: 'choice', prompt: 'Ship', choices: [{ value: 'dory', display: 'Dory' }, { value: 'skiff', display: 'Skiff' }] },
    { name: 'crew', type: 'choice', prompt: 'Crew', hasOnSelect: true, choices: [{ value: 'ann', display: 'Ann' }, { value: 'bo', display: 'Bo' }] },
  ],
};

const AVAILABLE = ['move', 'tend', 'harvest', 'wait', 'board'];
const METADATA = { move: moveAction, tend: tendAction, harvest: harvestAction, wait: waitAction, board: boardAction };

interface Harness {
  board: BoardInteraction;
  controller: ReturnType<typeof useActionController>;
  wrapper: ReturnType<typeof mount>;
  sendAction: ReturnType<typeof vi.fn>;
  cancelPendingAction: ReturnType<typeof vi.fn>;
}

/**
 * Mount the real panel over the real bridge, exactly as both shells do: the
 * shell creates the board substrate and runs the bridge, and PlayShell mounts
 * the panel inside it.
 */
function mountHarness(pickStep?: () => Promise<PickStepResponse>, heldFollowUp?: FollowUpOffer): Harness {
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const cancelPendingAction = vi.fn().mockResolvedValue(undefined);
  const fetchPickChoices = vi.fn((action: string, selectionName: string) =>
    selectionName === 'plot'
      ? Promise.resolve({ success: true, validElements: action === 'harvest' ? [{ id: 21 }, { id: 22 }] : [{ id: 11 }, { id: 12 }] })
      : Promise.resolve({ success: true, choices: action === 'board' ? boardAction.selections.find(s => s.name === selectionName)?.choices : COMPASS }),
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
        pickStep,
        cancelPendingAction,
        heldFollowUp: ref(heldFollowUp),
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
        runnerIdentity: ref(undefined),
      });
      return () =>
        h(ActionPanel, {
          availableActions: AVAILABLE,
          actionMetadata: METADATA,
          isMyTurn: true,
        });
    },
  });

  const wrapper = mount(Host);
  return { board, controller, wrapper, sendAction, cancelPendingAction };
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

describe("ActionPanel's post-execute clear leaves a newer action alone (#445)", () => {
  it('keeps a pick the board starts the moment the executed action finishes', async () => {
    // A custom board that opens its next pick when `isExecuting` drops (a new
    // round beginning). The controller drops it before the panel's own cleanup
    // runs, so a panel that clears unconditionally wipes the board's new pick and
    // the bridge's external-cancel watcher then cancels it.
    const { board, controller, wrapper, sendAction } = mountHarness();
    await flush();

    const stop = watch(
      () => controller.isExecuting.value,
      (executing, was) => {
        if (was && !executing) void controller.start('tend');
      },
      { flush: 'sync' },
    );

    await wrapper.find('[data-bs-action="wait"]').trigger('click');
    await flush();

    expect(sendAction).toHaveBeenCalledWith('wait', {});
    expect(controller.currentAction.value).toBe('tend');
    expect(board.currentAction).toBe('tend');
    expect(board.validElements.map(e => e.id)).toEqual([11, 12]);
    expect(board.onElementSelect).not.toBeNull();

    stop();
    wrapper.unmount();
  });

  it('still clears the board after an action when nothing newer started', async () => {
    const { board, controller, wrapper } = mountHarness();
    await flush();

    await wrapper.find('[data-bs-action="tend"]').trigger('click');
    await flush();
    expect(board.currentAction).toBe('tend');

    board.triggerElementSelect({ id: 11 });
    await flush();

    expect(controller.currentAction.value).toBeNull();
    expect(board.currentAction).toBeNull();
    // Only what a click can start is left on the board (#1192).
    expect(board.validElements.map(e => e.id)).toEqual([11, 12, 21, 22]);
    wrapper.unmount();
  });
});

describe("ActionPanel's clear of a pick while a later pick's step is out (#1364)", () => {
  it('keeps the action, its picks and the board, as the controller does', async () => {
    let answer!: (reply: PickStepResponse) => void;
    const { board, controller, wrapper, cancelPendingAction } = mountHarness(
      () => new Promise<PickStepResponse>(resolve => { answer = resolve; }),
    );
    await flush();
    await controller.start('board');
    await controller.fill('ship', 'dory');
    const crewFill = controller.fill('crew', 'ann');
    await flush();

    await wrapper.find('.clear-selection-btn').trigger('click');
    await flush();

    expect(controller.currentAction.value).toBe('board');
    expect(board.currentAction).toBe('board');
    expect(cancelPendingAction).not.toHaveBeenCalled();
    expect(controller.lastError.value).toBe('Still waiting for the server to answer your last pick.');
    answer({ success: true });
    await crewFill;
    expect(controller.currentArgs.value).toEqual({ ship: 'dory', crew: 'ann' });
    wrapper.unmount();
  });
});

describe("ActionPanel's chip for a follow-up's server-bound value (#1366)", () => {
  it('has no clear button, as the player cannot clear that value; a pick keeps its own', async () => {
    const { controller, wrapper } = mountHarness(() => Promise.resolve({ success: true }), {
      action: 'loot',
      args: { site: 3 },
      display: { site: 'Old Mill' },
      metadata: {
        name: 'loot',
        prompt: 'Loot',
        selections: [
          { name: 'item', type: 'choice', prompt: 'Item', choices: [{ value: 'rope', display: 'Rope' }, { value: 'lamp', display: 'Lamp' }] },
          { name: 'bag', type: 'choice', prompt: 'Bag', choices: [{ value: 'sack', display: 'Sack' }, { value: 'box', display: 'Box' }] },
        ],
      },
    });
    await flush();
    await controller.fill('item', 'rope');
    await flush();
    expect(controller.currentAction.value).toBe('loot');

    const chips = wrapper.findAll('.selected-value');
    expect(chips).toHaveLength(2);
    expect(chips[0].find('.value-display').text()).toBe('Old Mill');
    expect(chips[0].find('.clear-selection-btn').exists()).toBe(false);
    expect(chips[1].find('.clear-selection-btn').attributes('aria-label')).toBe('Clear item');
    wrapper.unmount();
  });
});
