# Browser Testing (Agent-Driven, No Vision)

`boardsmith dev` exposes a small dev-only bridge that lets an agent (or a
script) drive a running game **by stable element id** and **confirm outcomes
from an observable signal** — no coordinate-clicking, no screenshots, no
polling. This doc is the practical guide to that bridge.

It has three pieces:

1. **Stable selectors** — `data-bs-el-id` (and its FLIP alias
   `data-element-id`) on every selectable element, in both custom UIs and
   AutoUI.
2. **`window.__BOARDSMITH_DEVTOOLS`** — a synchronous, read-only snapshot of
   game state, available actions, and the current valid selection, exposed on
   the **outer dev-host page**.
3. **`boardsmith:action-resolved`** — a `CustomEvent` dispatched on the
   **game iframe's window** every time an action resolves, so you can confirm
   success/failure without polling.

All three are dev-only, gated by `import.meta.env.DEV`. They are
dead-code-eliminated from production builds — `window.__BOARDSMITH_DEVTOOLS`
is simply `undefined` in a shipped game, and the `action-resolved` event never
dispatches.

## Background: the dev host layout

`npx boardsmith dev` serves an outer "Dev" chrome page
(`src/cli/dev-host/DevHost.vue`) with a seat selector, UI switcher, and
debug tools. Each connected seat renders inside a `GameShell` **iframe running
in platform mode** — the exact code that runs in production. This matters for
the bridge:

- `window.__BOARDSMITH_DEVTOOLS` lives on the **outer page's `window`**, not
  inside the iframe. It's a cache that DevHost keeps up to date by listening
  for `postMessage({ type: 'boardsmith:devtools-state-update', ... })` pushed
  from the iframe on every state change — so reads are synchronous, no
  `await` needed.
- `boardsmith:action-resolved` is dispatched inside `useActionController`,
  which runs **inside the game iframe** — so you listen for it on
  `iframe.contentWindow`, not on the outer `window`.

## 1. Stable selectors: `data-bs-el-id`

Every selectable board element carries `data-bs-el-id="<elementId>"`, emitted
by the single-source `anchorAttrs()` helper
(`src/ui/composables/useBoardInteraction.ts`). This attribute is identical in
custom UIs (via `useSelectable`/`useSelectableGrid`) and in every AutoUI
renderer (`CardRenderer`, `PieceRenderer`, `SpaceRenderer`, `DieRenderer`) — so
the same selector works regardless of which UI is currently rendering the
game.

AutoUI renderers additionally emit `data-element-id` — the older attribute
consumed by FLIP animation (`useFLIP`'s default selector is
`[data-element-id]`). Treat `data-bs-el-id` as canonical for selection;
`data-element-id` is present alongside it as the FLIP alias, not a
replacement.

```js
// Find element 42 inside the active game iframe, regardless of UI mode:
const el = iframe.contentDocument.querySelector('[data-bs-el-id="42"]');
```

Never select by CSS position, class name churn, or pixel coordinates — those
are cosmetic and change with theme/layout. `data-bs-el-id` is the only
selector contract.

## 2. `window.__BOARDSMITH_DEVTOOLS`

Exposed on the **outer dev-host page** window (not the iframe) when
`import.meta.env.DEV` is true:

```ts
interface BoardsmithDevtools {
  /** Perspective-aware game state for the given seat (current seat if omitted). */
  getState(seat?: number): unknown | null;
  /** Available action names for the given seat. */
  getAvailableActions(seat?: number): string[];
  /** Action metadata (labels, help text, selection config) for the given seat. */
  getActionMetadata(seat?: number): Record<string, unknown> | undefined;
  /** Active action, current selection step, and the currently valid element ids. */
  getBoardInteractionState(): {
    activeAction: string | null;
    currentSelectionStep: number;
    validElements: number[];
  } | null;
}
```

All four methods are synchronous reads against a cached snapshot — there is
no round trip to the server or the iframe when you call them. If
`window.__BOARDSMITH_DEVTOOLS` is `undefined`, you're either in a production
build or the page hasn't finished its first snapshot push yet (reconnect or
wait a tick).

## 3. `boardsmith:action-resolved`

Dispatched on the **game iframe's `window`** at every terminal
action-resolution point inside `useActionController`
(`src/ui/composables/useActionController.ts`) — including each link of a
chained follow-up action, so you get exactly one event per resolved action:

```ts
interface BoardsmithActionResolvedDetail {
  action: string;
  success: boolean;
  seat: number;
  error?: string; // present only when success is false
}
```

