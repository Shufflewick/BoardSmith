// @vitest-environment jsdom
/**
 * GameShell — showHintProp computed (Plan 110-01, Task 2)
 *
 * Uses a minimal harness component (same pattern as GameShell.tutorial.test.ts /
 * GameShell.action-help.test.ts) to test the showHintProp computed in isolation
 * without mounting the full WebSocket-dependent GameShell component.
 *
 * Production wiring under test (GameShell.vue showHintProp computed):
 *
 *   const showHintProp = computed<boolean | undefined>(() => {
 *     // Production lobby path — unchanged
 *     if (lobbyInfo.value?.slots?.some(s => s.botLevel != null)) return true;
 *     // Dev-host path: SnapshotSessionHost injects hasBotPlayers into broadcast state
 *     if ((state.value?.state as any)?.hasBotPlayers) return true;
 *     return undefined;
 *   });
 *
 * INVARIANT (RESEARCH Pitfall 5): The `hasBotPlayers` branch must NOT fire in
 * production because GameSession never sets that field. The test proves this
 * by checking the production-no-bot case explicitly.
 *
 * Behaviors under test:
 *   SH-1: Both lobbyInfo absent AND state.hasBotPlayers absent → undefined (production no-bot)
 *   SH-2: state.hasBotPlayers = true, lobbyInfo = null → true (dev-host path)
 *   SH-3: lobbyInfo.slots has a bot slot, state.hasBotPlayers absent → true (production lobby)
 *   SH-4: Both lobbyInfo bot slot AND state.hasBotPlayers → true (belt-and-suspenders)
 */

import { describe, it, expect, vi } from 'vitest';
import { ref, computed, watch, nextTick } from 'vue';

// ── Minimal LobbyInfo-like shape ─────────────────────────────────────────────
// Only the fields that showHintProp reads are required.

interface SlotLike { botLevel?: string | null }
interface LobbyInfoLike { slots?: SlotLike[] }

// ── Minimal PlayerGameState shape ────────────────────────────────────────────
// Only the `hasBotPlayers` field is needed.

interface StateLike { state?: { hasBotPlayers?: boolean } }

// ── Harness: mirrors the exact showHintProp production wiring ─────────────────
// These refs mirror the shape of lobbyInfo and state in GameShell.vue.
// If GameShell changes showHintProp, this harness must receive the same fix.

function buildHarness(
  lobbyInfoValue: LobbyInfoLike | null,
  stateValue: StateLike | null,
) {
  const lobbyInfo = ref<LobbyInfoLike | null>(lobbyInfoValue);
  const state = ref<StateLike | null>(stateValue);

  // ── Production showHintProp wiring (mirrors GameShell.vue exactly) ────────
  const showHintProp = computed<boolean | undefined>(() => {
    // Production lobby path — unchanged
    if (lobbyInfo.value?.slots?.some(s => s.botLevel != null)) return true;
    // Dev-host path: SnapshotSessionHost injects hasBotPlayers into broadcast state
    if ((state.value?.state as any)?.hasBotPlayers) return true;
    return undefined;
  });

  return { showHintProp };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GameShell — showHintProp computed', () => {

  it('SH-1: returns undefined when BOTH lobbyInfo and state.hasBotPlayers are absent', () => {
    const { showHintProp } = buildHarness(null, null);
    expect(showHintProp.value).toBeUndefined();
  });

  it('SH-1b: returns undefined when lobbyInfo has no bot slots and state has no hasBotPlayers', () => {
    const { showHintProp } = buildHarness(
      { slots: [{ botLevel: null }, { botLevel: null }] },  // all human
      { state: {} },
    );
    expect(showHintProp.value).toBeUndefined();
  });

  it('SH-2: returns true when state.hasBotPlayers is true and lobbyInfo is null (dev-host path)', () => {
    const { showHintProp } = buildHarness(
      null,
      { state: { hasBotPlayers: true } },
    );
    expect(showHintProp.value).toBe(true);
  });

  it('SH-2b: returns true when state.hasBotPlayers is true and lobbyInfo has no bot slots', () => {
    const { showHintProp } = buildHarness(
      { slots: [{ botLevel: null }] },
      { state: { hasBotPlayers: true } },
    );
    expect(showHintProp.value).toBe(true);
  });

  it('SH-3: returns true when lobbyInfo has a bot slot and state.hasBotPlayers is absent (production lobby path)', () => {
    const { showHintProp } = buildHarness(
      { slots: [{ botLevel: null }, { botLevel: 'medium' }] },
      { state: {} },
    );
    expect(showHintProp.value).toBe(true);
  });

  it('SH-3b: returns true when all lobbyInfo slots have bot levels', () => {
    const { showHintProp } = buildHarness(
      { slots: [{ botLevel: 'easy' }, { botLevel: 'hard' }] },
      null,
    );
    expect(showHintProp.value).toBe(true);
  });

  it('SH-4: returns true when both paths are active (belt-and-suspenders)', () => {
    const { showHintProp } = buildHarness(
      { slots: [{ botLevel: 'medium' }] },
      { state: { hasBotPlayers: true } },
    );
    expect(showHintProp.value).toBe(true);
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
// Uses a minimal harness (same pattern as showHintProp above) that mirrors the
// exact production watch body, rather than mounting the full WebSocket-
// dependent GameShell component.
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
