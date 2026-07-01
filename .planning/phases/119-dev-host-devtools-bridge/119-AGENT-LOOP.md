# Agent UI Loop — DISCOVER → SELECT → DRIVE → CONFIRM (Phase 119 harness)

> Phase 119 harness/notes. Proves DEV-01 (stable `data-bs-el-id` selectors), DEV-02 (`window.__BOARDSMITH_DEVTOOLS`), and DEV-03 (`boardsmith:action-resolved` event) compose into a vision-free agent loop. The polished public version is Phase 122 (DOC-03).

## The loop

1. **DISCOVER** — read `window.__BOARDSMITH_DEVTOOLS.getActionMetadata()` and `getBoardInteractionState().validElements` on the **outer dev-host page** to learn which actions are available for the active seat and which element IDs are currently valid to select.
2. **SELECT** — `iframe.contentDocument.querySelector('[data-bs-el-id="<id>"]')` to locate the target element in the live DOM (same attribute in custom UI and AutoUI).
3. **DRIVE** — dispatch a bubbling `MouseEvent('click')` on the found element; GameShell's normal action pipeline (`useBoardInteraction`) handles it.
4. **CONFIRM** — listen for `boardsmith:action-resolved` on `iframe.contentWindow`; `detail.success === true` = committed, `false` + `detail.error` = rejected. No polling.

## Shipped shapes (as of Phase 119)

```ts
// window.__BOARDSMITH_DEVTOOLS (outer dev-host page, dev builds only — absent in production)
getState(seat?): PlayerStateView | null
getAvailableActions(seat?): string[]
getActionMetadata(seat?): Record<string, ActionMetadata> | undefined
getBoardInteractionState(): { activeAction: string | null; currentSelectionStep: number; validElements: number[] } | null

// CustomEvent 'boardsmith:action-resolved' dispatched on the game iframe's window
detail: { action: string; success: boolean; seat: number; error?: string }
```

The outer page holds a cached snapshot pushed by the GameShell iframe via `postMessage({ type: 'boardsmith:devtools-state-update', ... })`, so the `get*` reads are synchronous (no await).

## Console harness (run in the OUTER dev-host page console)

```js
// Resolve the active game iframe (the seat frame currently shown)
const iframe = document.querySelector('iframe');           // dev host renders each seat in a GameShell iframe
const dt = window.__BOARDSMITH_DEVTOOLS;

// 1) DISCOVER
console.log('actions', dt.getAvailableActions());
console.log('valid element ids', dt.getBoardInteractionState()?.validElements);
console.log('metadata', dt.getActionMetadata());

// 4) CONFIRM — attach the listener BEFORE driving
iframe.contentWindow.addEventListener('boardsmith:action-resolved', (e) => {
  console.log('[resolved]', e.detail.success ? 'OK' : 'FAIL', e.detail.action, e.detail.error ?? '');
});

// 2) SELECT + 3) DRIVE — pick a currently-valid element id and click it
const id = dt.getBoardInteractionState().validElements[0];
const el = iframe.contentDocument.querySelector(`[data-bs-el-id="${id}"]`);
el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
// → expect a 'boardsmith:action-resolved' with success:true for a legal move
```

### success===false (illegal attempt)

A **click on a non-valid element silently no-ops** (guard in `useSelectable.ts:48`) — it fires nothing. To prove the failure signal, drive an illegal action directly from the **iframe** JS context (out-of-turn or invalid args), e.g. reach the game's action controller and call `execute()` with a bad argument, or attempt an action not in `getAvailableActions()`. Expect `boardsmith:action-resolved` with `success:false` and a populated `error`.

## Repro — custom UI (go-fish)

1. `cd ~/BoardSmithGames/go-fish && npx boardsmith dev`  (serves on http://localhost:5173/)
2. Open http://localhost:5173/ in Chrome; wait to be seated (Seat 0/1).
3. Open the **outer page** DevTools console (not inside the iframe). Run the harness above.
4. Confirm `window.__BOARDSMITH_DEVTOOLS` present; `getAvailableActions()` non-empty and `getBoardInteractionState().validElements` lists ids on your turn (DISCOVER).
5. `querySelector('[data-bs-el-id="<id>"]')` returns the element (SELECT); click it (DRIVE); observe `success:true` (CONFIRM).
6. Drive an illegal action from the iframe context; observe `success:false` + `error`.
7. **Kill the dev server** (Ctrl+C).

## Repro — AutoUI

1. Same setup; after seating, switch the dev-chrome UI dropdown to **"Auto UI"**.
2. Confirm `[data-bs-el-id]` selectors still resolve on AutoUI-rendered elements (DEV-01 parity).
3. Repeat steps 4–6 (success AND failure) in AutoUI.
4. **Kill the dev server** (Ctrl+C) — never leave it running (project hard rule).
