---
phase: 107-ai-assisted-teaching
reviewed: 2026-06-26T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/ai/index.ts
  - src/ai/mcts-bot.ts
  - src/ai/types.ts
  - src/session/ai-controller.ts
  - src/session/game-session.ts
  - src/session/types.ts
  - src/ui/components/ControlsMenu.vue
  - src/ui/components/GameShell.vue
  - src/ui/components/helpers/BoardMessage.vue
  - src/ui/components/helpers/HeatmapOverlay.vue
  - src/ui/components/helpers/HintOverlay.vue
  - src/ui/components/helpers/TutorialOverlay.vue
  - src/ui/components/helpers/overlay-utils.ts
  - vitest.config.ts
findings:
  critical: 0
  warning: 7
  info: 2
  total: 9
status: issues_found
---

# Phase 107: Code Review Report

**Reviewed:** 2026-06-26
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 107 introduces three teaching features — move hints (AI-01), AI-vs-AI narrated demo mode (AI-02), and per-cell MCTS evaluation heatmap (AI-03) — plus the `playWithStats()` MCTS refactor that supports them all. The core snapshot safety invariant is upheld: all new state (`#hint`, `#heatmap`, `#narrationText`, `#demoMode`) is session-layer-only, injected post-`buildPlayerState()`, and cleared on `replaceRunner` (undo/rewind). The transient fields are never in `StoredGameState` or touched by the engine. Overlay parity is structurally sound — all three overlays resolve targets via `buildSelector` and the shared `data-bs-el-*` attribute selectors with no renderer-specific branching.

No critical/blocker issues were found. Seven warnings surfaced, the most consequential of which are a missing idempotency guard on `startDemo()` and a silent error swallow in `applyMoveToSearchGame` during MCTS tree traversal.

---

## Warnings

### WR-01: `startDemo()` missing idempotency guard — double-call permanently corrupts `#savedAIController`

**File:** `src/session/game-session.ts:1080`

`startDemo()` unconditionally overwrites `#savedAIController` with the current `#aiController` on every call. If called twice without an intervening `stopDemo()`, the first call saves the original controller correctly, but the second call saves the now-demo controller. `stopDemo()` then restores the demo controller instead of the original, leaving the game permanently in all-seats AI mode.

The `GameShell` UI guards against this with local `isDemoRunning` state, but that state is not broadcast and cannot protect against concurrent calls from two separate WebSocket connections to the same session (e.g., two browser windows, a spectator window, or a platform re-connect).

**Fix:**
```typescript
startDemo(options?: { ... }): void {
  if (this.#demoMode) return;  // <-- add idempotency guard
  this.#savedAIController = this.#aiController;
  ...
}
```

---

### WR-02: `applyMoveToSearchGame` swallows exceptions silently — leaves `searchGame` at wrong position on error

**File:** `src/ai/mcts-bot.ts:523-533`

During the SELECT phase, `applyMoveToSearchGame` applies a previously-explored node's move to `searchGame`. If `continueFlow` throws (e.g., the engine partially mutates state before rejecting), the exception is swallowed with a comment that "this shouldn't happen." The `searchGame` is now at an unknown position, and all subsequent PLAYOUT/BACKPROPAGATE steps this iteration operate on corrupted state, producing garbage scores that are silently incorporated into the search tree.

The fix is to call `recoverFromUndoFailure()` so `searchGame` is reset to root state and the iteration can proceed (with degraded but not corrupted statistics) rather than continuing from an undefined position.

**Fix:**
```typescript
private applyMoveToSearchGame(node: MCTSNode): void {
  if (!node.parentMove || !this.searchGame || !node.parent) return;
  const currentPlayer = this.getCurrentPlayerFromFlowState(node.parent.flowState);
  try {
    this.searchGame.continueFlow(node.parentMove.action, node.parentMove.args, currentPlayer);
  } catch (error) {
    // Recover: reset searchGame to root so subsequent playout/backprop
    // operates from a valid position rather than an undefined one.
    this.recoverFromUndoFailure();
  }
}
```

