// @vitest-environment jsdom
/**
 * B18: a custom board is a PEER of the auto-UI during time travel.
 *
 * Bug: `isViewingHistory` reached every consumer BUT the custom board. The auto
 * ActionPanel got `isViewingHistory ? [] : availableActions` and
 * `isMyTurn && !isViewingHistory`; the bridge took it as an option; `handleUndo`
 * refused outright while it was true. The `<component :is="selectedUiComponent">`
 * board got the HISTORICAL `gameView` with `is-my-turn` and `available-actions`
 * UNGATED, plus the LIVE `flowState`.
 *
 * Two symptoms, both real:
 *   1. A board that reacts to its own `gameView` changing cannot tell "the game
 *      moved" from "the player clicked a log line", so a read-only browse fires
 *      whatever the board does on a real change.
 *   2. Worse: every control the board gates on `is-my-turn`/`available-actions`
 *      stays LIVE during a browse while everything it DRAWS is historical. The
 *      board offers a real, clickable move positioned from a state that is no
 *      longer true, and the click commits against the live game.
 *
 * The only signal that did distinguish the two modes was indirect — a nulled
 * `displayedState.flowState`, which a game discovers by reading GameShell's
 * source. Games worked around it by re-deriving, from that nulled field, a
 * decision the shell already makes two lines away.
 *
 * The shell's wiring is asserted on the real shell (see below); the harness
 * here proves a board that reads those props withdraws its controls.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, ref, computed, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

// The shell's side, that the board is handed `isViewingHistory` and every
// actionability prop gated on it, and the DISPLAYED (nulled) flow state rather
// than the live one, is asserted on the real GameShell in
// `../board-props.shells.test.ts` (#516): the board's props are built by one
// typed function from `useTableSeat`'s gated values. This file holds the
// board's side: a board gated this way goes inert on a browse.

// ── Behaviour: a board gated this way cannot offer a live control on a browse ─

/**
 * Renders a board from the gating `useTableSeat` applies, so the claim under
 * test is behavioural: a board that gates its controls on the props it is
 * handed goes inert the moment the player browses history.
 */
const BoardGatingHarness = defineComponent({
  name: 'BoardGatingHarness',
  setup() {
    const timeTravelState = ref<{ marker: string } | null>(null);
    const isViewingHistory = computed(() => timeTravelState.value !== null);
    const isMyTurn = ref(true);
    const availableActions = ref(['move']);

    const BoardStub = defineComponent({
      name: 'BoardStub',
      props: {
        isMyTurn: { type: Boolean, default: false },
        availableActions: { type: Array as () => string[], default: () => [] },
        isViewingHistory: { type: Boolean, default: false },
      },
      setup(p) {
        // The ordinary way a custom board gates a control.
        const canMove = computed(() => p.isMyTurn && p.availableActions.includes('move'));
        return () =>
          h('div', { class: 'board-stub', 'data-browsing': String(p.isViewingHistory) }, [
            canMove.value ? h('button', { class: 'move-btn' }, 'Move') : null,
          ]);
      },
    });

    function browse(marker: string | null) {
      timeTravelState.value = marker ? { marker } : null;
    }

    return { timeTravelState, isViewingHistory, isMyTurn, availableActions, BoardStub, browse };
  },
  render() {
    return h(this.BoardStub, {
      isMyTurn: this.isMyTurn && !this.isViewingHistory,
      availableActions: this.isViewingHistory ? [] : this.availableActions,
      isViewingHistory: this.isViewingHistory,
    } as Record<string, unknown>);
  },
});

describe('B18: the gated props make a browsing board inert', () => {
  it('offers its control during live play', () => {
    const wrapper = mount(BoardGatingHarness);
    expect(wrapper.find('.move-btn').exists()).toBe(true);
    expect(wrapper.find('.board-stub').attributes('data-browsing')).toBe('false');
  });

  it('withdraws the control while the player browses history', async () => {
    const wrapper = mount(BoardGatingHarness);
    (wrapper.vm as unknown as { browse: (m: string | null) => void }).browse('action-3');
    await nextTick();
    // The board is DRAWING a historical position; a clickable "Move" here would
    // commit against the live game from a position the player never chose.
    expect(wrapper.find('.move-btn').exists()).toBe(false);
    // And it is TOLD why, rather than having to infer it.
    expect(wrapper.find('.board-stub').attributes('data-browsing')).toBe('true');
  });

  it('restores the control on return to the current position', async () => {
    const wrapper = mount(BoardGatingHarness);
    const vm = wrapper.vm as unknown as { browse: (m: string | null) => void };
    vm.browse('action-3');
    await nextTick();
    vm.browse(null);
    await nextTick();
    expect(wrapper.find('.move-btn').exists()).toBe(true);
  });
});
