// @vitest-environment jsdom
/**
 * A NEW GAME ENDS TIME TRAVEL IN THE DEBUG PANEL TOO (#587).
 *
 * The dev host does not reload the game frame on a restart, so the panel is
 * handed the new game's state while it may still point at an action of the
 * old one. The selection belongs to the old game: the panel drops it, and says
 * so to the shell, when the state names a different game.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import DebugPanel from './DebugPanel.vue';
import { GAME_CONTEXT_KEYS } from '../composables/useGameContext.js';

type Op = (op: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

const HISTORY = [
  { name: 'playCard', player: 1, args: {}, timestamp: 1000 },
  { name: 'endTurn', player: 1, args: {}, timestamp: 2000 },
];
const SNAPSHOT = { view: { id: 1, className: 'Board' }, players: [] };
const host: Op = async (op) => {
  if (op === 'debug:history') return { success: true, actionHistory: HISTORY };
  if (op === 'debug:state-at') return { success: true, state: SNAPSHOT };
  if (op === 'debug:state-diff') return { success: true, diff: { added: [], removed: [], changed: [] } };
  return { success: true };
};
const stateOf = (gameInstanceId: string) => ({
  state: { view: { id: 1, className: 'Board' }, players: [], gameInstanceId },
  flowState: null,
});

describe('the debug panel on a new game (#587)', () => {
  it('drops the selected action of the old game and returns the shell to live', async () => {
    const wrapper = mount(DebugPanel, {
      props: { state: stateOf('game-1'), playerSeat: 1, expanded: true },
      global: { provide: { [GAME_CONTEXT_KEYS.platformRequest as symbol]: vi.fn<Op>(host) } },
      attachTo: document.body,
    });
    const vm = wrapper.vm as unknown as { isViewingHistory: boolean; selectAction: (i: number) => Promise<void> };
    await vm.selectAction(1);
    expect(vm.isViewingHistory).toBe(true);

    await wrapper.setProps({ state: stateOf('game-1') });
    expect(vm.isViewingHistory).toBe(true);

    await wrapper.setProps({ state: stateOf('game-2') });
    expect(vm.isViewingHistory).toBe(false);
    expect(wrapper.emitted('time-travel')?.at(-1)).toEqual([null, null, null]);
    wrapper.unmount();
  });
});
