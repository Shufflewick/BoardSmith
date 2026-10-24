// @vitest-environment jsdom
/**
 * GameShell — showHintProp (Plan 110-01, Task 2), on the REAL shell.
 *
 * The Teaching group's hint is offered when the host's state says the game has
 * a bot seat: SnapshotSessionHost injects `hasBotPlayers` into broadcast state
 * only while it has bot seats (RESEARCH Pitfall 5), so a table without
 * that field offers no hint.
 *
 * Behaviors under test:
 *   SH-1: no state, or state without hasBotPlayers -> undefined
 *   SH-2: state.hasBotPlayers = true -> true
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, defineComponent, h } from 'vue';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';
import { useToast } from '../composables/useToast.js';
import { useGameContext } from '../composables/useGameContext.js';
import {
  type BoardComponent,
  enterIframe,
  leaveIframe,
  mountPlatformShell,
  mountTableWithDebugPanel,
} from './GameShell.platform-mount.test-helper.js';
import { watchLiveRegion } from '../../testing/live-region.js';
import { SETTLE_MS } from '../composables/useAutoZoom.js';

function postState(state: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window.parent,
    data: {
      source: 'shufflewick',
      type: 'game_state',
      view: {
        flowState: { currentPlayer: 0, awaitingInput: true, availableActions: [] },
        state: { view: {}, players: [], currentPlayer: 0, isMyTurn: true, ...state },
      },
    },
  }));
}

async function mountShowHintShell() {
  enterIframe();
  const wrapper = mountPlatformShell();
  await nextTick();
  return { wrapper, showHint: () => wrapper.findComponent(ControlsMenu).props('showHint') };
}

describe('GameShell — showHintProp', () => {
  afterEach(leaveIframe);

  it('SH-1: is undefined before any state arrives', async () => {
    const { wrapper, showHint } = await mountShowHintShell();
    expect(showHint()).toBeUndefined();
    wrapper.unmount();
  });

  it('SH-1b: is undefined when the state does not say the game has a bot (production)', async () => {
    const { wrapper, showHint } = await mountShowHintShell();
    postState({});
    await nextTick();
    expect(showHint()).toBeUndefined();
    wrapper.unmount();
  });

  it('SH-2: is true when the state says the game has a bot seat (dev host)', async () => {
    const { wrapper, showHint } = await mountShowHintShell();
    postState({ hasBotPlayers: true });
    await nextTick();
    expect(showHint()).toBe(true);
    wrapper.unmount();
  });
});

// A failed action is told once, as an error toast and in the assertive live
// region, by the shell's one errorTick watch (UIX-01), whichever surface sent it.
describe('GameShell — a failed action is told once (UIX-01)', () => {
  // A custom board that sends Move to a destination the pick does not offer.
  const Board = defineComponent({
    name: 'Board',
    setup() {
      const { actionController } = useGameContext();
      return () => h('button', { 'data-testid': 'bad-move', onClick: () => actionController.fill('to', 99) }, 'Move to 99');
    },
  });
  const toast = useToast();
  const shownToasts = () => toast.toasts.value.map((t) => [t.type, t.message]);
  const seatState = {
    availableActions: ['move', 'pass'],
    actionMetadata: {
      move: { name: 'move', prompt: 'Move', selections: [{ name: 'to', type: 'choice', prompt: 'Where to?', choices: [{ value: 1, display: 'North' }, { value: 2, display: 'South' }] }] },
      pass: { name: 'pass', prompt: 'Pass', selections: [] },
    },
  };

  // Unmounted here, so a failed test cannot leave a shell that answers the next test's requests.
  let mounted: VueWrapper | undefined;
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    for (const t of [...toast.toasts.value]) toast.remove(t.id);
    leaveIframe();
  });

  /** Click Pass in the Action Panel and have the host refuse it with `result`. */
  async function refusePass(wrapper: VueWrapper, posted: unknown[], result: Record<string, unknown>) {
    await wrapper.get('[data-bs-action="pass"]').trigger('click');
    await flushPromises();
    const request = posted.find((m) => (m as { op?: string }).op === 'action') as { requestId: string } | undefined;
    if (!request) throw new Error('the shell never sent the pass to the host');
    window.dispatchEvent(new MessageEvent('message', {
      source: window.parent,
      data: { source: 'shufflewick', type: 'server_response', requestId: request.requestId, result: { success: false, ...result } },
    }));
    await flushPromises();
  }

  async function mountRefusingTable() {
    const { wrapper, posted } = await mountTableWithDebugPanel(Board, seatState);
    mounted = wrapper;
    return { wrapper, posted, assertive: watchLiveRegion(wrapper, 'assertive') };
  }

  it('shows one error toast and says the reason assertively, and says nothing before', async () => {
    const { wrapper, posted, assertive } = await mountRefusingTable();
    expect(shownToasts()).toEqual([]);
    expect(await assertive()).toEqual([]);

    await refusePass(wrapper, posted, { error: 'Not your turn.' });
    expect(shownToasts()).toEqual([['error', 'Not your turn.']]);
    expect(await assertive()).toEqual(['Not your turn.']);
  });

  it('tells the SAME failure again when the board retries it (CR-01)', async () => {
    // A refused fill() leaves lastError unchanged, so only errorTick shows the retry.
    const { wrapper, assertive } = await mountRefusingTable();
    await wrapper.get('[data-bs-action="move"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="bad-move"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="bad-move"]').trigger('click');
    await flushPromises();
    expect(shownToasts()).toEqual([
      ['error', 'Invalid selection for "to"'],
      ['error', 'Invalid selection for "to"'],
    ]);
    expect(await assertive()).toEqual(['Invalid selection for "to"', 'Invalid selection for "to"']);
  });

  it('tells a refusal that gives no reason in words, never undefined', async () => {
    const { wrapper, posted, assertive } = await mountRefusingTable();
    await refusePass(wrapper, posted, {});
    expect(shownToasts()).toEqual([['error', 'Action failed']]);
    expect(await assertive()).toEqual(['Action failed']);
  });
});

