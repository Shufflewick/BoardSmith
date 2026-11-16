// @vitest-environment jsdom
/**
 * A HARNESS WIRED WITH useTableActionWiring CONNECTS ITS BOARD'S HOLDS (#1462).
 *
 * A game's a11y or keyboard test wires a seat with `useTableActionWiring` and
 * mounts its board with an Action Panel. `provideTableActionWiring` publishes
 * what that board and panel inject from the wiring, the holds register among
 * them, so a board's `useActionHolds` greys out the harness's panel and its
 * controller cancels a held draft. Inside a real GameShell, the harness's
 * provide is the nearer one, so the holds go to the harness's wiring.
 *
 * It also reports what the board draws, offers and takes whole to the wiring's
 * board interaction (#1678), as the shell reports its own board to the shell's,
 * so the harness's panel can hand a long pick to the board.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { computed, defineComponent, h, provide, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { PlayerGameState } from '../../session/types.js';
import { MoveGame } from '../../session/move-game.test-helper.js';
import ActionPanel from '../components/auto-ui/ActionPanel.vue';
import { leaveIframe, mountTableWithDebugPanel } from '../components/GameShell.platform-mount.test-helper.js';
import { useActionHolds } from './actionHolds.js';
import { anchorAttrs, candidateAttrs, createBoardInteraction, pickSurfaceAttrs, type BoardInteraction } from './useBoardInteraction.js';
import { GAME_CONTEXT_KEYS } from './useGameContext.js';
import { provideTableActionWiring, useTableActionWiring, type TableActionWiring } from './useTableActionWiring.js';
import { settle, startTable } from './table-wiring.test-helper.js';

const WAIT = 'Moving waits until the battle playback ends.';

const ReplayBoard = defineComponent({
  setup() {
    const replaying = ref(false);
    useActionHolds(() => (replaying.value ? { move: WAIT } : null));
    return () => h('div', [
      h('button', { 'data-testid': 'replay', onClick: () => { replaying.value = !replaying.value; } }, 'Replay'),
      h('p', { ...anchorAttrs({ id: 11 }) }, 'Shown only'),
      h('button', { ...anchorAttrs({ id: 12 }), ...candidateAttrs('Pick 12') }, '12'),
      h('p', pickSurfaceAttrs('destination'), 'The field'),
    ]);
  },
});

/** Seat 1 of a live MoveGame table, wired and provided the way build/test.md shows a game's harness. */
async function harness(): Promise<{ Harness: ReturnType<typeof defineComponent>; wiring: () => TableActionWiring; board: BoardInteraction }> {
  const session = await startTable(MoveGame, 'bs1462');
  const seatState = ref(session.playerState(1)) as Ref<PlayerGameState>;
  let wiring: TableActionWiring | undefined;
  const board = createBoardInteraction();
  const Harness = defineComponent({
    inheritAttrs: false,
    setup() {
      const wired = useTableActionWiring({
        seatState,
        availableActions: computed(() => seatState.value.availableActions ?? []),
        isMyTurn: computed(() => seatState.value.isMyTurn),
        playerSeat: ref(1),
        boardInteraction: board,
        autoEndTurn: ref(false),
        isViewingHistory: ref(false),
        sendAction: (actionName, args) => session.send(1, { type: 'action', actionName, player: 1, args }),
        fetchPickChoices: (actionName, selectionName, player, args) =>
          session.send(player, { type: 'resolveChoices', actionName, selectionName, player, args }),
      });
      const boardEl = ref<HTMLElement | null>(null);
      provideTableActionWiring(wired, boardEl);
      // The Action Panel reads the controller from the game context, which no shell provides here.
      provide(GAME_CONTEXT_KEYS.actionController, wired.controller);
      wiring = wired;
      return () =>
        h('div', { 'data-testid': 'harness' }, [
          h('div', { ref: boardEl }, [h(ReplayBoard)]),
          h(ActionPanel, {
            availableActions: seatState.value.availableActions ?? [],
            actionMetadata: wired.actionMetadata.value,
            disabledActions: wired.disabledActions.value,
            isMyTurn: !!seatState.value.isMyTurn,
          }),
        ]);
    },
  });
  return { Harness, wiring: () => wiring!, board };
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  leaveIframe();
  document.body.innerHTML = '';
});

describe('a harness wired with useTableActionWiring (#1462)', () => {
  it("greys out the held action in the harness's panel and cancels a held draft", async () => {
    const { Harness, wiring } = await harness();
    const wrapper = mount(Harness, { attachTo: document.body });
    mounted.push(wrapper);
    await settle();
    const move = () => wrapper.get('[data-bs-action="move"]');

    await move().trigger('click');
    await settle();
    expect(wiring().controller.currentAction.value).toBe('move');

    await wrapper.get('[data-testid="replay"]').trigger('click');
    await settle();
    expect(wiring().controller.currentAction.value).toBeNull();
    expect(wiring().controller.holdNotice.value?.reason).toBe(WAIT);
    // The held action sits in the panel's "not available yet" fold (#1638).
    await wrapper.get('[data-bs-unavailable-toggle]').trigger('click');
    expect(move().attributes('aria-disabled')).toBe('true');
    expect(move().attributes('data-bs-disabled-reason')).toBe(WAIT);
  });

  it("inside a real GameShell, the board's holds reach the harness's wiring, not the shell's", async () => {
    const { Harness } = await harness();
    const { wrapper } = await mountTableWithDebugPanel(Harness, {
      availableActions: ['move', 'pass'],
      actionMetadata: {
        move: { name: 'move', prompt: 'Move', selections: [] },
        pass: { name: 'pass', prompt: 'Pass', selections: [] },
      },
    });
    mounted.push(wrapper);
    await settle();
    await wrapper.get('[data-testid="replay"]').trigger('click');
    await settle();
    await wrapper.get('[data-testid="harness"] [data-bs-unavailable-toggle]').trigger('click');

    const harnessMove = wrapper.get('[data-testid="harness"] [data-bs-action="move"]');
    expect(harnessMove.attributes('data-bs-disabled-reason')).toBe(WAIT);
    const shellMove = wrapper.findAll('[data-bs-action="move"]').filter((button) => !button.element.closest('[data-testid="harness"]'));
    expect(shellMove).toHaveLength(1);
    expect(shellMove[0].attributes('aria-disabled')).toBeUndefined();
  });

  it("inside a real GameShell, what the board draws, offers and takes whole reaches the harness's board interaction (#1678)", async () => {
    const { Harness, board } = await harness();
    const { wrapper } = await mountTableWithDebugPanel(Harness, {
      availableActions: ['move', 'pass'],
      actionMetadata: {
        move: { name: 'move', prompt: 'Move', selections: [] },
        pass: { name: 'pass', prompt: 'Pass', selections: [] },
      },
    });
    mounted.push(wrapper);
    await settle();
    expect(board.isDrawn({ id: 11 })).toBe(true);
    expect(board.isOffered({ id: 11 })).toBe(false);
    expect(board.isOffered({ id: 12 })).toBe(true);
    expect(board.isPickSurface('destination')).toBe(true);

    wrapper.unmount();
    mounted.splice(mounted.indexOf(wrapper), 1);
    expect(board.isDrawn({ id: 11 })).toBe(false);
    expect(board.isPickSurface('destination')).toBe(false);
  });
});
