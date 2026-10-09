// @vitest-environment jsdom
/**
 * THE ACTION PANEL AND THE BOARD BRIDGE START AND EXECUTE ACTIONS THROUGH ONE
 * MODULE (BoardSmith #513).
 *
 * They used to hold two copies of start, execute, set-selection and the
 * multi-select toggle, and the copies drifted: #445's fix reached only the
 * panel's post-execute clear, so the bridge still wiped a pick a custom board
 * started the moment `isExecuting` dropped.
 *
 * Every test here runs the REAL controller, the REAL bridge and the REAL board
 * substrate. A fake controller never suspends inside `execute()`, which is where
 * the race lives.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, effectScope, h, provide, ref, watch, nextTick } from 'vue';
import ActionPanel from '../components/auto-ui/ActionPanel.vue';
import { useActionController } from './useActionController.js';
import { useBoardActionBridge } from './useBoardActionBridge.js';
import { createBoardInteraction, provideBoardInteraction, type BoardInteraction } from './useBoardInteraction.js';
import { GAME_CONTEXT_KEYS } from './useGameContext.js';
import type { EnrichedActionMetadata } from './useActionControllerTypes.js';

async function flush(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

const waitAction: EnrichedActionMetadata = { name: 'wait', prompt: 'Wait', selections: [] };
const tendAction: EnrichedActionMetadata = {
  name: 'tend',
  prompt: 'Tend',
  selections: [{ name: 'plot', type: 'element', prompt: 'Choose a plot' }],
};
const METADATA = { wait: waitAction, tend: tendAction };

describe("the bridge's post-execute clear leaves a newer action alone (#445 on the bridge path)", () => {
  it('keeps a pick a custom board starts the moment the auto-executed action finishes', async () => {
    // `wait` is the sole action and has no picks, so the bridge auto-executes it.
    // Resolving it opens a new round that offers `tend`, and the custom board
    // opens that pick the moment `isExecuting` drops -- before the bridge's own
    // post-execute cleanup has run.
    const availableActions = ref<string[]>(['wait']);
    const sendAction = vi.fn(async () => {
      availableActions.value = ['wait', 'tend'];
      return { success: true };
    });
    const fetchPickChoices = vi.fn(async () => ({ success: true, validElements: [{ id: 11 }, { id: 12 }] }));

    const scope = effectScope();
    const board = createBoardInteraction();
    const controller = scope.run(() => {
      const c = useActionController({
        sendAction,
        availableActions,
        actionMetadata: ref(METADATA),
        isMyTurn: ref(true),
        autoFill: false,
        autoExecute: true,
        fetchPickChoices,
      });
      useBoardActionBridge({
        controller: c,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref(METADATA),
        availableActions,
        disabledActions: ref(undefined),
        isViewingHistory: ref(false),
        runnerIdentity: ref(undefined),
      });
      watch(
        () => c.isExecuting.value,
        (executing, was) => {
          if (was && !executing) void c.start('tend');
        },
        { flush: 'sync' },
      );
      return c;
    })!;

    await flush();

    expect(sendAction).toHaveBeenCalledWith('wait', {});
    expect(controller.currentAction.value).toBe('tend');
    expect(board.currentAction).toBe('tend');
    expect(board.validElements.map(e => e.id)).toEqual([11, 12]);

    scope.stop();
  });
});

// ---------------------------------------------------------------------------
// Parity: the same gesture through the panel and through the board leaves the
// controller and the board in the same state.
// ---------------------------------------------------------------------------

type Surface = 'panel' | 'board';

// `scout`'s first pick is an element the metadata names, so clicking it on the
// board starts the action through the bridge.
const DIRECTIONS = [{ value: 'n', display: 'North' }];
const scoutAction: EnrichedActionMetadata = {
  name: 'scout',
  prompt: 'Scout',
  selections: [
    { name: 'unit', type: 'element', prompt: 'Which unit?', validElements: [{ id: 5 }] },
    { name: 'dir', type: 'choice', prompt: 'Which way?', choices: DIRECTIONS },
  ],
};

// `aim`'s first pick has no static choices: they are fetched, and the one offered
// names board element 31.
const aimAction: EnrichedActionMetadata = {
  name: 'aim',
  prompt: 'Aim',
  selections: [
    { name: 'target', type: 'choice', prompt: 'Aim at?' },
    { name: 'power', type: 'choice', prompt: 'How hard?', choices: [{ value: 1, display: 'Soft' }, { value: 2, display: 'Hard' }] },
  ],
};
const TOWER = { value: 't31', display: 'Tower', refs: [{ ref: { id: 31 }, role: 'target' as const }] };

const PARITY_METADATA = { scout: scoutAction, aim: aimAction, wait: waitAction };

interface ParityOptions {
  availableActions: string[];
  autoEndTurn?: boolean;
  heldFollowUp?: { action: string; args: Record<string, unknown>; metadata: EnrichedActionMetadata };
  completed?: boolean;
  isViewingHistory?: boolean;
  disabledActions?: Record<string, string>;
}

/** The real controller, bridge and board, with the real panel mounted over them. */
function mountTable(opts: ParityOptions) {
  const sendAction = vi.fn(async () => ({ success: true }));
  const fetchPickChoices = vi.fn(async (_action: string, selectionName: string) =>
    selectionName === 'target' ? { success: true, choices: [TOWER] } : { success: true, choices: DIRECTIONS },
  );
  const availableActions = ref(opts.availableActions);
  const isViewingHistory = ref(opts.isViewingHistory ?? false);
  const completed = ref(opts.completed ?? false);
  const disabledActions = ref(opts.disabledActions);
  const metadata = ref(PARITY_METADATA);

  let board!: BoardInteraction;
  let controller!: ReturnType<typeof useActionController>;
  const Host = defineComponent({
    setup() {
      board = createBoardInteraction();
      provideBoardInteraction(board);
      controller = useActionController({
        sendAction,
        fetchPickChoices,
        availableActions,
        actionMetadata: metadata,
        disabledActions,
        heldFollowUp: ref(opts.heldFollowUp),
        isMyTurn: ref(true),
        completed,
        isViewingHistory,
        autoFill: false,
        autoExecute: true,
      });
      provide(GAME_CONTEXT_KEYS.actionController, controller);
      provide(GAME_CONTEXT_KEYS.isViewingHistory, isViewingHistory);
      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(opts.autoEndTurn ?? false),
        actionMetadata: metadata,
        availableActions,
        disabledActions,
        isViewingHistory,
        completed,
        runnerIdentity: ref(undefined),
      });
      return () =>
        h(ActionPanel, {
          availableActions: availableActions.value,
          actionMetadata: metadata.value,
          disabledActions: disabledActions.value,
          playerSeat: 1,
          isMyTurn: true,
          completed: completed.value,
          autoEndTurn: false,
        });
    },
  });
  const wrapper = mount(Host);
  return { board, controller, wrapper, sendAction };
}

