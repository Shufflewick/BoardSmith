// @vitest-environment jsdom
/**
 * A failed time-travel read is visible, not silent (#154).
 *
 * `historicalStateLoading` and `historicalStateError` were both set and neither
 * was rendered. Worse than silent: `isViewingHistory` stays true after a failed
 * read while `historicalState` is null, so `displayedState` falls back to the
 * LIVE state and the State tab dresses it in the historical border. The reader
 * is shown the live tree labelled as the state after action N.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import DebugPanel from './DebugPanel.vue';
import { GAME_CONTEXT_KEYS } from '../composables/useGameContext.js';

type Op = (op: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

const LIVE_VIEW = { id: 1, className: 'Board', name: 'LIVE-ONLY-MARKER' };
const STATE = { state: { view: LIVE_VIEW, phase: 'play' }, flowState: null };

const HISTORY = [
  { name: 'playCard', player: 1, args: {}, timestamp: 1000 },
  { name: 'endTurn', player: 1, args: {}, timestamp: 2000 },
];

interface Vm {
  activeTab: string;
  historicalStateLoading: boolean;
  historicalStateError: string | null;
  isViewingHistory: boolean;
  selectAction: (i: number) => Promise<void>;
  fetchHistory: () => Promise<void>;
}

function mountPanel(handler: Op) {
  const platformRequest = vi.fn<Op>(handler);
  const wrapper = mount(DebugPanel, {
    props: { state: STATE, playerSeat: 1, playerCount: 2, gameId: 'g', expanded: true },
    global: { provide: { [GAME_CONTEXT_KEYS.platformRequest as symbol]: platformRequest } },
    attachTo: document.body,
  });
  return { wrapper, vm: wrapper.vm as unknown as Vm };
}

/** A host whose history reads succeed and whose state-at reads always fail. */
const failingStateAt: Op = async (op) => {
  if (op === 'debug:history') return { success: true, actionHistory: HISTORY };
  if (op === 'debug:state-at' || op === 'debug:state-diff') {
    throw new Error('checkpoint 3 was evicted from the retention window');
  }
  return { success: true };
};

describe('a failed historical read (#154)', () => {
  it('shows an error naming what could not be read', async () => {
    const { wrapper, vm } = mountPanel(failingStateAt);
    vm.activeTab = 'state';
    await vm.selectAction(1);
    await nextTick();

    const error = wrapper.get('.historical-state-error');
    expect(error.text()).toContain('action 1');
    expect(error.text()).toContain('checkpoint 3 was evicted from the retention window');
    wrapper.unmount();
  });

  it('tells the reader what to try next', async () => {
    const { wrapper, vm } = mountPanel(failingStateAt);
    vm.activeTab = 'state';
    await vm.selectAction(1);
    await nextTick();

    expect(wrapper.get('.historical-state-error').text()).toContain('Back to Live');
    wrapper.unmount();
  });

  it('does not show the live state dressed as the historical one', async () => {
    const { wrapper, vm } = mountPanel(failingStateAt);
    vm.activeTab = 'state';
    await vm.selectAction(1);
    await nextTick();

    expect(vm.isViewingHistory).toBe(true);
    expect(wrapper.find('.state-display').exists()).toBe(false);
    expect(wrapper.get('.tab-content.state-tab').text()).not.toContain('LIVE-ONLY-MARKER');
    wrapper.unmount();
  });

  it('clears the error once a later read succeeds', async () => {
    let fail = true;
    const { wrapper, vm } = mountPanel(async (op) => {
      if (op === 'debug:history') return { success: true, actionHistory: HISTORY };
      if (op === 'debug:state-at') {
        if (fail) throw new Error('boom');
        return { success: true, state: { view: { id: 9, className: 'Board' } } };
      }
      if (op === 'debug:state-diff') return { success: true, diff: null };
      return { success: true };
    });
    vm.activeTab = 'state';
    await vm.selectAction(1);
    await nextTick();
    expect(wrapper.find('.historical-state-error').exists()).toBe(true);

    fail = false;
    await vm.selectAction(0);
    await nextTick();
    expect(wrapper.find('.historical-state-error').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('a historical read in flight (#154)', () => {
  it('says it is loading while the read is outstanding', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const { wrapper, vm } = mountPanel(async (op) => {
      if (op === 'debug:history') return { success: true, actionHistory: HISTORY };
      if (op === 'debug:state-at') {
        await gate;
        return { success: true, state: { view: { id: 9, className: 'Board' } } };
      }
      if (op === 'debug:state-diff') return { success: true, diff: null };
      return { success: true };
    });
    vm.activeTab = 'state';

    const pending = vm.selectAction(1);
    await nextTick();
    expect(wrapper.find('.historical-state-loading').exists()).toBe(true);

    release!();
    await pending;
    await nextTick();
    expect(wrapper.find('.historical-state-loading').exists()).toBe(false);
    wrapper.unmount();
  });
});
