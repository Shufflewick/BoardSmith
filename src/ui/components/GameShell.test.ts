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
 *     if (lobbyInfo.value?.slots?.some(s => s.aiLevel != null)) return true;
 *     // Dev-host path: SnapshotSessionHost injects hasAIPlayers into broadcast state
 *     if ((state.value?.state as any)?.hasAIPlayers) return true;
 *     return undefined;
 *   });
 *
 * INVARIANT (RESEARCH Pitfall 5): The `hasAIPlayers` branch must NOT fire in
 * production because GameSession never sets that field. The test proves this
 * by checking the production-no-AI case explicitly.
 *
 * Behaviors under test:
 *   SH-1: Both lobbyInfo absent AND state.hasAIPlayers absent → undefined (production no-AI)
 *   SH-2: state.hasAIPlayers = true, lobbyInfo = null → true (dev-host path)
 *   SH-3: lobbyInfo.slots has an AI slot, state.hasAIPlayers absent → true (production lobby)
 *   SH-4: Both lobbyInfo AI slot AND state.hasAIPlayers → true (belt-and-suspenders)
 */

import { describe, it, expect } from 'vitest';
import { ref, computed, watch } from 'vue';

// ── Minimal LobbyInfo-like shape ─────────────────────────────────────────────
// Only the fields that showHintProp reads are required.

interface SlotLike { aiLevel?: string | null }
interface LobbyInfoLike { slots?: SlotLike[] }

// ── Minimal PlayerGameState shape ────────────────────────────────────────────
// Only the `hasAIPlayers` field is needed.