---

### WR-03: `setHeatmapVisible(seat, true)` silently returns void when skipped — caller cannot distinguish success from skip

**File:** `src/session/game-session.ts:1033-1036`

When `#heatmapUpdating` is already `true`, `setHeatmapVisible(seat, true)` returns `Promise<void>` without broadcasting or throwing. The heatmap state in broadcast remains unchanged. The GameShell catches the returned promise but cannot tell whether the request was executed or silently dropped — the UI sees no update, and `isHeatmapVisibleProp` (derived from broadcast state) stays at its previous value.

By contrast, `requestHint()` throws a descriptive error for concurrent calls (`"Hint already in progress for seat N"`), which the UI surfaces as a toast. The heatmap path should be consistent.

**Fix:** Either throw with a recognisable error so the UI can show a "Busy, try again" toast:
```typescript
if (this.#heatmapUpdating || this.#aiController?.isThinking()) {
  throw new Error('Heatmap evaluation is already in progress — please wait.');
}
```
Or document that the caller must rely on the next broadcast to determine final state and not treat a silent return as confirmation.

---

### WR-04: `isDemoRunning` is local Vue ref in GameShell — can desync with session state across concurrent connections

**File:** `src/ui/components/GameShell.vue:654-662`

`isDemoRunning` is a local `ref(false)` that is never derived from broadcast state. The comment acknowledges this: "the session-side getter is not broadcast." This creates two concrete failure modes:

1. **Two-window scenario**: Window A starts the demo (`isDemoRunning.value = true`). Window B connects — its `isDemoRunning` is false. Window B's ControlsMenu shows "Watch AI demo". Clicking it calls `platformRequest('demo-start', {})` → `session.startDemo()` a second time. Without WR-01's guard, this corrupts `#savedAIController`.

2. **Reconnect scenario**: If the player refreshes the page mid-demo, `isDemoRunning` resets to `false` on reconnect, so "Stop demo" is never shown even though the demo is running server-side.

**Fix:** Add `isDemoRunning: boolean` to `PlayerGameState` (alongside `narration`), set it in `broadcast()`, and derive `isDemoRunning` from state in GameShell:
```typescript
// In GameShell.vue
const isDemoRunning = computed(
  () => (state.value?.state as any)?.isDemoRunning ?? false
);
```

This also removes the need for the WR-01 guard (though both fixes are still worth applying for defense in depth).

---

### WR-05: `requestHint()` calls `playWithStats()` instead of `play()` — forces single-mode MCTS, discards returned stats

**File:** `src/session/game-session.ts:960`

```typescript
const { move } = await bot.playWithStats();
```

`playWithStats()` is documented to "always run a single-mode search regardless of the parallel config value." For 'hard' difficulty (`parallel: 2`), `play()` would fan out two independent trees and aggregate by vote, giving a stronger move in the same time budget. The `stats` returned by `playWithStats()` are immediately destructured away — they are never used. The hint request is user-interactive (blocking the UI), so this is a user-visible latency regression at 'hard' difficulty.

**Fix:**
```typescript
// requestHint only needs the move; use play() so parallel mode is available
const move = await bot.play();
const ref = this.#extractMoveTarget(move);
```

The heatmap path (`setHeatmapVisible`) correctly keeps `playWithStats()` because it needs the stats.

---

### WR-06: Default narrator in `startDemo()` produces `[object Object]` for non-primitive action arguments

**File:** `src/session/game-session.ts:1115-1118`

```typescript
const argSummary = Object.entries(args)
  .map(([k, v]) => `${k}=${String(v)}`)
  .join(' ');
```

`String(obj)` for any `Record<string, unknown>` arg value produces the useless string `[object Object]`. Board games routinely pass element IDs, coordinates, or card objects as args. The default narration is therefore unintelligible for most games that don't supply a custom `narrator` — the very games most likely to use the default are the ones most affected.

