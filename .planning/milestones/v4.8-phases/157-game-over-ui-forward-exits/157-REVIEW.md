---
phase: 157-game-over-ui-forward-exits
reviewed: 2026-07-20T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/ui/components/GameOverCard.vue
  - src/ui/components/GameShell.vue
  - src/session/snapshot-session-host.ts
  - src/cli/dev-host/multiplayer-host.ts
  - src/cli/dev-host/DevHost.vue
  - src/cli/dev-host/bridge.ts
  - src/ui/composables/liveRegionAnnouncer.ts
findings:
  critical: 1
  warning: 1
  info: 0
  total: 2
status: resolved
---

# Phase 157: Code Review Report

**Reviewed:** 2026-07-20
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

The `isDraw` threading contract is correctly typed and computed end-to-end at every hop except one: `DevHost.vue`'s `game_state` WebSocket handler drops the `isDraw` field before relaying the frame to the game iframe via `postMessage`, so the entire D10 "Draw" label never appears under `boardsmith dev` — every genuine draw is misrendered as "Game Over". Slot suppression (`#game-over` vs default `GameOverCard`), the D11 forward-exit routing (`debug:restart` intercepted before the generic `server_request` forward, "New Game" restarts via the real path, "leave" still leaves), the `|| !this.session` guard hardening, and dismiss semantics (Escape/close never restart or leave, focus trap opens/closes correctly, focus returns to a `tabindex="-1"` board region) all check out. One accessibility placement defect was found in `GameOverCard.vue`: `aria-modal="true"` is set on a non-dialog wrapper `<div>` instead of the `role="dialog"` element, which most screen readers will not honor.

## Critical Issues

### CR-01: `isDraw` is dropped in DevHost.vue's game_state relay, breaking the Draw label in `boardsmith dev`

**File:** `src/cli/dev-host/DevHost.vue:161-168`
**Issue:** `MultiplayerHost` correctly computes and sends `isDraw` on every `game_state` frame (`multiplayer-host.ts:55-63`, `607`, `607-608`, `674`, `683-684` all populate `isDraw`), and `SnapshotSessionHost` correctly derives it as `isComplete && winners.length === 0` (`snapshot-session-host.ts:283`, `307`). But `DevHost.vue`'s `onHostMessage` handler for `'game_state'` builds `lastGameState` without copying `msg.isDraw`:
```ts
case 'game_state':
  lastGameState = {
    type: 'game_state',
    view: msg.view,
    isComplete: msg.isComplete,
    winners: msg.winners,
  };
  postToGame(lastGameState);
```
The resulting `postMessage` payload therefore never carries `isDraw`. In `GameShell.vue`'s platform-mode handler, `isDraw.value = data.isDraw === true` then always evaluates to `false` (undefined !== true), so `GameOverCard`'s `isDraw` prop is always `false` in the dev host — indistinguishable from the "winner data unavailable" degrade. Every genuine draw shows "Game Over" instead of "Draw" whenever tested via `boardsmith dev` (the primary local dev/testing path for this feature). The same missing field also propagates through the `request-state` retry path (`DevHost.vue:244-248`) and the iframe-reload replay path (`onIframeLoad`, `DevHost.vue:213-214`), since both re-post the same incomplete `lastGameState` object.
**Fix:**
```ts
case 'game_state':
  lastGameState = {
    type: 'game_state',
    view: msg.view,
    isComplete: msg.isComplete,
    winners: msg.winners,
    isDraw: msg.isDraw,
  };
  postToGame(lastGameState);
```

## Warnings

### WR-01: `aria-modal` is placed on the wrong element in GameOverCard

**File:** `src/ui/components/GameOverCard.vue:109-116`
**Issue:** The scrim wrapper carries `aria-modal="true"` but has no ARIA role, while the actual dialog element (`role="dialog"`) two lines down carries no `aria-modal` attribute:
```html
<div class="game-over-scrim" aria-modal="true">
  <div ref="cardRef" class="game-over-card" role="dialog" aria-labelledby="game-over-title" @keydown="handleKeydown">
```
Per the WAI-ARIA APG, `aria-modal` must be set on the element that carries `role="dialog"`/`role="alertdialog"` for assistive technology to suppress the rest of the page from the accessibility tree. Placed on a plain `<div>` with no role, it has no defined semantic effect and screen readers will not treat the dialog as modal, potentially letting AT navigate to background content that the focus trap otherwise hides from keyboard users.
**Fix:** Move `aria-modal="true"` onto the `role="dialog"` element:
```html
<div class="game-over-scrim">
  <div
    ref="cardRef"
    class="game-over-card"
    role="dialog"
    aria-modal="true"
    aria-labelledby="game-over-title"
    @keydown="handleKeydown"
  >
```

---

_Reviewed: 2026-07-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