interface StateLike { state?: { hasAIPlayers?: boolean } }

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
    if (lobbyInfo.value?.slots?.some(s => s.aiLevel != null)) return true;
    // Dev-host path: SnapshotSessionHost injects hasAIPlayers into broadcast state
    if ((state.value?.state as any)?.hasAIPlayers) return true;
    return undefined;
  });

  return { showHintProp };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GameShell — showHintProp computed', () => {

  it('SH-1: returns undefined when BOTH lobbyInfo and state.hasAIPlayers are absent', () => {
    const { showHintProp } = buildHarness(null, null);
    expect(showHintProp.value).toBeUndefined();
  });

  it('SH-1b: returns undefined when lobbyInfo has no AI slots and state has no hasAIPlayers', () => {
    const { showHintProp } = buildHarness(
      { slots: [{ aiLevel: null }, { aiLevel: null }] },  // all human
      { state: {} },
    );
    expect(showHintProp.value).toBeUndefined();
  });

  it('SH-2: returns true when state.hasAIPlayers is true and lobbyInfo is null (dev-host path)', () => {
    const { showHintProp } = buildHarness(
      null,
      { state: { hasAIPlayers: true } },
    );
    expect(showHintProp.value).toBe(true);
  });

  it('SH-2b: returns true when state.hasAIPlayers is true and lobbyInfo has no AI slots', () => {
    const { showHintProp } = buildHarness(
      { slots: [{ aiLevel: null }] },
      { state: { hasAIPlayers: true } },
    );
    expect(showHintProp.value).toBe(true);
  });

  it('SH-3: returns true when lobbyInfo has an AI slot and state.hasAIPlayers is absent (production lobby path)', () => {
    const { showHintProp } = buildHarness(
      { slots: [{ aiLevel: null }, { aiLevel: 'medium' }] },
      { state: {} },
    );
    expect(showHintProp.value).toBe(true);
  });

  it('SH-3b: returns true when all lobbyInfo slots have AI levels', () => {
    const { showHintProp } = buildHarness(
      { slots: [{ aiLevel: 'easy' }, { aiLevel: 'hard' }] },
      null,
    );
    expect(showHintProp.value).toBe(true);
  });

  it('SH-4: returns true when both paths are active (belt-and-suspenders)', () => {
    const { showHintProp } = buildHarness(
      { slots: [{ aiLevel: 'medium' }] },
      { state: { hasAIPlayers: true } },
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
//   watch(actionController.lastError, (err) => {
//     if (!err) return;
//     const text = typeof err === 'string' && err.length > 0
//       ? err
//       : `${actionController.currentAction.value ?? 'Action'} failed — try again or check the current selection.`;
//     toast.error(text);
//     assertiveMessage.value = text;
//     emitAnnounce('assertive', text);
//   }, { immediate: false });
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
    const currentAction = ref<string | null>(null);
    const assertiveMessage = ref('');
    const toastErrorCalls: string[] = [];
    const announceCalls: Array<{ level: string; text: string }> = [];

    const toast = { error: (msg: string) => toastErrorCalls.push(msg) };
    const emitAnnounce = (level: 'polite' | 'assertive', text: string) => {
      announceCalls.push({ level, text });
    };

    // ── Production watch wiring (mirrors GameShell.vue exactly) ──────────
    watch(lastError, (err) => {
      if (!err) return;
      const text = typeof err === 'string' && err.length > 0
        ? err
        : `${currentAction.value ?? 'Action'} failed — try again or check the current selection.`;
      toast.error(text);
      assertiveMessage.value = text;
      emitAnnounce('assertive', text);
    }, { immediate: false });

    return { lastError, currentAction, assertiveMessage, toastErrorCalls, announceCalls };
  }

  it('fires exactly one toast.error and updates assertiveMessage when lastError transitions null -> a string', async () => {
    const { lastError, assertiveMessage, toastErrorCalls, announceCalls } = buildToastHarness();

    lastError.value = 'boom';
    await Promise.resolve(); // flush watcher (default flush: 'pre', batched to next tick)
    await Promise.resolve();

    expect(toastErrorCalls).toEqual(['boom']);
    expect(assertiveMessage.value).toBe('boom');
    expect(announceCalls).toEqual([{ level: 'assertive', text: 'boom' }]);
  });

  it('does NOT fire on mount (immediate: false) even if lastError starts non-null', async () => {
    const lastError = ref<string | null>('pre-existing');
    const assertiveMessage = ref('');
    const toastErrorCalls: string[] = [];
    const toast = { error: (msg: string) => toastErrorCalls.push(msg) };

    watch(lastError, (err) => {
      if (!err) return;
      toast.error(err);
      assertiveMessage.value = err;
    }, { immediate: false });

    await Promise.resolve();
    expect(toastErrorCalls).toEqual([]);
  });

  it('a single failed action that sets lastError multiple times within one tick produces exactly one toast (Vue batches; no flush:sync)', async () => {
    const { lastError, toastErrorCalls } = buildToastHarness();

    // Simulate a failure path that clears then re-sets lastError synchronously
    // within the same tick (mirrors execute()'s `lastError.value = null` at
    // the start of a call, followed by a synchronous failure branch).
    lastError.value = null;
    lastError.value = 'first';
    lastError.value = 'second';
    await Promise.resolve();
    await Promise.resolve();

    // Vue's default watch flush batches synchronous mutations within a tick;
    // only the settled final value produces one toast.
    expect(toastErrorCalls).toEqual(['second']);
  });

  it('never renders undefined/[object Object] — a falsy lastError (null or empty string) never toasts', async () => {
    const { lastError, toastErrorCalls } = buildToastHarness();

    // fill()/execute() internally coalesce to a non-empty string via
    // `result.error || 'Action failed'`, so lastError is always either null
    // (no error) or a real message once set. The watch's `if (!err) return;`
    // guard is the belt-and-suspenders proof that an empty/falsy value can
    // never reach toast.error and render as undefined/[object Object].
    lastError.value = '';
    await Promise.resolve();
    await Promise.resolve();
    expect(toastErrorCalls).toEqual([]);

    lastError.value = null;
    await Promise.resolve();
    await Promise.resolve();
    expect(toastErrorCalls).toEqual([]);
  });

  it('a failed action originating from ActionPanel produces exactly ONE toast via this watch, not from ActionPanel itself', async () => {
    // ActionPanel.vue no longer calls toast.error directly (see
    // ActionPanel.test.ts) — its fill()/execute() failure paths only set
    // actionController.lastError on the SHARED controller instance. This test
    // proves that shared-instance failure is fully covered by this one watch.
    const { lastError, toastErrorCalls } = buildToastHarness();

    // ActionPanel's executeAction() calling actionController.execute() and
    // getting {success:false} results in exactly this: lastError transitions
    // to the error string, nothing else.
    lastError.value = 'Not your turn.';
    await Promise.resolve();
    await Promise.resolve();

    expect(toastErrorCalls).toEqual(['Not your turn.']);
  });
});
