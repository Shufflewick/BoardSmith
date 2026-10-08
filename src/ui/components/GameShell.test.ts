// @vitest-environment jsdom
/**
 * GameShell — showHintProp (Plan 110-01, Task 2), on the REAL shell.
 *
 * The Teaching group's hint is offered when the host's state says the game has
 * a bot seat: SnapshotSessionHost injects `hasBotPlayers` into broadcast state
 * when botSeats are present. GameSession never sets it (RESEARCH Pitfall 5),
 * so a production table without that field offers no hint.
 *
 * Behaviors under test:
 *   SH-1: no state, or state without hasBotPlayers -> undefined
 *   SH-2: state.hasBotPlayers = true -> true
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ref, watch, nextTick } from 'vue';
import ControlsMenu from './ControlsMenu.vue';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

function postState(state: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', {
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

// ─────────────────────────────────────────────────────────────────────────
// GameShell — actionController.lastError -> toast chokepoint (Plan 134-03,
// Task 1, UIX-01 part 1)
//
// Production wiring under test (GameShell.vue, after actionController and
// toast are both constructed):
//
//   watch(actionController.errorTick, () => {
//     const err = actionController.lastError.value;
//     if (!err) return;
//     const text = typeof err === 'string' && err.length > 0
//       ? err
//       : `${actionController.currentAction.value ?? 'Action'} failed — try again or check the current selection.`;
//     toast.error(text);
//     assertiveMessage.value = text;
//     emitAnnounce('assertive', text);
//   }, { immediate: false });
//
// The watch source is errorTick, NOT lastError (CR-01): fill()-path failures
// never null-clear lastError between attempts, so a retried IDENTICAL failure
// leaves the string unchanged — a watch on lastError would drop that toast.
// errorTick is bumped by the controller's setError() on EVERY failure.
//
// This is the SOLE toast-owning chokepoint for action failures — ActionPanel's
// three direct toast.error call sites are removed (see ActionPanel.test.ts),
// so a failed action (from ActionPanel OR a custom UI, both sharing the same
// actionController instance) produces exactly ONE toast via this watch.
//
// Uses a minimal harness that mirrors the exact production watch body.
// ─────────────────────────────────────────────────────────────────────────

describe('GameShell — actionController.lastError -> toast chokepoint (UIX-01)', () => {
  function buildToastHarness() {
    const lastError = ref<string | null>(null);
    // Mirrors useActionController's setError()/errorTick pair: every failure
    // path calls setError(msg), which bumps the monotonic errorTick. Clears
    // (lastError.value = null) do NOT tick.
    const errorTick = ref(0);
    const setError = (msg: string) => {
      lastError.value = msg;
      errorTick.value++;
    };
    const currentAction = ref<string | null>(null);
    const assertiveMessage = ref('');
    const toastErrorCalls: string[] = [];
    const announceCalls: Array<{ level: string; text: string }> = [];

    const toast = { error: (msg: string) => toastErrorCalls.push(msg) };
    const emitAnnounce = (level: 'polite' | 'assertive', text: string) => {
      announceCalls.push({ level, text });
    };

    // ── Production watch wiring (mirrors GameShell.vue exactly) ──────────
    watch(errorTick, () => {
      const err = lastError.value;
      if (!err) return;
      const text = typeof err === 'string' && err.length > 0
        ? err
        : `${currentAction.value ?? 'Action'} failed — try again or check the current selection.`;
      toast.error(text);
      assertiveMessage.value = text;
      emitAnnounce('assertive', text);
    }, { immediate: false });

    return { lastError, errorTick, setError, currentAction, assertiveMessage, toastErrorCalls, announceCalls };
  }

  it('fires exactly one toast.error and updates assertiveMessage when lastError transitions null -> a string', async () => {
    const { setError, assertiveMessage, toastErrorCalls, announceCalls } = buildToastHarness();

    setError('boom');
    await Promise.resolve(); // flush watcher (default flush: 'pre', batched to next tick)
    await Promise.resolve();

    expect(toastErrorCalls).toEqual(['boom']);
    expect(assertiveMessage.value).toBe('boom');
    expect(announceCalls).toEqual([{ level: 'assertive', text: 'boom' }]);
  });

  it('does NOT fire on mount (immediate: false) even if lastError starts non-null', async () => {
    const lastError = ref<string | null>('pre-existing');
    const errorTick = ref(0);
    const assertiveMessage = ref('');
    const toastErrorCalls: string[] = [];
    const toast = { error: (msg: string) => toastErrorCalls.push(msg) };

    watch(errorTick, () => {
      const err = lastError.value;
      if (!err) return;
      toast.error(err);
      assertiveMessage.value = err;
    }, { immediate: false });

    await Promise.resolve();
    expect(toastErrorCalls).toEqual([]);
  });

  it('a single failed action that sets lastError multiple times within one tick produces exactly one toast (Vue batches; no flush:sync)', async () => {
    const { lastError, setError, toastErrorCalls } = buildToastHarness();

    // Simulate a failure path that clears then re-sets lastError synchronously
    // within the same tick (mirrors execute()'s `lastError.value = null` at
    // the start of a call, followed by a synchronous failure branch).
    lastError.value = null;
    setError('first');
    setError('second');
    await Promise.resolve();
    await Promise.resolve();

    // Vue's default watch flush batches synchronous mutations within a tick;
    // only the settled final value produces one toast.
    expect(toastErrorCalls).toEqual(['second']);
  });

  it('never renders undefined/[object Object] — a falsy lastError (null or empty string) never toasts', async () => {
    const { lastError, setError, toastErrorCalls } = buildToastHarness();

    // fill()/execute() internally coalesce to a non-empty string via
    // `result.error || 'Action failed'`, so lastError is always either null
    // (no error) or a real message once set. The watch's `if (!err) return;`
    // guard is the belt-and-suspenders proof that an empty/falsy value can
    // never reach toast.error and render as undefined/[object Object] — even
    // if a (hypothetical) failure path ticked with an empty message.
    setError('');
    await Promise.resolve();
    await Promise.resolve();
    expect(toastErrorCalls).toEqual([]);

    // A clear (direct null assignment, no tick) never fires the watch at all.
    lastError.value = null;
    await Promise.resolve();
    await Promise.resolve();
    expect(toastErrorCalls).toEqual([]);
  });

  it('re-toasts when the SAME failure repeats across ticks (retry-identical-failure, CR-01)', async () => {
    // A player clicks an invalid destination, gets the toast, then clicks the
    // SAME invalid destination again. fill()-path failures never null-clear
    // lastError between attempts, so the error STRING is identical both times —
    // the retry must still produce a second toast (exactly one per failure).
    // errorTick (bumped by setError on every failure) is what makes this fire.
    const { setError, toastErrorCalls } = buildToastHarness();

    setError('Invalid selection for "to"');
    await Promise.resolve();
    await Promise.resolve();

    setError('Invalid selection for "to"');
    await Promise.resolve();
    await Promise.resolve();

    expect(toastErrorCalls).toEqual([
      'Invalid selection for "to"',
      'Invalid selection for "to"',
    ]);
  });

  it('a failed action originating from ActionPanel produces exactly ONE toast via this watch, not from ActionPanel itself', async () => {
    // ActionPanel.vue no longer calls toast.error directly (see
    // ActionPanel.test.ts) — its fill()/execute() failure paths only set
    // actionController.lastError on the SHARED controller instance. This test
    // proves that shared-instance failure is fully covered by this one watch.
    const { setError, toastErrorCalls } = buildToastHarness();

    // ActionPanel's executeAction() calling actionController.execute() and
    // getting {success:false} results in exactly this: setError() records the
    // error string and bumps errorTick, nothing else.
    setError('Not your turn.');
    await Promise.resolve();
    await Promise.resolve();

    expect(toastErrorCalls).toEqual(['Not your turn.']);
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
            "Custom board failed to render: the #game-board slot measured 0×0 after game state arrived. " +
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
