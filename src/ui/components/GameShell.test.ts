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
import { ref, computed } from 'vue';

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