Narration text is rendered via Vue slot interpolation (not `v-html`), so this is not a security issue. It is, however, a correctness issue: the feature ships with misleading default output.

**Fix:**
```typescript
const argSummary = Object.entries(args)
  .map(([k, v]) => {
    if (v !== null && typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
    return `${k}=${String(v)}`;
  })
  .join(' ');
```

And add a JSDoc note to `startDemo()` that games with rich arg types should supply a custom `narrator` function.

---

### WR-07: `#hintThinking` (per-seat) and `#heatmapUpdating` (session-wide) have inconsistent concurrency scoping

**File:** `src/session/game-session.ts:229-232, 984-985`

`#hintThinking` is a `Set<number>` — two simultaneous hint requests for different seats are both allowed to run concurrent MCTS searches. `#heatmapUpdating` is a single `boolean` — a heatmap request for seat 2 is blocked if seat 1's heatmap is computing.

The heatmap comment ("session-wide because MCTS is CPU-bound") applies equally to hint requests, which also run full MCTS searches. Allowing two concurrent hint searches for two seats means two simultaneous MCTS trees run in the same Node.js event loop, competing for the same CPU. In a 2-player simultaneous-action game, both seats could be at a decision point, and both could request hints at once.

**Fix:** Apply the same session-wide guard to hints, or document why concurrent hints are acceptable while concurrent heatmaps are not:
```typescript
// Replace per-seat Set with a single session-wide flag
#searchInFlight = false;

async requestHint(seat: number): Promise<void> {
  ...
  if (this.#searchInFlight) throw new Error(`Hint already in progress`);
  this.#searchInFlight = true;
  try { ... } finally { this.#searchInFlight = false; }
}
```

---

## Info

### IN-01: Phase 107 test coverage gap — `playWithStats()` and session-layer teaching API have no in-repo tests

**File:** `vitest.config.ts:21-22`

`mcts-stats-checkers.test.ts` is excluded from vitest (depends on external `@boardsmith/checkers-rules`). This file's name strongly implies it tests the `BotMoveStats` / `playWithStats()` path introduced in Phase 107. `mcts-cache.test.ts` is similarly excluded. No in-repo test file was found exercising `requestHint()`, `setHeatmapVisible()`, `startDemo()`/`stopDemo()`, or `playWithStats()` directly.

Phase 107 is entirely tested against external games that are not part of this repo's CI. If those games are not run, regressions in the new MCTS stats pipeline and session teaching API are invisible.

**Fix:** Add an in-repo test file (e.g., `src/session/teaching.test.ts`) using the existing `TestGame` or a minimal `Game` subclass that exercises at least: `playWithStats()` returns valid `BotMoveStats[]`, `requestHint()` sets `#hint` and broadcasts, `setHeatmapVisible()` builds entries, `startDemo()`/`stopDemo()` round-trips the controller reference correctly, and double-`startDemo()` is idempotent.

---

### IN-02: `cssEscape` polyfill in `overlay-utils.ts` is incomplete for non-standard names in test environments

**File:** `src/ui/components/helpers/overlay-utils.ts:23-25`

```typescript
return value.replace(/["\\]/g, '\\$&');
```

The polyfill (active only when `CSS.escape` is unavailable, i.e., jsdom) escapes only double-quote and backslash. Characters such as newline (`\n`), null byte (`\0`), or other CSS string terminators are not escaped. In jsdom-based unit tests, an element name containing a newline would produce a broken selector that silently fails to match — the overlay renders without a ring, and no error is thrown.

Production browsers always use the native `CSS.escape`. This is a test-environment-only correctness issue, but it can mask failures when overlay tests run against programmatically-constructed elements with unusual names.

**Fix:** Extend the polyfill to cover at minimum null bytes and control characters:
```typescript
return value.replace(/[\0\n\r\f"\\]/g, '\\$&');
```

---

_Reviewed: 2026-06-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
