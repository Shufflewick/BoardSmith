# Phase 119: Dev-Host Devtools Bridge - Research

**Researched:** 2026-06-30
**Domain:** UI instrumentation — DOM data attributes, iframe↔outer-page postMessage bridge, CustomEvent dispatch, end-to-end agent loop
**Confidence:** HIGH (all findings from direct `src/` inspection with file:line evidence)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All surface decisions are **locked** in the approved design doc (Part 2 DEV). Build to it exactly.

- **DEV-01**: Add `data-bs-el-id` (and `data-bs-el-notation` / `data-bs-el-name` where applicable) ALONGSIDE existing `data-element-id` in the four AutoUI renderers. Standardize on `data-bs-el-id` (align AutoUI to `anchorAttrs()` at useBoardInteraction.ts:408). Do NOT modify `anchorAttrs()` to emit `data-element-id` (Common Pitfall #2). Keep `data-element-id` (FLIP alias). Result: `[data-bs-el-id="42"]` works in BOTH custom UI and AutoUI.
- **DEV-02**: Sender in `GameShell.vue` — watch reactive state from `useActionController` + `useBoardInteraction`; on change, postMessage `DevtoolsStateMessage` (type `'boardsmith:devtools-state-update'`) to `window.parent`. Only when `__BOARDSMITH_DEV__` is true. Receiver in `DevHost.vue` — cache local reactive snapshot, expose `window.__BOARDSMITH_DEVTOOLS` with synchronous read methods. Add `BoardsmithDevtools` interface to `src/ui/global.d.ts`.
- **DEV-03**: Dispatch `window.dispatchEvent(new CustomEvent('boardsmith:action-resolved', { detail }))` at BOTH `actionCompletedTick` increment sites in `useActionController.ts` (~line 1074 direct-execute path and ~line 1505 selection-step path).
- **DEV-04**: No new source beyond DEV-01/02/03. Documented + browser-proven agent loop: DISCOVER → SELECT → DRIVE → CONFIRM. Demonstrate in custom-UI game AND AutoUI game, each with `success===true` and `success===false`.

### Claude's Discretion

- The exact GameShell watcher wiring (which reactive sources, debounce) and DevHost snapshot structure, as long as the locked interface + message shape hold.
- Where the agent-loop doc lives (a Phase 119 markdown harness/notes; the polished public doc is Phase 122 DOC-03).
- Test structure (unit tests for data-attribute emission + event dispatch; browser proof is manual/Chrome-extension-driven).

### Deferred Ideas (OUT OF SCOPE)

- DEV-F1 (programmatic seat-switch / `?dev-seat=N`)
- DEV-F2 (deterministic-AI seed / forceAIMove)
- Polished public browser-testing docs — Phase 122 (DOC-03)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEV-01 | Stable `data-element-id` / `data-bs-el-id` selectors in both custom UI and AutoUI | ALREADY DONE via `useSelectable → anchorAttrs` — see Critical Finding below |
| DEV-02 | `boardsmith dev` page exposes `window.__BOARDSMITH_DEVTOOLS` global | New postMessage bridge in GameShell.vue (sender) + DevHost.vue (receiver) |
| DEV-03 | Dev-host page emits `boardsmith:action-resolved` CustomEvent distinguishing success/failure | New CustomEvent dispatch at direct-execute path AND selection-step path in useActionController.ts |
| DEV-04 | Agent UI loop documented and browser-proven (custom-UI + AutoUI) | Go Fish (custom UI) + go-fish dev UI switcher "Auto UI" mode; DEV-01/02/03 must land first |
</phase_requirements>

---

## Summary

Phase 119 instruments the `boardsmith dev` host so agents and tools can drive the UI via stable element selectors, read synchronous game state from `window.__BOARDSMITH_DEVTOOLS`, and confirm action outcomes via a `CustomEvent` — without polling, coordinate-clicking, or vision.

**Critical finding:** DEV-01's core change is **already present in the codebase**. All four AutoUI renderers already emit `data-bs-el-id` (and `data-bs-el-notation`/`data-bs-el-name` where applicable) via `v-bind="selectableAttrs"` → `useSelectable.attrs` → `anchorAttrs(identity())`. A single-source guard test in `anchorAttrs.test.ts:174` actively PREVENTS adding `data-bs-el-*` literals directly to renderer files — the design doc's suggested inline addition (`:data-bs-el-id="element.id"`) would BREAK that test. DEV-01 work is **verification + a DOM-level renderer mount test**, not a code addition.

DEV-02 (postMessage bridge) and DEV-03 (CustomEvent) are the primary implementation targets. DEV-04 is the browser-proof acceptance gate.

**Primary recommendation:** Write DEV-02 sender in GameShell gated by `isDevBuild` (= `import.meta.env.DEV`, the established pattern — NOT the declared-but-never-set `__BOARDSMITH_DEV__` constant). Plug the DEV-03 dispatches into both `execute()` path branches and alongside the existing `actionCompletedTick.value++` at line 1505 (with name captured before the pre-line-1492 clear). Prove DEV-04 with go-fish (custom UI) and go-fish switched to "Auto UI" via the dev chrome dropdown.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DOM element selector attributes (`data-bs-el-id`) | Browser/Client (AutoUI renderers) | — | Emitted at render time via `useSelectable → anchorAttrs`; already done |
| Action-resolved `CustomEvent` | Browser/Client (inside iframe) | — | `useActionController` owns action lifecycle; event dispatched on `window` inside the iframe |
| Devtools state broadcast | Browser/Client (iframe → outer) | — | GameShell (iframe) sends via `window.parent.postMessage`; DevHost (outer) receives |
| `window.__BOARDSMITH_DEVTOOLS` global | Browser/Client (outer dev-host page) | — | Assigned in DevHost.vue after receiving postMessage; synchronous read for agents |
| Agent loop harness (DEV-04) | Browser/Client (outer dev-host page) | — | Agent runs in outer page, reads global, queries `iframe.contentDocument`, listens on `iframe.contentWindow` |

---

## Standard Stack

No new packages. All implementation uses existing Vue 3 + TypeScript patterns already in the codebase.

### Implementation Files

| File | Role | Change Type |
|------|------|-------------|
| `src/ui/components/auto-ui/renderers/PieceRenderer.vue` | AutoUI element renderer | VERIFY only — `data-bs-el-id` already emitted via `v-bind="selectableAttrs"` |
| `src/ui/components/auto-ui/renderers/SpaceRenderer.vue` | AutoUI element renderer | VERIFY only |
| `src/ui/components/auto-ui/renderers/DieRenderer.vue` | AutoUI element renderer | VERIFY only |
| `src/ui/components/auto-ui/renderers/CardRenderer.vue` | AutoUI element renderer | VERIFY only |
| `src/ui/components/GameShell.vue` | Platform iframe (game) | ADD: watcher + `window.parent.postMessage` sender for devtools bridge |
| `src/ui/global.d.ts` | TypeScript declarations | ADD: `BoardsmithDevtools` interface + `Window.__BOARDSMITH_DEVTOOLS` declaration |
| `src/cli/dev-host/DevHost.vue` | Outer dev-host page | ADD: `'boardsmith:devtools-state-update'` handler in `onWindowMessage`; `window.__BOARDSMITH_DEVTOOLS` assignment in `onMounted` |
| `src/ui/composables/useActionController.ts` | Action lifecycle | ADD: `window.dispatchEvent(new CustomEvent(...))` at direct-execute path (two branches in `execute()`) and selection-step path (line 1505) |

---

## Package Legitimacy Audit

No external packages are installed in this phase. N/A.

---

## Architecture Patterns

### DEV-01: Element Selector Attribute (ALREADY DONE)

**Current flow** `[VERIFIED: direct src/ inspection]`:

```
useSelectable(elementIdentity, boardInteraction, ...) [useSelectable.ts:41]
  → attrs = computed(() => ({ role, tabindex, ...anchorAttrs(identity()) })) [useSelectable.ts:53-58]
  → anchorAttrs({ id, notation?, name? }) [useBoardInteraction.ts:408]
    → emits { 'data-bs-el-id': String(id), 'data-bs-el-notation': ..., 'data-bs-el-name': ... }
  → returned as `selectableAttrs`

Each renderer:
  v-bind="selectableAttrs"   → DOM element gets data-bs-el-id (always, since element.id exists)
  :data-element-id="element.id"   → keeps FLIP alias [useFLIP.ts:138: DEFAULT_SELECTOR = '[data-element-id]']
```

**Single-source guard** `[VERIFIED: anchorAttrs.test.ts:174]`:
```typescript
// This test WILL FAIL if data-bs-el-* literals appear directly in renderer files
it('no renderer file contains a data-bs-el literal (anchors come only from anchorAttrs)', () => {
  ...
  const hasLiteral = content.includes('data-bs-el-id') || ...
  expect(hasLiteral, `...must not define data-bs-el-* directly (use anchorAttrs)`).toBe(false);
});
```

The design doc's suggested change (`:data-bs-el-id="element.id"` inline) would BREAK this guard. Do not add inline literals.

**Action for Phase 119:** Confirm the existing behavior with a new DOM-level mount test. The test mounts e.g. PieceRenderer with a mock boardInteraction and asserts `wrapper.element.getAttribute('data-bs-el-id') === String(element.id)`. New test file: `src/ui/components/auto-ui/renderers/renderers.devtools-attrs.test.ts`.

---

### DEV-02: postMessage Bridge

**Architecture** (dev-host only, `isDevBuild` guard):

```
GameShell.vue (inside iframe)
  watch([availableActions, actionMetadata, boardInteraction.state, playerSeat], () => {
    if (!isDevBuild || !platformMode.value) return;
    window.parent.postMessage({
      source: 'shufflewick-game',
      type: 'boardsmith:devtools-state-update',
      seat: playerSeat.value,
      state: state.value?.state ?? null,
      availableActions: availableActions.value,
      actionMetadata: actionMetadata.value,
      boardInteraction: {
        activeAction: boardInteraction.state.currentAction,
        currentSelectionStep: boardInteraction.state.currentPickIndex,
        validElements: boardInteraction.state.validElements.map(v => v.id),
      } ?? null,
    }, '*');
  }, { deep: true })

DevHost.vue (outer page) — inside onWindowMessage():
  if (data.type === 'boardsmith:devtools-state-update') {
    devtoolsSnapshot.value = data;  // reactive ref holding latest message
    return;
  }

onMounted():
  window.__BOARDSMITH_DEVTOOLS = {
    getState:               (seat?) => devtoolsSnapshot.value?.state ?? null,
    getAvailableActions:    (seat?) => devtoolsSnapshot.value?.availableActions ?? [],
    getActionMetadata:      (seat?) => devtoolsSnapshot.value?.actionMetadata,
    getBoardInteractionState: () => devtoolsSnapshot.value?.boardInteraction ?? null,
  };
```

**Reactive sources to watch in GameShell** `[VERIFIED: direct src/ inspection]`:
- `availableActions` — `computed()` from `state.value.flowState.availableActions` — GameShell line 365
- `actionMetadata` — `computed()` from `state.value?.state?.actionMetadata` — GameShell line 348
- `playerSeat` — `ref<number>(-1)` — GameShell line 233
- `boardInteraction.state` — `BoardInteractionState` object from `createBoardInteraction()` — GameShell line 667; fields: `currentAction`, `currentPickIndex`, `validElements` (array of `{ id, ref, disabled? }`)
- `state.value?.state` — the raw `PlayerStateView`-like object from the server broadcast (contains the full perspective-aware state for the seat)

**Note on `__BOARDSMITH_DEV__` vs `isDevBuild`** `[VERIFIED: GameShell.vue:174, global.d.ts:1]`:
- `global.d.ts:1` declares `__BOARDSMITH_DEV__: boolean | undefined` as a TypeScript global — it is NEVER set as a Vite define constant anywhere in the codebase (searched all of `src/`)
- GameShell's actual dev guard pattern is `const isDevBuild = import.meta.env.DEV` (GameShell.vue:174)
- **Implementation MUST use `isDevBuild`**, not `__BOARDSMITH_DEV__`, for the sender guard. The `__BOARDSMITH_DEV__` declaration in `global.d.ts` is a leftover/aspirational declaration, not a runtime value. Using `typeof __BOARDSMITH_DEV__ !== 'undefined' && __BOARDSMITH_DEV__` would always be falsy at runtime.

**Existing postMessage patterns to follow** `[VERIFIED: DevHost.vue]`:
- Sender: `window.parent.postMessage({ source: 'shufflewick-game', type: '...', ... }, '*')` — GameShell.vue lines 202, 431, 1099
- Receiver: `onWindowMessage()` at DevHost.vue:209 with `data.source !== 'shufflewick-game'` guard for all inbound messages
- Debug toggle pattern: `postToGame({ type: 'dev-debug-toggle' })` → GameShell handles it; `data.type === 'dev-debug-state'` comes back — DevHost.vue lines 229-232

**New message type fits directly in the `onWindowMessage` switch** at DevHost.vue:209. Add before the closing `}`. The `devtoolsSnapshot` reactive ref holds the latest message; `window.__BOARDSMITH_DEVTOOLS` read methods close over it.

**`boardInteraction.state` is a plain reactive object** `[VERIFIED: useBoardInteraction.ts:50-94]`:
- `currentAction: string | null` — active action name
- `currentPickIndex: number` — 0-based pick step index
- `validElements: ValidElement[]` — `{ id: number, ref: ElementRef, disabled?: string }[]`
- These are the exact fields for `getBoardInteractionState()` return shape (map `validElements` to `id` array)

---

### DEV-03: Action-Resolved CustomEvent

**Current state** `[VERIFIED: direct grep]`:
```
grep -n "actionCompletedTick" src/ui/composables/useActionController.ts
186:  const actionCompletedTick = ref(0);
1505:          actionCompletedTick.value++;
1811:    actionCompletedTick: readonly(actionCompletedTick),
```

There is ONLY ONE increment site at line 1505. The design doc's "~line 1074 direct-execute" site does NOT currently have an increment — it uses `isExecuting` toggle instead. Phase 119 must add dispatches at **both** paths.

**Site 1: `execute()` direct-execute path** `[VERIFIED: useActionController.ts:968-1098]`:

The `execute()` function (line 968) has two internal send paths:
- No-metadata path (lines 1000-1023): `const result = await sendAction(actionName, args)` at line 1005
- Metadata path (lines 1064-1098): `const result = await sendAction(actionName, finalArgs)` at line 1069

Both paths have a `catch` block that sets `lastError`. The dispatch covers both try (result obtained) and catch (error thrown) cases.

Available variables at both execute() paths:
- `actionName`: function parameter
- `result.success`, `result.error`: from sendAction return
- `playerSeat?.value ?? 0`: seat, from closure at line 149

Dispatch pattern (inside try, after `result` obtained):
```typescript
if (isDevBuild) {
  window.dispatchEvent(new CustomEvent<BoardsmithActionResolvedDetail>(
    'boardsmith:action-resolved',
    { detail: {
        action: actionName,
        success: result.success,
        seat: playerSeat?.value ?? 0,
        ...(result.success ? {} : { error: result.error }),
    }}
  ));
}
```

Also dispatch in the `catch` branch with `{ success: false, error }`.

**Site 2: `handleOnSelectFill()` selection-step path** `[VERIFIED: useActionController.ts:1462-1508]`:

The `actionCompletedTick.value++` at line 1505 is in the `else` branch of `if (result.followUp)` inside `if (result.actionComplete)` block. Before reaching line 1505, `currentAction.value` has been set to `null` at line 1492.

**Critical implementation note:** Capture the action name BEFORE the clear:

```typescript
if (result.actionComplete) {
  const completedActionName = currentAction.value;  // ← capture HERE, before line 1492 clears it
  currentAction.value = null;
  clearArgs();
  clearAdvancedState();

  if (result.followUp) {
    queueFollowUp(result.followUp);
  } else {
    actionCompletedTick.value++;  // existing line 1505
    if (isDevBuild) {
      window.dispatchEvent(new CustomEvent<BoardsmithActionResolvedDetail>(
        'boardsmith:action-resolved',
        { detail: {
            action: completedActionName ?? '',
            success: true,
            seat: player,  // = playerSeat?.value ?? 0, defined at line 1468
        }}
      ));
    }
  }
  return { valid: true };
}
```

**`player` variable at line 1505** `[VERIFIED: useActionController.ts:1468]`:
```typescript
const player = playerSeat?.value ?? 0;  // line 1468, in scope throughout handleOnSelectFill
```

**Type declaration** — add to `src/ui/global.d.ts`:
```typescript
interface BoardsmithActionResolvedDetail {
  action: string;
  success: boolean;
  seat: number;
  error?: string;
}
```

**`window.dispatchEvent` is correct** for in-iframe dispatch. The DevHost outer page listens via `iframe.contentWindow.addEventListener('boardsmith:action-resolved', ...)`. Since the iframe is same-origin (both served by the same Vite dev server on port 5173), `iframe.contentWindow` is accessible from the outer page.

---

### DEV-04: Browser Proof — Agent Loop

**Dev server** `[VERIFIED: src/cli/cli.ts:33]`:
- Default port: 5173
- Command: `cd ~/BoardSmithGames/go-fish && npx boardsmith dev`
- Outer page: `http://localhost:5173/` (DevHost.vue)
- GameShell iframe: `http://localhost:5173/<game-url>` (same origin)

**Custom-UI game**: Go Fish — uses `#game-board` slot with `GameTable.vue` (`~/BoardSmithGames/go-fish/src/ui/App.vue`). Custom clickable elements use `useBoardInteraction` / `anchorAttrs` → emit `data-bs-el-id`.

**AutoUI game**: Switch go-fish (or any game) to "Auto UI" via the dev chrome UI dropdown. The `dev-ui-select` postMessage switches GameShell's active renderer to `DevAutoUI` (the AutoUI). DevHost.vue line 250: `postToGame({ type: 'dev-ui-select', name: selectedUi.value })`.

**Iframe structure** `[VERIFIED: DevHost.vue:638-644]`:
```html
<iframe ref="iframeRef" class="dev-host__frame" :src="cfg.gameUrl" @load="onIframeLoad" />
```
- `iframeRef.value` — the `HTMLIFrameElement` in the outer page
- `iframeRef.value.contentDocument` — accessible (same-origin)
- `iframeRef.value.contentWindow` — accessible (same-origin); use this for CustomEvent listener

**Agent loop implementation** (from outer page console or agent script):
```javascript
// Step 1 — DISCOVER
const devtools = window.__BOARDSMITH_DEVTOOLS;
const meta = devtools.getActionMetadata();     // Record<string, ActionMetadata>
const boardState = devtools.getBoardInteractionState();
// boardState.validElements — number[] of currently valid element IDs

// Step 2 — SELECT
const iframe = document.querySelector('iframe');
const el = iframe.contentDocument.querySelector('[data-bs-el-id="42"]');

// Step 3 — DRIVE (click routes through useSelectable → triggerElementSelect → action pipeline)
el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

// Step 4 — CONFIRM
iframe.contentWindow.addEventListener('boardsmith:action-resolved', (e) => {
  console.log(e.detail.success, e.detail.action, e.detail.error);
}, { once: true });
```

**Click routing** `[VERIFIED: useSelectable.ts:47-51, PieceRenderer.vue:103-104,148,151]`:

The chain is: `@click="onActivate"` → `handleActivate()` → guard: `if (!isActionSelectable.value) return` → `boardInteraction.triggerElementSelect(identity())` → `state.onElementSelect(validElem.id)`.

This means a synthetic click only has effect if the target element is currently in `boardInteraction.state.validElements`. If the element is NOT in `validElements`, the click is silently ignored (no CustomEvent fires).

**Proving `success === false`**: A click on an element not in `validElements` silently no-ops — no CustomEvent fires. To get a `success: false` CustomEvent, trigger the execute() path with invalid args directly from the iframe's action controller. In the iframe console:
```javascript
// Inject into the iframe JS context — same frame as the action controller
// The actionController is not directly on window, but the agent can trigger
// an invalid action by calling execute() with a non-existent action name
// or by calling it when not your turn. For the browser proof, the simplest
// approach is to observe the natural failure when the game rejects an action.
```

A more reliable approach: trigger the action via go-fish's "Ask" button interaction, then cancel it via invalid input, OR have an AI opponent's turn and attempt an action — the controller returns `{ success: false, error: 'Not your turn' }`.

**Alternative for `success === false` proof**: Expose `execute()` call via the game's `actionController`. In the iframe context: `window.__vue_devtools` or by reading the game's `window.__boardsmith__` if one is added. However, since this is a browser proof (not production), the simplest path is: start an action in go-fish (e.g., start the "ask" action), then submit an invalid card selection — the server will reject it and the CustomEvent fires with `success: false`.

---

### Anti-Patterns to Avoid

- **Adding `data-bs-el-*` literals directly to renderer files**: Violates the single-source guard test (`anchorAttrs.test.ts:174`). Would break the test suite. The attribute is already emitted via `v-bind="selectableAttrs"`.
- **Using `__BOARDSMITH_DEV__` as a runtime guard**: Declared in `global.d.ts` but never set as a Vite define constant. Use `isDevBuild` (= `import.meta.env.DEV`) consistently.
- **Dispatching CustomEvent in `window.parent`**: The event must be dispatched on `window` inside the iframe (where the action controller runs), not on the outer page. The outer page then listens via `iframe.contentWindow.addEventListener(...)`.
- **Capturing action name after `currentAction.value = null`**: At line 1505 context, `currentAction.value` is cleared at line 1492 before line 1505. Must capture the name before line 1492.
- **Watching `boardInteraction.state.validElements` with `deep: false`**: The `validElements` array is replaced by reference when updated (`setValidElements` creates a new array). Shallow watch is sufficient for array replacement, but `deep: true` on the whole watcher is safest.
- **Missing `{ deep: true }` on the watcher over `boardInteraction.state`**: `boardInteraction.state` is a reactive plain object, not a ref. Changes to its inner fields require `deep: true` or watching individual fields.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Data-bs-el-* attribute emission | Inline `:data-bs-el-id` bindings in renderers | `v-bind="selectableAttrs"` (already present) | Single-source guard test enforces this |
| Perspective-aware state | Re-implement filtering | `state.value?.state` broadcast (already filtered by server) | Server broadcast is already the `PlayerStateView` for this seat |
| Board interaction state access | Query DOM or controller directly | `boardInteraction.state` object (created at GameShell.vue:667) | Single reactive object with all needed fields |
| Dev guard | `__BOARDSMITH_DEV__` runtime check | `isDevBuild = import.meta.env.DEV` (GameShell pattern) | `__BOARDSMITH_DEV__` is declared but never set as a Vite define |
| Cross-frame event listening | Polling or setInterval | `iframe.contentWindow.addEventListener('boardsmith:action-resolved', ...)` | Same-origin; CustomEvent can be listened directly |

---

## Runtime State Inventory

Not applicable — this is a greenfield instrumentation phase, not a rename/refactor.

---

## Common Pitfalls

### Pitfall 1: `data-bs-el-id` already present — wrong fix
**What goes wrong:** Implementer adds `:data-bs-el-id="element.id"` directly to renderer templates.
**Why it happens:** Following the design doc's "Files to modify" table literally without checking the current code.
**How to avoid:** Read `anchorAttrs.test.ts:174` — the negative guard test will fail. The attribute is already emitted by `v-bind="selectableAttrs"`. DEV-01 work is VERIFY + DOM-level test, not a code addition.
**Warning signs:** `npm test` failure on `anchorAttrs.test.ts` with "must not define data-bs-el-* directly".

### Pitfall 2: Wrong dev guard (`__BOARDSMITH_DEV__` vs `isDevBuild`)
**What goes wrong:** The sender in GameShell uses `typeof __BOARDSMITH_DEV__ !== 'undefined' && __BOARDSMITH_DEV__` — this is always falsy because no Vite `define` sets this constant.
**Why it happens:** Design doc mentions `__BOARDSMITH_DEV__` as the guard.
**How to avoid:** Use `isDevBuild` (= `import.meta.env.DEV`, set at GameShell.vue:174) consistently with all other dev-only guards in that file.
**Warning signs:** The postMessage bridge never fires in the dev host.

### Pitfall 3: Action name captured after currentAction.value clear
**What goes wrong:** The CustomEvent at the selection-step path carries `action: ''` or `action: null`.
**Why it happens:** `currentAction.value = null` runs at line 1492 before the dispatch is added.
**How to avoid:** Add `const completedActionName = currentAction.value` before line 1492's `currentAction.value = null`.
**Warning signs:** `e.detail.action === ''` or `null` in the CustomEvent received by the outer page.

### Pitfall 4: Click on non-selectable element → no CustomEvent fires (silent no-op)
**What goes wrong:** DEV-04 "illegal attempt" test uses a click on an element not in `validElements`, and no `success: false` CustomEvent fires.
**Why it happens:** `handleActivate()` returns early if `!isActionSelectable.value` (useSelectable.ts:48).
**How to avoid:** For the `success: false` proof case, use a direct `execute()` call with invalid args from the iframe context, not a click on a non-selectable element.
**Warning signs:** No CustomEvent at all (not even `success: false`) when clicking a grayed-out element.

### Pitfall 5: `boardInteraction.state` deep watch needed
**What goes wrong:** The DevHost snapshot doesn't update when board interaction changes (e.g., `validElements` updated).
**Why it happens:** `boardInteraction.state` is a reactive object; field mutations don't trigger a shallow watch.
**How to avoid:** Use `{ deep: true }` on the watcher in GameShell that triggers the postMessage, OR watch individual field refs explicitly. The cleanest: `watch([availableActions, actionMetadata, () => JSON.stringify(boardInteraction.state)], ...)`.

---

## Code Examples

### Sender watcher in GameShell.vue (DEV-02)
```typescript
// Source: GameShell.vue — add after boardInteraction is created (line ~669)
// Only runs in dev+platform mode; silent no-op in production builds.
if (isDevBuild && platformMode.value) {
  watch(
    [
      availableActions,
      actionMetadata,
      playerSeat,
      () => boardInteraction.state.currentAction,
      () => boardInteraction.state.currentPickIndex,
      () => boardInteraction.state.validElements.length,
      state,
    ],
    () => {
      if (!platformMode.value) return;
      window.parent.postMessage(
        {
          source: 'shufflewick-game',
          type: 'boardsmith:devtools-state-update',
          seat: playerSeat.value,
          state: state.value?.state ?? null,
          availableActions: availableActions.value,
          actionMetadata: actionMetadata.value,
          boardInteraction: {
            activeAction: boardInteraction.state.currentAction,
            currentSelectionStep: boardInteraction.state.currentPickIndex,
            validElements: boardInteraction.state.validElements
              .filter(v => !v.disabled)
              .map(v => v.id),
          },
        },
        '*',
      );
    },
    { deep: false },  // watching length-change is sufficient; avoids deep clone
  );
}
```

### DevHost receiver + global assignment (DEV-02)
```typescript
// Source: DevHost.vue — new reactive ref (add near top of <script setup>)
const devtoolsSnapshot = ref<Record<string, unknown> | null>(null);

// In onWindowMessage(), add before closing brace:
if (data.type === 'boardsmith:devtools-state-update') {
  devtoolsSnapshot.value = data;
  return;
}

// In onMounted(), after connect():
window.__BOARDSMITH_DEVTOOLS = {
  getState:                (_seat?: number) => (devtoolsSnapshot.value?.state as any) ?? null,
  getAvailableActions:     (_seat?: number) => (devtoolsSnapshot.value?.availableActions as string[]) ?? [],
  getActionMetadata:       (_seat?: number) => devtoolsSnapshot.value?.actionMetadata as any,
  getBoardInteractionState: () => (devtoolsSnapshot.value?.boardInteraction as any) ?? null,
};
```

### CustomEvent dispatch at execute() path (DEV-03)
```typescript
// Source: useActionController.ts — add after `const result = await sendAction(...)` in execute()
// Applies to BOTH the no-metadata path (line ~1005) and the metadata path (line ~1069)
if (isDevBuild) {
  window.dispatchEvent(
    new CustomEvent('boardsmith:action-resolved', {
      detail: {
        action: actionName,
        success: result.success,
        seat: playerSeat?.value ?? 0,
        ...(result.success ? {} : { error: result.error }),
      },
    }),
  );
}
// Note: also add in the catch block with success: false, error: err.message
```

### CustomEvent dispatch at selection-step path (DEV-03)
```typescript
// Source: useActionController.ts — modify the if (result.actionComplete) block at line ~1490
if (result.actionComplete) {
  const completedActionName = currentAction.value;  // ← MUST be before line 1492
  currentAction.value = null;
  clearArgs();
  clearAdvancedState();

  if (result.followUp) {
    queueFollowUp(result.followUp);
  } else {
    actionCompletedTick.value++;  // existing line 1505
    if (isDevBuild) {
      window.dispatchEvent(
        new CustomEvent('boardsmith:action-resolved', {
          detail: {
            action: completedActionName ?? '',
            success: true,
            seat: player,  // defined at line 1468: playerSeat?.value ?? 0
          },
        }),
      );
    }
  }
  return { valid: true };
}
```

### Browser proof harness (DEV-04)
```javascript
// Run from browser console on http://localhost:5173/ (outer dev-host page)
// Prerequisite: boardsmith dev running for go-fish

const iframe = document.querySelector('iframe');
const devtools = window.__BOARDSMITH_DEVTOOLS;

// Verify global is present
console.log('Actions:', devtools.getAvailableActions());
console.log('Valid element IDs:', devtools.getBoardInteractionState()?.validElements);

// Listen for action-resolved events
iframe.contentWindow.addEventListener('boardsmith:action-resolved', (e) => {
  console.log('[boardsmith:action-resolved]', e.detail);
});

// DISCOVER + SELECT + DRIVE (requires an element in validElements)
const validIds = devtools.getBoardInteractionState()?.validElements ?? [];
if (validIds.length > 0) {
  const el = iframe.contentDocument.querySelector(`[data-bs-el-id="${validIds[0]}"]`);
  console.log('Target element:', el);
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
```

---

## Validation Architecture

`workflow.nyquist_validation` is absent from `.planning/config.json` → treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/ui/composables/useActionController.test.ts src/ui/composables/anchorAttrs.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEV-01 | `data-bs-el-id` emitted in AutoUI renderer DOM output | unit (mount) | `npx vitest run src/ui/components/auto-ui/renderers/renderers.devtools-attrs.test.ts` | ❌ Wave 0 |
| DEV-01 | Single-source guard: no data-bs-el-* literals in renderer files | unit (static) | `npx vitest run src/ui/composables/anchorAttrs.test.ts` | ✅ already passes |
| DEV-02 | GameShell posts `boardsmith:devtools-state-update` to window.parent | unit (postMessage mock) | `npx vitest run src/ui/components/GameShell.devtools.test.ts` | ❌ Wave 0 |
| DEV-03 | `boardsmith:action-resolved` CustomEvent fires with correct detail on execute() success | unit | `npx vitest run src/ui/composables/useActionController.devtools.test.ts` | ❌ Wave 0 |
| DEV-03 | `boardsmith:action-resolved` fires with `success: false, error` on execute() failure | unit | `npx vitest run src/ui/composables/useActionController.devtools.test.ts` | ❌ Wave 0 |
| DEV-03 | `boardsmith:action-resolved` fires with correct detail on selection-step path completion | unit | `npx vitest run src/ui/composables/useActionController.devtools.test.ts` | ❌ Wave 0 |
| DEV-04 | DISCOVER→SELECT→DRIVE→CONFIRM loop in custom UI (go-fish) | browser-only | manual (Chrome extension) | N/A |
| DEV-04 | DISCOVER→SELECT→DRIVE→CONFIRM loop in AutoUI (go-fish dev-ui-switch) | browser-only | manual (Chrome extension) | N/A |
| DEV-04 | `success === false` CustomEvent in custom UI | browser-only | manual | N/A |
| DEV-04 | `success === false` CustomEvent in AutoUI | browser-only | manual | N/A |

### Unit Test Notes

**DEV-01 renderer DOM test** (new file: `renderers.devtools-attrs.test.ts`):
- Follow the pattern in `CardRenderer.a11y.test.ts` (mount with `provideBoardInteraction` wrapper)
- Assert `wrapper.element.getAttribute('data-bs-el-id') === String(element.id)` on the root element
- Assert `data-element-id` is also present (FLIP alias preservation)
- Include PieceRenderer, SpaceRenderer, DieRenderer, CardRenderer

**DEV-02 GameShell unit test** (`GameShell.devtools.test.ts`):
- Mock `window.parent.postMessage` (or detect via `postMessageSpy`)
- Mount GameShell in platform mode with `isDevBuild = true`
- Trigger `availableActions` reactive change; assert `postMessage` called with `type: 'boardsmith:devtools-state-update'`
- Note: GameShell.vue is complex to mount in test; a simpler approach is to test the watcher logic extracted into a helper function

**DEV-03 CustomEvent unit test** (`useActionController.devtools.test.ts`):
- Mock `window.dispatchEvent`; assert it's called with `new CustomEvent('boardsmith:action-resolved', ...)`
- Test the execute() success path: `detail.success === true`, `detail.action === 'actionName'`
- Test the execute() failure path: `detail.success === false`, `detail.error` present
- Test the selection-step completion path: mock `pickStep` to return `{ success: true, actionComplete: true }`
- Add env guard: these tests need `import.meta.env.DEV === true` (vitest sets it by default)
- Follow pattern in `useActionController.test.ts` and `useActionController.picks.test.ts`

### Browser Proof (DEV-04 — Required as Acceptance Gate)

DEV-04 **cannot be automated in jsdom** — it requires:
- A real `boardsmith dev` process running go-fish
- Cross-frame `iframe.contentDocument.querySelector` access (jsdom doesn't support real iframe loading)
- The game's full action pipeline to process a real click event

**Exact repro steps (custom UI — go-fish):**

1. `cd ~/BoardSmithGames/go-fish && npx boardsmith dev` (serves on :5173)
2. Open `http://localhost:5173/` in Chrome
3. Wait for the game to be seated (auto-seats as Seat 0)
4. Open DevTools console on the outer page (not inside iframe)
5. Run the browser proof harness from the Code Examples section above
6. Verify `window.__BOARDSMITH_DEVTOOLS` is present and returns non-empty `getAvailableActions()`
7. Verify `getBoardInteractionState().validElements` lists valid element IDs when it's your turn
8. Dispatch a click on a valid element; observe `boardsmith:action-resolved` with `success: true`
9. To get `success: false`: type `iframe.contentWindow.document.querySelector('[data-bs-action]')` to find an action button if present, OR trigger an execute() via the iframe: look for `window.__vue_devtools` if available, or add a temporary test hook
10. **Kill the dev server** (`Ctrl+C`) before marking work complete

**Exact repro steps (AutoUI):**

1. Same as above, but after step 3, switch the UI dropdown in the dev chrome to "Auto UI"
2. Verify `[data-bs-el-id]` selectors still work on the AutoUI-rendered elements
3. Repeat steps 7–9 above

### Sampling Rate
- **Per task commit:** `npx vitest run src/ui/composables/useActionController.devtools.test.ts src/ui/composables/anchorAttrs.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + DEV-04 browser proof confirmed before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/ui/components/auto-ui/renderers/renderers.devtools-attrs.test.ts` — DOM-level data-attr emission tests (DEV-01)
- [ ] `src/ui/composables/useActionController.devtools.test.ts` — CustomEvent dispatch tests for execute() + selection-step paths (DEV-03)
- [ ] `src/ui/components/GameShell.devtools.test.ts` — postMessage sender tests (DEV-02) — may be deferred to browser-only if GameShell mount complexity is high

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes (indirect) | `isDevBuild` guard ensures global only exists in dev mode |
| V5 Input Validation | no | postMessage payload is internal broadcast, not user input |
| V6 Cryptography | no | — |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Production leak of `__BOARDSMITH_DEVTOOLS` | Info Disclosure | `isDevBuild` guard; `import.meta.env.DEV` is false in production Vite builds; dead-code eliminated |
| Malicious postMessage injection | Tampering | DevHost's `onWindowMessage` filters by `data.source === 'shufflewick-game'`; new message type follows same filter |
| Agent triggering actions outside its turn | Tampering | Server-side validation rejects out-of-turn actions; `success: false` + error reflected in CustomEvent |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `import.meta.env.DEV` is always `true` when the game is served via `boardsmith dev` | DEV-02, DEV-03 | Low — `boardsmith dev` always uses Vite dev server, which always sets `DEV = true` |
| A2 | The iframe and outer page are same-origin (both served from port 5173) | DEV-04 | Low — both are served by the same Vite instance; `cfg.gameUrl` is a relative or same-host URL |
| A3 | `boardInteraction.state.validElements` is replaced by reference (not mutated in place) | DEV-02 watcher | Medium — if the array is mutated in place, watching `.length` won't catch element ID changes; use `deep: true` as fallback |

**If this table is empty:** No — there are 3 assumed claims above, all LOW-MEDIUM risk.

---

## Open Questions

All questions are RESOLVED — the API is locked.

1. **Should DEV-01 add inline attribute bindings to renderer files?**
   RESOLVED: NO. `data-bs-el-id` is already emitted via `v-bind="selectableAttrs"`. Adding inline bindings would break the single-source guard test. DEV-01 work = DOM-level mount test + verification.

2. **Which dev build guard to use — `__BOARDSMITH_DEV__` or `isDevBuild`?**
   RESOLVED: Use `isDevBuild` (= `import.meta.env.DEV`). `__BOARDSMITH_DEV__` is declared in `global.d.ts` but never set as a Vite define constant; it is always `undefined` at runtime.

3. **How many `actionCompletedTick` increment sites are there currently?**
   RESOLVED: ONE — line 1505 only. The execute() path uses `isExecuting` toggle, not `actionCompletedTick`. Phase 119 adds NEW CustomEvent dispatches at both the execute() path AND line 1505.

4. **How to prove `success === false` in DEV-04 browser proof?**
   RESOLVED: Click-based proof doesn't work for failure (silent no-op). Use a direct `execute()` call with invalid args from the iframe's JS context, OR trigger the game into a failure path (e.g., attempt an action when not your turn) to fire the `success: false` CustomEvent.

5. **Is `boardInteraction.state` accessible in GameShell for the postMessage sender?**
   RESOLVED: Yes. `boardInteraction` is created at GameShell.vue:667 (`const boardInteraction = createBoardInteraction()`) and is in scope for any watcher added in GameShell.vue's script setup.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `boardsmith dev` server | ✓ | — | — |
| Go Fish game (`~/BoardSmithGames/go-fish`) | DEV-04 browser proof | ✓ (checked in CLAUDE.md) | — | Use Hex game instead |
| Chrome extension (Claude Code) | DEV-04 browser proof | ✓ (CLAUDE.md: enabled) | — | Manual browser console |

**Missing dependencies with no fallback:** None identified.

---

## Sources

### Primary (HIGH confidence)
- Direct `src/` inspection — all file:line citations verified against live source
  - `src/ui/composables/useBoardInteraction.ts:408` — `anchorAttrs()` single-source declaration
  - `src/ui/composables/useSelectable.ts:53-58` — `attrs` computed including `anchorAttrs(identity())`
  - `src/ui/composables/anchorAttrs.test.ts:174` — single-source guard test (negative)
  - `src/ui/components/auto-ui/renderers/PieceRenderer.vue:103-104,145-148` — `useSelectable` + `v-bind="selectableAttrs"` + `:data-element-id`
  - `src/ui/components/auto-ui/renderers/SpaceRenderer.vue:90-96,164,177` — same pattern confirmed
  - `src/ui/components/auto-ui/renderers/DieRenderer.vue:67-73,106,117` — same pattern confirmed
  - `src/ui/components/auto-ui/renderers/CardRenderer.vue:181-182,351,354` — same pattern confirmed
  - `src/ui/composables/useActionController.ts:186,1505,1811` — `actionCompletedTick` refs
  - `src/ui/composables/useActionController.ts:968-1098` — `execute()` full function
  - `src/ui/composables/useActionController.ts:1462-1508` — `handleOnSelectFill()` + line 1492 clear
  - `src/cli/dev-host/DevHost.vue:209-253,348-358,638-644` — `onWindowMessage`, `onMounted`, iframe ref
  - `src/ui/components/GameShell.vue:174,201-208,233,317-320,348-379,448-546,666-694` — `isDevBuild`, sender pattern, reactive state sources
  - `src/ui/global.d.ts:1` — `__BOARDSMITH_DEV__` declared but never set
  - `src/cli/cli.ts:33` — default port 5173
  - `src/ui/composables/useFLIP.ts:138` — `DEFAULT_SELECTOR = '[data-element-id]'` (FLIP alias reason)
  - `src/ui/components/helpers/overlay-utils.ts:44-45` — `[data-bs-el-id]` query (tutorial overlay)

### Secondary (MEDIUM confidence)
- `.planning/v4.3-API-DESIGN.md` — locked design contract (DEV-01..04 specifications)
- `.planning/phases/119-dev-host-devtools-bridge/119-CONTEXT.md` — locked implementation decisions

---

## Metadata

**Confidence breakdown:**
- DEV-01 (data attributes): HIGH — confirmed via multiple render tests + direct code inspection
- DEV-02 (postMessage bridge): HIGH — all reactive sources and DevHost patterns confirmed in code
- DEV-03 (CustomEvent dispatch): HIGH — exact lines confirmed, variable capture pattern clear
- DEV-04 (browser proof): HIGH — infrastructure confirmed; actual proof depends on implementation landing first

**Research date:** 2026-06-30
**Valid until:** 2026-07-30 (stable codebase; UI composables rarely change)