```js
iframe.contentWindow.addEventListener('boardsmith:action-resolved', (e) => {
  console.log(e.detail.success ? 'OK' : 'FAIL', e.detail.action, e.detail.error ?? '');
});
```

Attach the listener **before** driving the action — there's no buffering or
polling, so a listener added after the event fires misses it.

### Important: what `success: false` does and does not cover

`success: false` fires **only when a server round-trip rejects an
in-progress action** — i.e., `sendAction()` resolved with `{ success: false }`
or threw, after the action was already dispatched to the server.

Every **client-side guard** — "Not your turn", "Action is not available",
"Invalid selection", "Missing required selection" — is an **early return that
dispatches nothing at all**. No event fires for those cases; the action never
reached the server.

This matters in practice: a pit-of-success game (e.g. go-fish) validates
input client-side before it can ever reach the server — an `ask` action's
`target`/`rank` choices *are* the valid set, so any bad value is rejected
client-side and never dispatched, while any valid value is accepted
(`success: true`). **You should not expect to see `success: false` in the
browser from normal UI-driven input on a well-designed game** — that's the
system working as intended, not a gap in the bridge.

To actually observe `success: false` in the browser, you need a rule the
client genuinely can't pre-check (a server-only invariant), or a
stale/out-of-turn submission that manages to bypass the client's
`isMyTurn` guard. The failure path itself is covered at the unit level by
`src/ui/composables/useActionController.devtools.test.ts`, which mocks
`sendAction` to return `{ success: false, error }` and asserts the event
fires with that shape at the same dispatch site.

## The agent loop: DISCOVER → SELECT → DRIVE → CONFIRM

1. **DISCOVER** — read `getActionMetadata()` and
   `getBoardInteractionState().validElements` on the outer page to learn
   which actions are available for the active seat and which element ids are
   currently selectable.
2. **SELECT** — `iframe.contentDocument.querySelector('[data-bs-el-id="<id>"]')`
   to find the live DOM node for a valid id (same attribute in custom UI and
   AutoUI).
3. **DRIVE** — dispatch a bubbling `click`; GameShell's normal interaction
   pipeline (`useBoardInteraction`) handles it exactly as it would a real
   pointer event.
4. **CONFIRM** — listen for `boardsmith:action-resolved` on
   `iframe.contentWindow`, attached *before* the click. `success: true` means
   committed; `success: false` + `error` means server-rejected. No polling,
   no fixed waits.

### Console harness (paste into the outer dev-host page console)

```js
const iframe = document.querySelector('iframe'); // the active seat's GameShell iframe
const dt = window.__BOARDSMITH_DEVTOOLS;

// 1) DISCOVER
console.log('actions', dt.getAvailableActions());
console.log('valid element ids', dt.getBoardInteractionState()?.validElements);
console.log('metadata', dt.getActionMetadata());

// 4) CONFIRM — attach before driving
iframe.contentWindow.addEventListener('boardsmith:action-resolved', (e) => {
  console.log('[resolved]', e.detail.success ? 'OK' : 'FAIL', e.detail.action, e.detail.error ?? '');
});

// 2) SELECT + 3) DRIVE
const id = dt.getBoardInteractionState().validElements[0];
const el = iframe.contentDocument.querySelector(`[data-bs-el-id="${id}"]`);
el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
// → expect boardsmith:action-resolved with success:true for a legal move
```

### Repro — custom UI (go-fish)

1. `cd ~/BoardSmithGames/go-fish && npx boardsmith dev` (serves on
   `http://localhost:5173/`).
2. Open the page in Chrome; wait to be seated.
3. Open DevTools on the **outer page** (not inside the iframe) and run the
   harness above.
4. Confirm `getAvailableActions()` is non-empty and
   `getBoardInteractionState().validElements` lists ids while it's your turn.
5. `querySelector('[data-bs-el-id="<id>"]')` resolves the element, the click
   drives the action, and you see `success: true`.
6. Kill the dev server (`Ctrl+C`) when done.

### Repro — AutoUI

1. Same setup; after seating, switch the dev-chrome UI dropdown to
   **"Auto UI"**.
2. Confirm `[data-bs-el-id]` still resolves elements rendered by AutoUI —
   the selector contract is identical across both UI modes.
3. Repeat DISCOVER/SELECT/DRIVE/CONFIRM.
4. Kill the dev server (`Ctrl+C`) when done.

---

**Always kill the dev server before you finish.** Never leave `boardsmith dev`
running in the background — this is a hard project rule, not just tidiness.