function stateOf(t: ReturnType<typeof mountTable>) {
  return {
    action: t.controller.currentAction.value,
    pick: t.controller.currentPick.value?.name ?? null,
    args: { ...t.controller.currentArgs.value },
    pendingOnServer: t.controller.pendingOnServer.value,
    sent: t.sendAction.mock.calls.length,
    boardAction: t.board.currentAction,
    boardSelected: t.board.selectedElement ? { ...t.board.selectedElement } : null,
  };
}

describe.each<Surface>(['panel', 'board'])('the same gesture through the %s', (surface) => {
  it('starts a held follow-up as the follow-up, with its pre-filled args', async () => {
    const t = mountTable({
      availableActions: ['scout', 'wait'],
      heldFollowUp: { action: 'scout', args: { unit: 5 }, metadata: scoutAction },
    });
    await flush();
    // The held follow-up auto-starts once; the player cancels it.
    expect(t.controller.currentAction.value).toBe('scout');
    t.controller.cancel();
    await flush();
    expect(t.controller.currentAction.value).toBeNull();

    if (surface === 'panel') await t.wrapper.find('[data-bs-action="scout"]').trigger('click');
    else t.board.selectElement({ id: 5 });
    await flush();

    expect(stateOf(t)).toMatchObject({
      action: 'scout',
      pick: 'dir',
      args: { unit: 5 },
      pendingOnServer: true,
      sent: 0,
      boardAction: 'scout',
    });
    t.wrapper.unmount();
  });

  it('marks a fetched choice on the board once it is chosen', async () => {
    const t = mountTable({ availableActions: ['aim', 'wait'] });
    await flush();
    await t.controller.start('aim');
    await flush();
    expect(t.board.validElements.map(e => e.id)).toEqual([31]);

    if (surface === 'panel') {
      const tower = t.wrapper.findAll('.choice-btn').find(b => b.text() === 'Tower');
      await tower!.trigger('click');
    } else {
      t.board.triggerElementSelect({ id: 31 });
    }
    await flush();

    expect(stateOf(t)).toMatchObject({
      action: 'aim',
      pick: 'power',
      args: { target: 't31' },
      sent: 0,
      boardAction: 'aim',
      boardSelected: { id: 31 },
    });
    t.wrapper.unmount();
  });

  // The panel presses the `wait` button; the board path is the bridge's
  // auto-execute of a sole no-selection action.
  it.each([
    ['the seat has committed the step', { completed: true }],
    ['the action is disabled', { disabledActions: { wait: 'Not yet.' } }],
    ['the seat is viewing history', { isViewingHistory: true }],
  ] as const)('sends nothing and changes nothing when %s', async (_why, guard) => {
    const t = mountTable({ availableActions: ['wait'], autoEndTurn: surface === 'board', ...guard });
    await flush();
    if (surface === 'panel') await t.wrapper.find('[data-bs-action="wait"]').trigger('click');
    await flush();

    expect(stateOf(t)).toEqual({
      action: null,
      pick: null,
      args: {},
      pendingOnServer: false,
      sent: 0,
      boardAction: null,
      boardSelected: null,
    });
    t.wrapper.unmount();
  });
});