// The dev build's one report of a custom board that collapsed to 0x0 (UIX-03),
// on the REAL shell. jsdom has no layout, so the zoom container's size and
// whether it is rendered (offsetParent) are set by the test.
describe('GameShell — dev-mode board sizing 0x0 console.error (UIX-03)', () => {
  const Board = defineComponent({ setup: () => () => h('div', 'board') });
  const EmptyBoard = defineComponent({ setup: () => () => null });
  const board = { width: 0, height: 0, rendered: true };
  let mounted: VueWrapper | undefined;

  beforeEach(() => {
    Object.assign(board, { width: 0, height: 0, rendered: true });
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.classList.contains('game-shell__zoom-container') ? board : { width: 0, height: 0 }) as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('game-shell__zoom-container') && board.rendered ? document.body : null;
    });
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    leaveIframe();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Mount the shell with `boardUi`, send `states` game states, wait out each settle check, and return the 0x0 reports. */
  async function collapseReports(boardUi: BoardComponent, states: number) {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    enterIframe();
    mounted = mountPlatformShell({ board: boardUi });
    await nextTick();
    for (let i = 0; i < states; i++) {
      postState({ round: i });
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    }
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    return consoleError.mock.calls.filter(([msg]) => String(msg).includes('measured 0×0'));
  }

  it('reports once when the board measures 0x0 after game state arrived', async () => {
    const reports = await collapseReports(Board, 1);
    expect(reports).toHaveLength(1);
    expect(reports[0]![0]).toContain('Board Sizing');
  });

  it('says nothing before game state arrives (the startup transient)', async () => {
    expect(await collapseReports(Board, 0)).toHaveLength(0);
  });

  it('says nothing while the board has drawn nothing yet', async () => {
    expect(await collapseReports(EmptyBoard, 1)).toHaveLength(0);
  });

  it('reports only once across repeated states while the board stays collapsed (WR-01)', async () => {
    expect(await collapseReports(Board, 3)).toHaveLength(1);
  });

  it('says nothing for a hidden board (a display:none ancestor gives no offsetParent) (WR-01)', async () => {
    board.rendered = false;
    expect(await collapseReports(Board, 1)).toHaveLength(0);
  });

  it('says nothing when the board has a real size', async () => {
    Object.assign(board, { width: 400, height: 300 });
    expect(await collapseReports(Board, 1)).toHaveLength(0);
  });
});
