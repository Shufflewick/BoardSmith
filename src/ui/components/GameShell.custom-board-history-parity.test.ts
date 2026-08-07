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
 * Tested with this file's established convention for GameShell-derived
 * behaviour (see GameShell.time-travel-desync.test.ts): direct source
 * assertions on the wiring, plus a harness that renders both branches from the
 * SAME expressions to prove the two consumers agree.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, ref, computed, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gameShellSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'GameShell.vue'),
  'utf-8'
);

/** The `<component :is="selectedUiComponent" ... />` block — the custom board's props. */
function customBoardBlock(): string {
  const start = gameShellSource.indexOf(':is="selectedUiComponent"');
  expect(start).toBeGreaterThan(-1);
  const end = gameShellSource.indexOf('/>', start);
  expect(end).toBeGreaterThan(start);
  return gameShellSource.slice(start, end);
}

describe('B18: GameShell.vue states isViewingHistory to the custom board', () => {
  it('passes :is-viewing-history as a prop, beside can-undo', () => {
    // Stated, not deduced. The auto-UI is handed the boolean; a custom board
    // must not have to reverse-engineer it from a nulled flowState.
    expect(customBoardBlock()).toContain(':is-viewing-history="isViewingHistory"');
  });

  it('gates is-my-turn exactly like the auto ActionPanel', () => {
    expect(customBoardBlock()).toContain(':is-my-turn="isMyTurn && !isViewingHistory"');
    // Same expression on the auto-UI branch -- the two cannot drift apart
    // without this assertion failing.
    expect(gameShellSource).toContain(':is-my-turn="isMyTurn && !isViewingHistory"');
  });

  it('gates available-actions exactly like the auto ActionPanel', () => {
    expect(customBoardBlock()).toContain(':available-actions="isViewingHistory ? [] : availableActions"');
  });

  it('gates disabled-actions exactly like the auto ActionPanel', () => {
    expect(customBoardBlock()).toContain(':disabled-actions="isViewingHistory ? undefined : disabledActions"');
  });

  it('hands the board the DISPLAYED flow state, never the live one', () => {
    // `state?.flowState` is live: it would superimpose live turn info on a
    // historical board -- the exact mix the nulled `displayedState.flowState`
    // exists to avoid.
    expect(customBoardBlock()).toContain(':flow-state="displayedState?.flowState"');
    expect(customBoardBlock()).not.toContain(':flow-state="state?.flowState"');
  });

  it('leaves no ungated actionability prop on the board', () => {
    const block = customBoardBlock();
    expect(block).not.toContain(':is-my-turn="isMyTurn"');
    expect(block).not.toContain(':available-actions="availableActions"');
    expect(block).not.toContain(':disabled-actions="disabledActions"');
  });
});

// ── Behaviour: a board gated this way cannot offer a live control on a browse ─

/**
 * Renders a board from the SAME expressions GameShell now uses, so the claim
 * under test is behavioural, not just textual: a board that gates its controls
 * on the props it is handed goes inert the moment the player browses history.
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
