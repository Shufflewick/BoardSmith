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

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ref, watch, nextTick, defineComponent, h } from 'vue';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';
import { useToast } from '../composables/useToast.js';
import { useGameContext } from '../composables/useGameContext.js';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
  mountTableWithDebugPanel,
} from './GameShell.platform-mount.test-helper.js';
import { watchLiveRegion } from '../../testing/live-region.js';

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

// ─────────────────────────────────────────────────────────────────────────
// GameShell — dev-mode 0×0 board console.error (Plan 134-03, Task 2, UIX-03)
//
// Production wiring under test (GameShell.vue, isDevBuild-gated):
//
//   watch(gameView, async (view) => {
//     if (!view) return;
//     await nextTick();
//     setTimeout(() => {
//       const el = zoomContainerEl.value;
//       if (!el || el.children.length === 0) return;
//       const rect = el.getBoundingClientRect();
//       if (rect.width < 1 || rect.height < 1) {
//         console.error(<UIX-03 copy>);
//       }
//     }, SETTLE_MS);
//   }, { immediate: false });
//
// Gated on BOTH state-arrived (non-null gameView) AND slot-has-children, per
// 134-RESEARCH.md Pitfall 2, so the normal startup transient 0×0 (before state
// arrives / before children mount) never false-positives. Uses SETTLE_MS
// imported from useAutoZoom.ts (no new timing constant).
// ─────────────────────────────────────────────────────────────────────────

describe('GameShell — dev-mode board sizing 0×0 console.error (UIX-03)', () => {
  const SETTLE_MS = 300; // mirrors useAutoZoom.ts's exported constant

  /** Minimal fake element exposing only what the production watch reads.
   * offsetParent is non-null so the fake counts as RENDERED (the WR-01 hidden-
   * board guard skips elements whose offsetParent is null — see the real-
   * element hidden-board test below). */
  function makeFakeZoomContainer(rect: { width: number; height: number }, childCount: number) {
    return {
      getBoundingClientRect: () => rect,
      children: { length: childCount },
      offsetParent: {},
    } as unknown as HTMLElement;
  }

  function buildBoardSizingHarness(zoomContainerEl: { value: HTMLElement | null }) {
    const gameView = ref<unknown>(null);
    const errorCalls: string[] = [];
    const consoleError = (msg: string) => errorCalls.push(msg);

    // ── Production watch wiring (mirrors GameShell.vue exactly) ──────────
    let warned0x0 = false;
    let pending0x0Check: ReturnType<typeof setTimeout> | undefined;
    watch(gameView, async (view) => {
      if (!view || warned0x0) return;
      await nextTick();
      if (pending0x0Check !== undefined) clearTimeout(pending0x0Check);
      pending0x0Check = setTimeout(() => {
        pending0x0Check = undefined;
        if (warned0x0) return;
        const el = zoomContainerEl.value;
        if (!el || el.children.length === 0) return;
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
          warned0x0 = true;
          consoleError(
            "Custom board failed to render: the board measured 0×0 after game state arrived. " +
            "This usually means a percentage-width or container-type board is collapsing inside GameShell's " +
            "zoom container ('.game-shell__zoom-container { width: max-content }'). Give your board's root " +
            'element a definite width (not 100%) or see the "Board Sizing" section of docs/custom-ui-guide.md.'
          );
        }
      }, SETTLE_MS);
    }, { immediate: false });

    return { gameView, errorCalls };
  }

  it('fires once when the board measures 0x0 AFTER game state has arrived and the slot has children', async () => {
    vi.useFakeTimers();
    try {
      const zoomContainerEl = { value: makeFakeZoomContainer({ width: 0, height: 0 }, 1) };
      const { gameView, errorCalls } = buildBoardSizingHarness(zoomContainerEl);

      gameView.value = { children: [] }; // state arrived
      await nextTick();
      await nextTick(); // flush the async watch callback's own nextTick()
      await vi.advanceTimersByTimeAsync(SETTLE_MS);

      expect(errorCalls).toHaveLength(1);
      expect(errorCalls[0]).toContain('measured 0×0 after game state arrived');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT fire on the normal startup transient (gameView still null)', async () => {
    vi.useFakeTimers();
    try {
      const zoomContainerEl = { value: makeFakeZoomContainer({ width: 0, height: 0 }, 1) };
      const { gameView, errorCalls } = buildBoardSizingHarness(zoomContainerEl);

      // gameView never set (stays null) — watch callback never even fires.
      void gameView;
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 50);

      expect(errorCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT fire when state has arrived but the slot has no children yet (pre-mount transient)', async () => {
    vi.useFakeTimers();
    try {
      const zoomContainerEl = { value: makeFakeZoomContainer({ width: 0, height: 0 }, 0) };
      const { gameView, errorCalls } = buildBoardSizingHarness(zoomContainerEl);

      gameView.value = { children: [] };
      await nextTick();
      await nextTick();
      await vi.advanceTimersByTimeAsync(SETTLE_MS);

      expect(errorCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires only ONCE across repeated gameView broadcasts while the board stays collapsed (WR-01 latch)', async () => {
    vi.useFakeTimers();
    try {
      const zoomContainerEl = { value: makeFakeZoomContainer({ width: 0, height: 0 }, 1) };
      const { gameView, errorCalls } = buildBoardSizingHarness(zoomContainerEl);

      // First broadcast — genuine collapse, one report.
      gameView.value = { children: [] };
      await nextTick();
      await nextTick();
      await vi.advanceTimersByTimeAsync(SETTLE_MS);

      // Two more broadcasts while still collapsed (e.g. a bot-vs-bot dev game)
      // must NOT re-log — one report per session for a structural CSS bug.
      gameView.value = { children: [1] };
      await nextTick();
      await nextTick();
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      gameView.value = { children: [2] };
      await nextTick();
      await nextTick();
      await vi.advanceTimersByTimeAsync(SETTLE_MS);

      expect(errorCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT fire for a hidden board (display:none ancestor — offsetParent null), only for a genuinely collapsed one (WR-01)', async () => {
    vi.useFakeTimers();
    try {
      // A real (detached) element: jsdom gives offsetParent === null and a 0×0
      // rect — exactly what a display:none board reports in a real browser,
      // even when its sizing CSS is correct. Must not false-positive.
      const hiddenEl = document.createElement('div');
      hiddenEl.appendChild(document.createElement('div')); // slot has children
      const zoomContainerEl = { value: hiddenEl as HTMLElement };
      const { gameView, errorCalls } = buildBoardSizingHarness(zoomContainerEl);

      gameView.value = { children: [] };
      await nextTick();
      await nextTick();
      await vi.advanceTimersByTimeAsync(SETTLE_MS);

      expect(errorCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT fire when the board measures a genuine non-zero size', async () => {
    vi.useFakeTimers();
    try {
      const zoomContainerEl = { value: makeFakeZoomContainer({ width: 400, height: 300 }, 2) };
      const { gameView, errorCalls } = buildBoardSizingHarness(zoomContainerEl);

      gameView.value = { children: [] };
      await nextTick();
      await nextTick();
      await vi.advanceTimersByTimeAsync(SETTLE_MS);

      expect(errorCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
