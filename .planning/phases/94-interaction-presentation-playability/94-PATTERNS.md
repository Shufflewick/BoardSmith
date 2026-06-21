# Phase 94: Interaction, Presentation & Playability Gate — Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 26 modified + 7 created = 33 total
**Analogs found:** 33 / 33

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/engine/action/types.ts` | type | transform | itself (current singular fields to replace) | exact |
| `src/engine/action/index.ts` | config | transform | itself (re-export lines 19-20) | exact |
| `src/engine/index.ts` | config | transform | itself (re-export lines 135-136) | exact |
| `src/session/pick-handler.ts` | service | request-response | itself (lines 228-240, 379-391 to change) | exact |
| `src/session/types.ts` | type | transform | itself (lines 230-252 to change) | exact |
| `src/types/protocol.ts` | type | transform | itself (lines 459-481 to change) | exact |
| `src/ui/composables/useActionControllerTypes.ts` | type | transform | itself (lines 24-45 to change) | exact |
| `src/ui/composables/useActionController.ts` | composable | request-response | itself (`currentPick`, `validElements`, `isReady` computed pattern) | exact |
| `src/ui/composables/useDragDropTargets.ts` | composable | event-driven | itself (lines 86-87, 105 to change) | exact |
| `src/ui/components/GameShell.vue` | component | request-response | itself (`GameShellProps` interface + footer block) | exact |
| `src/ui/components/auto-ui/ActionPanel.vue` | component | request-response | itself (9 singular-ref sites + `filteredChoices` computed) | exact |
| `src/ui/components/auto-ui/AutoRenderer.vue` | component | request-response | itself (provide chain pattern) | exact |
| `src/ui/components/auto-ui/AutoUI.vue` | component | request-response | itself (prop pass-through pattern) | exact |
| `src/ui/components/auto-ui/renderers/GridBoardRenderer.vue` | renderer | event-driven | itself (already has full click+highlight pattern) | exact |
| `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue` | renderer | event-driven | `GridBoardRenderer.vue` (cell click+highlight model) | exact |
| `src/ui/components/auto-ui/renderers/PieceRenderer.vue` | renderer | event-driven | itself (already has `isActionSelectable` + drag pattern) | exact |
| `src/ui/components/auto-ui/renderers/CardRenderer.vue` | renderer | event-driven | `PieceRenderer.vue` (click pattern; no drag needed) | role-match |
| `src/ui/components/auto-ui/renderers/HandRenderer.vue` | renderer | event-driven | `GridBoardRenderer.vue` (zone click model) | role-match |
| `src/ui/components/auto-ui/renderers/SpaceRenderer.vue` | renderer | event-driven | `GridBoardRenderer.vue` (drop-zone model) | role-match |
| `src/ui/components/auto-ui/renderers/DeckRenderer.vue` | renderer | event-driven | `PieceRenderer.vue` (selectable element click) | role-match |
| `src/ui/components/auto-ui/renderers/DieRenderer.vue` | renderer | event-driven | `PieceRenderer.vue` (selectable element click) | role-match |
| `src/ui/components/auto-ui/presentation.ts` (NEW) | utility | transform | `src/ui/components/auto-ui/renderer-registry.ts` (pure-module pattern: no Vue, no DOM) | role-match |
| `~/BoardSmithGames/checkers/src/rules/actions.ts` | model | request-response | itself (lines 139-154 boardRefs return to change) | exact |
| `~/BoardSmithGames/go-fish/src/rules/actions.ts` | model | request-response | itself (lines 38-73 boardRefs return to change) | exact |
| `~/BoardSmithGames/hex/src/ui/App.vue` | component | request-response | `~/BoardSmithGames/go-fish/src/ui/App.vue` (GameShell + AutoUI slot) | role-match |
| `~/BoardSmithGames/go-fish/src/ui/App.vue` | component | request-response | itself (current split-screen → AutoUI-only) | exact |
| `~/BoardSmithGames/checkers/src/ui/App.vue` | component | request-response | itself (current split-screen → AutoUI-only) | exact |
| `~/BoardSmithGames/hex/src/ui/presentation.ts` (NEW) | utility | transform | `src/ui/components/auto-ui/presentation.ts` (new, same module) | role-match |
| `~/BoardSmithGames/go-fish/src/ui/presentation.ts` (NEW) | utility | transform | `src/ui/components/auto-ui/presentation.ts` (new, same module) | role-match |
| `~/BoardSmithGames/checkers/src/ui/presentation.ts` (NEW) | utility | transform | `src/ui/components/auto-ui/presentation.ts` (new, same module) | role-match |
| `src/session/pick-handler.test.ts` (NEW) | test | request-response | `src/ui/composables/useActionController.test.ts` (Vitest + describe/it/expect) | role-match |
| `src/ui/components/auto-ui/ActionPanel.test.ts` (NEW) | test | request-response | `src/ui/composables/useActionController.test.ts` | role-match |
| `src/ui/components/auto-ui/presentation.test.ts` (NEW) | test | transform | `src/ui/composables/useActionController.test.ts` | role-match |

---

## Pattern Assignments

---

### D-01 Layer 1: `src/engine/action/types.ts` (type, transform)

**Analog:** itself — current state is the before-state

**Current state** (lines 58-70):
```typescript
export interface BoardElementRef {
  id?: number;
  name?: string;
  notation?: string;
}

export interface ChoiceBoardRefs {
  sourceRef?: BoardElementRef;
  targetRef?: BoardElementRef;
}
```

**Replace with** (new `RefWithRole`, generalized `ChoiceBoardRefs`):
```typescript
export interface BoardElementRef { id?: number; name?: string; notation?: string; } // unchanged
export interface RefWithRole { ref: BoardElementRef; role: 'source' | 'target' | 'highlight'; }
export interface ChoiceBoardRefs { refs: RefWithRole[]; }
```

**Re-export update pattern** — `src/engine/action/index.ts` lines 19-20 and `src/engine/index.ts` lines 135-136:
Add `RefWithRole` to the named re-export lists alongside `BoardElementRef` and `ChoiceBoardRefs`. Follow the existing `export { BoardElementRef, ChoiceBoardRefs }` syntax at those lines.

---

### D-01 Layer 2: `src/session/pick-handler.ts` (service, request-response)

**Analog:** itself — two call-sites to change

**Choice pick pattern** (lines 228-240), current:
```typescript
if (choiceSel.boardRefs) {
  try {
    const refs = choiceSel.boardRefs(rawValue, ctx);
    if (refs.sourceRef) choice.sourceRef = refs.sourceRef;
    if (refs.targetRef) choice.targetRef = refs.targetRef;
  } catch (e) {
    console.error('boardRefs() error (ignored):', e);
  }
}
```

Replace with:
```typescript
if (choiceSel.boardRefs) {
  try {
    const result = choiceSel.boardRefs(rawValue, ctx);
    choice.refs = result.refs;
  } catch (e) {
    console.error('boardRefs() error (ignored):', e);
  }
}
```

**Element pick pattern** (lines 379-391), current:
```typescript
if (elemSel.boardRef) {
  try {
    validElem.ref = elemSel.boardRef(element, ctx);
  } catch {
    // Ignore errors
  }
} else {
  // Default ref: use element ID and notation if available
  validElem.ref = { id: element.id };
  if (element.notation) {
    validElem.ref.notation = element.notation;
  }
}
```

Replace with:
```typescript
const rawRef = elemSel.boardRef
  ? (() => { try { return elemSel.boardRef!(element, ctx); } catch { return { id: element.id }; } })()
  : { id: element.id, ...(element.notation ? { notation: element.notation } : {}) };
validElem.refs = [{ ref: rawRef, role: 'highlight' }];
```

*(Keep the try/catch guard — the original has one; preserve the error-suppression pattern.)*

---

### D-01 Layer 3: `src/session/types.ts` (type, transform)

**Analog:** itself — lines 230-252

**Current state** (lines 230-252):
```typescript
export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  sourceRef?: ElementRef;
  targetRef?: ElementRef;
  disabled?: string;
}

export interface ValidElement {
  id: number;
  display?: string;
  ref?: ElementRef;
  disabled?: string;
}
```

**Replace** `sourceRef`/`targetRef` with `refs?: RefWithRole[]` on `ChoiceWithRefs`.
**Replace** `ref?: ElementRef` with `refs?: RefWithRole[]` on `ValidElement`.
Import `RefWithRole` from `../engine/action/types.js`.

---

### D-01 Layer 4: `src/types/protocol.ts` (type, transform)

**Analog:** itself — lines 459-481

**Current state** (lines 459-481):
```typescript
export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  /** Element reference for source highlighting (e.g., piece being moved) */
  sourceRef?: ElementRef;
  /** Element reference for target highlighting (e.g., destination square) */
  targetRef?: ElementRef;
  disabled?: string;
}

export interface ValidElement {
  id: number;
  display?: string;
  /** Element reference for board highlighting */
  ref?: ElementRef;
  disabled?: string;
}
```

**Replace** — same shape as Layer 3. Protocol wire type carries `RefWithRole` inline (do not import from engine — protocol.ts is a standalone wire-format module):
```typescript
export interface RefWithRole {
  ref: ElementRef;
  role: 'source' | 'target' | 'highlight';
}

export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  refs?: RefWithRole[];
  disabled?: string;
}

export interface ValidElement {
  id: number;
  display?: string;
  refs?: RefWithRole[];
  disabled?: string;
}
```

---

### D-01 Layer 5: `src/ui/composables/useActionControllerTypes.ts` (type, transform)

**Analog:** itself — lines 24-45

**Current state** (lines 24-45):
```typescript
export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  sourceRef?: ElementRef;
  targetRef?: ElementRef;
  disabled?: string;
}

export interface ValidElement {
  id: number;
  display?: string;
  ref?: ElementRef;
  element?: GameElement;
  disabled?: string;
}
```

**Replace** same as Layer 4. Add `RefWithRole` interface (inline; this module is dependency-free). Keep `element?: GameElement` on `ValidElement` — that field is UI-only enrichment, not protocol.

Also update `PickChoicesResult` at line ~144 which has `sourceRef?: unknown; targetRef?: unknown` — change to `refs?: RefWithRole[]`.

---

### D-02: `src/ui/composables/useActionController.ts` (composable, request-response)

**Analog:** itself — `currentPick`, `validElements`, `isReady` computed pattern (lines 599-662)

**Existing computed pattern** to copy from (lines 613-631):
```typescript
const currentPick = computed((): PickMetadata | null => {
  if (!currentActionMeta.value) return null;

  for (const sel of currentActionMeta.value.selections) {
    if (selectionNeedsInput(sel) && !sel.optional) {
      return enrichValidElements(sel);
    }
  }
  // ...
  return null;
});
```

**New computed to add** (immediately after `isReady` at line ~636, before the `validElements` computed):
```typescript
/**
 * True when every available choice for the current pick has at least one refs entry.
 * When true, GameShell omits the ActionPanel footer entirely (D-02).
 * MUST return false when currentPick === null (no action in progress = show panel).
 */
const allCurrentChoicesAnchored = computed((): boolean => {
  const pick = currentPick.value;
  if (!pick) return false;                           // no action → show panel (Pitfall 4 guard)
  if (pick.type === 'element' || pick.type === 'elements') return true;  // always anchored
  if (pick.type !== 'choice') return false;          // number/text → panel only
  const choices = getCurrentChoices() as ChoiceWithRefs[];
  return choices.length > 0 && choices.every(c => (c.refs ?? []).length > 0);
});
```

**Return object update** — add to the returned object at line ~1596 (alongside `currentPick`, `validElements`, etc.):
```typescript
allCurrentChoicesAnchored,
```

**`UseActionControllerReturn` type update** in `useActionControllerTypes.ts` — add after `pendingOnServer`:
```typescript
/** True when every choice for the current pick is board-anchored. Drives GameShell footer absence. */
allCurrentChoicesAnchored: ComputedRef<boolean>;
```

---

### D-02: `src/ui/components/GameShell.vue` (component, request-response)

**Analog:** itself — `GameShellProps` interface (lines 75-98) + footer block (lines 1279-1301)

**Existing props pattern** (lines 75-98):
```typescript
interface GameShellProps {
  gameType: string;
  displayName?: string;
  apiUrl?: string;
  playerCount?: number;
  debugMode?: boolean;
  showHistory?: boolean;
  defaultAIPlayers?: number[];
}

const props = withDefaults(defineProps<GameShellProps>(), {
  apiUrl: ...,
  playerCount: 2,
  debugMode: true,
  showHistory: true,
});
```

**Add prop** to `GameShellProps` (after `defaultAIPlayers`):
```typescript
/** Suppress the footer ActionPanel regardless of anchor state. Default: false. */
suppressActionPanel?: boolean;
/** Per-UI presentation overlay — keyed by element class/name/attribute → visuals. */
presentation?: PresentationOverlay;
```

**Add to `withDefaults`**:
```typescript
suppressActionPanel: false,
```

**Existing footer block** (lines 1279-1301):
```vue
<!-- Bottom Action Bar -->
<footer class="game-shell__action-bar">
  <ActionPanel
    :available-actions="isViewingHistory ? [] : availableActions"
    :action-metadata="isViewingHistory ? {} : actionMetadata"
    :players="players"
    :player-seat="playerSeat"
    :is-my-turn="isMyTurn && !isViewingHistory"
    :can-undo="canUndo && !isViewingHistory"
    :auto-end-turn="autoEndTurn"
    :show-undo="showUndo"
    :messages="gameMessages"
    :current-player-name="currentPlayerName"
    :current-player-color="currentPlayerColor"
    :awaiting-players="awaitingPlayerNames"
    @undo="handleUndo"
  />
  <!-- Time travel banner -->
  <div v-if="isViewingHistory" class="time-travel-banner">
    ...
  </div>
</footer>
```

**Replace** unconditional `<footer>` with conditional (add `v-if` at `<footer>` level — NOT on `<ActionPanel>`, per D-02 "absent not hidden"):
```vue
<!-- Bottom Action Bar — absent when all choices are board-anchored (D-02) -->
<footer
  v-if="!props.suppressActionPanel && !actionController.allCurrentChoicesAnchored.value"
  class="game-shell__action-bar"
>
  <slot name="action-panel">
    <ActionPanel ... />
  </slot>
  <!-- Time travel banner -->
  <div v-if="isViewingHistory" class="time-travel-banner">...</div>
</footer>
```

Also add `provide('presentation', toRef(props, 'presentation'))` near the other `provide()` calls in GameShell's setup block.

---

### D-01/D-03: `src/ui/composables/useDragDropTargets.ts` (composable, event-driven)

**Analog:** itself — lines 80-117

**Current element-pick pattern** (lines 81-95):
```typescript
if (el.id === undefined || !el.ref) continue;
targets.push({ id: el.id, ref: el.ref });
```

Replace `el.ref` with the highlight-role ref from the `refs` array:
```typescript
const highlightRef = (el.refs ?? []).find(r => r.role === 'highlight')?.ref;
if (el.id === undefined || !highlightRef) continue;
targets.push({ id: el.id, ref: highlightRef });
```

**Current choice-pick pattern** (lines 103-109):
```typescript
const ref = choice.targetRef;
if (!ref || ref.id === undefined) continue;
targets.push({ id: ref.id, ref });
valueByTargetId.set(ref.id, choice.value);
```

Replace `choice.targetRef` with role-filtered lookup:
```typescript
const ref = (choice.refs ?? []).find(r => r.role === 'target')?.ref;
if (!ref || ref.id === undefined) continue;
targets.push({ id: ref.id, ref });
valueByTargetId.set(ref.id, choice.value);
```

---

### D-01/D-03: `src/ui/components/auto-ui/ActionPanel.vue` (component, request-response)

**Analog:** itself — 9 singular-ref sites + `filteredChoices` computed

**Core ref-reading pattern** to replace across all 9 sites:

Old shape (e.g. lines 355-360):
```typescript
boardInteraction.setHoveredChoice({
  value: choice.value,
  display: choice.display,
  sourceRefs: choice.sourceRef ? [choice.sourceRef] : [],
  targetRefs: choice.targetRef ? [choice.targetRef] : [],
});
```

New shape (read from `refs` array by role):
```typescript
boardInteraction.setHoveredChoice({
  value: choice.value,
  display: choice.display,
  sourceRefs: (choice.refs ?? []).filter(r => r.role === 'source').map(r => r.ref),
  targetRefs: (choice.refs ?? []).filter(r => r.role === 'target' || r.role === 'highlight').map(r => r.ref),
});
```

**Lines 589-599 pattern** (choice-with-refs detection):

Old: `choices.filter((c: ChoiceWithRefs) => c.sourceRef || c.targetRef)`
New: `choices.filter((c: ChoiceWithRefs) => (c.refs ?? []).length > 0)`

Old: `const ref = choice.targetRef || choice.sourceRef;`
New: `const ref = (choice.refs ?? []).find(r => r.role === 'target')?.ref ?? (choice.refs ?? [])[0]?.ref;`

**Lines 856-873 multi-select highlight pattern**:

Old:
```typescript
if (choice.sourceRef) sourceRefs.push(choice.sourceRef);
if (choice.targetRef) targetRefs.push(choice.targetRef);
```

New:
```typescript
for (const r of choice.refs ?? []) {
  if (r.role === 'source') sourceRefs.push(r.ref);
  else targetRefs.push(r.ref);  // 'target' and 'highlight' both highlight as target-side
}
```

**Lines 989-990 pattern**:

Old: `if (choice && (choice.sourceRef || choice.targetRef))`
New: `if (choice?.refs?.length)`

**Lines 1048-1052 hover handler**:

Old:
```typescript
function handleChoiceHover(choice: ChoiceWithRefs) {
  boardInteraction?.setHoveredChoice({
    value: choice.value,
    display: choice.display,
    sourceRefs: choice.sourceRef ? [choice.sourceRef] : [],
    targetRefs: choice.targetRef ? [choice.targetRef] : [],
  });
}
```

New: apply the role-filter pattern from above.

**D-03 new filter** — add to `filteredChoices` computed (lines 224-251) AFTER the existing deduplication block (line ~248):
```typescript
// D-03: Anchored choices are actioned on the board — exclude from panel.
// A choice is anchored if it has at least one refs entry.
// ONLY for 'choice' picks — element picks are handled separately and never show in the panel.
if (currentPick.value?.type === 'choice') {
  const hasAnyAnchored = choices.some(c => (c.refs ?? []).length > 0);
  if (hasAnyAnchored) {
    choices = choices.filter(c => !(c.refs ?? []).length);
  }
}
```

*(When ALL choices are anchored, `choices` becomes empty here. That's fine: `allCurrentChoicesAnchored` drives the footer to be absent (D-02), so this `filteredChoices` computed is never rendered. The empty-state guard "Tap a highlighted element to continue." covers the defensive case.)*

---

### D-03 Interaction: `src/ui/components/auto-ui/renderers/GridBoardRenderer.vue` (renderer, event-driven)

**Analog:** itself — already has the complete board-centric click+highlight pattern

**Existing interaction pattern** (lines 83-126) — use verbatim as the template for all other renderers:

```typescript
// Board interaction for cell states
const boardInteraction = tryUseBoardInteraction();

function isCellHighlighted(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted({ id: cell.id, name: cell.name });
}

function isCellSelected(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected({ id: cell.id, name: cell.name });
}

function isCellActionSelectable(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  if (isCellSelected(cell)) return false;
  return boardInteraction.isSelectableElement({ id: cell.id, name: cell.name });
}

function isCellDropTarget(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isDropTarget({ id: cell.id, name: cell.name });
}

function handleCellClick(cell: GameElement) {
  if (!boardInteraction) return;
  if (boardInteraction.isSelectableElement({ id: cell.id, name: cell.name })) {
    boardInteraction.triggerElementSelect({ id: cell.id, name: cell.name });
  } else if (cell.name) {
    boardInteraction.selectElement({ id: cell.id, name: cell.name });
  }
}
```

**CSS class binding pattern** (in `<template>`):
```vue
:class="{
  'action-selectable': isCellActionSelectable(cell),
  'is-board-highlighted': isCellHighlighted(cell),
  'is-board-selected': isCellSelected(cell),
  'is-drop-target': isCellDropTarget(cell),
}"
@click="handleCellClick(cell)"
```

**HexBoardRenderer** (SVG context): same `tryUseBoardInteraction()` import and functions, but applied per hex polygon. Already has `boardInteraction = tryUseBoardInteraction()` at line 37. Add `isCellHighlighted/Selected/ActionSelectable/handleCellClick` following the exact GridBoardRenderer pattern; bind to hex `<polygon>` elements.

**Notation exposure issue (Pitfall 6):** When calling the interaction methods, pass `{ id: cell.id, name: cell.name }`. If `matchesRef` needs to match by notation and notation is inside `cell.attributes`, also pass `notation: cell.attributes?.notation as string | undefined`. Use a local helper:
```typescript
function cellIdentity(cell: GameElement) {
  return {
    id: cell.id,
    name: cell.name,
    notation: cell.attributes?.notation as string | undefined,
  };
}
```
Pass `cellIdentity(cell)` to all interaction method calls.

---

### D-03 Interaction: `src/ui/components/auto-ui/renderers/PieceRenderer.vue` (renderer, event-driven)

**Analog:** itself — already has `isActionSelectable` + drag pattern (lines 44-74)

**Existing pattern** to carry forward unchanged (lines 44-68):
```typescript
const boardInteraction = tryUseBoardInteraction();

const isActionSelectable = computed(() => {
  if (!boardInteraction) return false;
  if (boardInteraction.isSelected({ id: props.element.id, name: props.element.name })) return false;
  return boardInteraction.isSelectableElement({ id: props.element.id, name: props.element.name });
});

const isDragged = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDraggedElement({ id: props.element.id, name: props.element.name });
});

function handleDragStart(event: DragEvent) {
  if (!boardInteraction || !isActionSelectable.value) {
    event.preventDefault();
    return;
  }
  // ...
  boardInteraction.startDrag({ id: props.element.id, name: props.element.name });
}
```

**Add click handler** (missing from current PieceRenderer — add it):
```typescript
function handleClick() {
  if (!boardInteraction || !isActionSelectable.value) return;
  boardInteraction.triggerElementSelect({ id: props.element.id, name: props.element.name });
}
```

**Add highlight computed** (missing — add):
```typescript
const isHighlighted = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted({ id: props.element.id, name: props.element.name });
});
```

Bind in template: `@click="handleClick"` + `:class="{ 'is-board-highlighted': isHighlighted }"`.

---

### D-03 Interaction: CardRenderer, HandRenderer, SpaceRenderer, DeckRenderer, DieRenderer

**Analog:** `PieceRenderer.vue` (click-selectable) for CardRenderer, DeckRenderer, DieRenderer.
**Analog:** `GridBoardRenderer.vue` (zone click) for HandRenderer, SpaceRenderer.

**Pattern to copy** from `PieceRenderer.vue` for click-selectable renderers (CardRenderer, DeckRenderer, DieRenderer):
- Import: `import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';`
- `const boardInteraction = tryUseBoardInteraction();`
- `isActionSelectable` computed using `boardInteraction.isSelectableElement({ id, name })`
- `isHighlighted` computed using `boardInteraction.isHighlighted({ id, name })`
- `handleClick()` function: guard on `isActionSelectable`, call `boardInteraction.triggerElementSelect({ id, name })`
- Template: `@click="handleClick"` + class bindings

**Pattern to copy** from `GridBoardRenderer.vue` for zone renderers (HandRenderer, SpaceRenderer):
- Same imports
- `isHighlighted`, `isSelected`, `isActionSelectable` per element identity
- Drop-target support via `isCellDropTarget` + `handleDragOver` + `handleDrop` using `boardInteraction.triggerDrop`

---

### D-04: `src/ui/components/auto-ui/presentation.ts` (NEW — utility, transform)

**Analog:** `src/ui/components/auto-ui/renderer-registry.ts` — pure TypeScript module, no Vue, no DOM, no engine imports.

**Registry module pattern** (renderer-registry.ts lines 1-20):
```typescript
/**
 * renderer-registry — pure module: no Vue reactivity, no DOM access.
 */
import type { Component } from 'vue';

interface GameElement { ... }  // local interface, do NOT import from engine

export interface RendererEntry { test: ...; component: ...; }

const registry: RendererEntry[] = [];

export function registerRenderer(entry: RendererEntry): void { ... }
export function resolveRenderer(element: GameElement): Component | null { ... }
export function resetRegistry(): void { ... }  // test-only
```

**New `presentation.ts`** follows the same pure-module discipline:
```typescript
// src/ui/components/auto-ui/presentation.ts (new)
import type { Component } from 'vue';

export interface PresentationEntry {
  image?: string;
  label?: string;
  stats?: Record<string, unknown>;
  render?: Component;
}

export interface PresentationOverlay {
  byClass?: Record<string, PresentationEntry>;
  byName?: Record<string, PresentationEntry>;
  byAttribute?: Record<string, Record<string, PresentationEntry>>;
}

/**
 * Resolve the presentation entry for a given element.
 * Precedence: byName > byClass > byAttribute (first match wins, no field merging).
 * SECURITY: when element.__hidden is true, strips image and stats (PRESENT-02).
 */
export function resolvePresentation(
  element: { name?: string; className: string; attributes?: Record<string, unknown>; __hidden?: boolean },
  overlay: PresentationOverlay | undefined
): PresentationEntry | null {
  if (!overlay) return null;
  let entry: PresentationEntry | null = null;
  if (element.name && overlay.byName?.[element.name]) {
    entry = overlay.byName[element.name];
  } else if (overlay.byClass?.[element.className]) {
    entry = overlay.byClass[element.className];
  } else if (overlay.byAttribute) {
    for (const [attrKey, valueMap] of Object.entries(overlay.byAttribute)) {
      const attrVal = String(element.attributes?.[attrKey] ?? '');
      if (valueMap[attrVal]) { entry = valueMap[attrVal]; break; }
    }
  }
  if (!entry) return null;
  // PRESENT-02: guard — hidden elements must not receive identity-bearing overlay fields
  if (element.__hidden) {
    return { label: entry.label, render: entry.render };
  }
  return entry;
}
```

---

### D-04: `src/ui/components/auto-ui/AutoRenderer.vue` (component, request-response)

**Analog:** itself — existing provide chain (lines 68-77)

**Existing provide pattern** (lines 68-77):
```typescript
provide(DIE_ANIMATION_CONTEXT_KEY, dieAnimationContext);
// ...
provide('playerSeat', props.playerSeat);
provide('selectableElements', ref(new Set<number>()));
provide('selectedElements', ref(new Set<number>()));
```

**Add prop** to `defineProps<{...}>()` block (lines 57-62):
```typescript
/** Per-UI presentation overlay for visual metadata */
presentation?: PresentationOverlay;
```

**Add provide** after existing provides:
```typescript
provide('presentation', computed(() => props.presentation));
```

Import `PresentationOverlay` from `'./presentation.js'`.

---

### D-04: `src/ui/components/auto-ui/AutoUI.vue` (component, request-response)

**Analog:** itself — current prop-to-AutoRenderer pass-through (lines 21-46)

**Existing props** (lines 21-28):
```typescript
defineProps<{
  gameView: GameElement | null | undefined;
  flowState?: FlowState;
  playerSeat: number;
}>();
```

**Add prop**:
```typescript
presentation?: PresentationOverlay;
```

**Existing AutoRenderer usage** (line 42-46):
```vue
<AutoRenderer
  v-else
  :game-view="gameView"
  :player-seat="playerSeat"
/>
```

**Add pass-through**:
```vue
<AutoRenderer
  v-else
  :game-view="gameView"
  :player-seat="playerSeat"
  :presentation="presentation"
/>
```

---

### D-04: Per-element renderers — overlay injection pattern

**Analog:** AutoRenderer `provide('defaultBackImage', defaultBackImage)` consumed by renderers via `inject`.

**Inject pattern** (add to each renderer that displays element visuals):
```typescript
import { inject, computed } from 'vue';
import { resolvePresentation } from '../presentation.js';
import type { PresentationOverlay } from '../presentation.js';

const overlay = inject<import('vue').ComputedRef<PresentationOverlay | undefined>>('presentation');
const presentationEntry = computed(() =>
  resolvePresentation(props.element, overlay?.value)
);
```

**Usage in template** (replace engine defaults with overlay-first):
```vue
<!-- Image: overlay wins; fall back to engine $image -->
<img
  v-if="presentationEntry?.image || element.attributes?.$image"
  :src="presentationEntry?.image ?? (element.attributes?.$image as string)"
/>
<!-- Label: overlay wins; fall back to element.name ?? element.className -->
{{ presentationEntry?.label ?? element.name ?? element.className }}
```

---

### Playability Gate: Game `App.vue` files (component, request-response)

**Analog:** `~/BoardSmithGames/hex/src/ui/App.vue` — current split-screen split shows the pattern to collapse

**Current Hex split-screen pattern** (lines 29-60):
```vue
<GameShell game-type="hex" display-name="Hex" :player-count="2">
  <template #game-board="{ state, gameView, players, playerSeat, ... }">
    <div class="board-comparison">
      <div class="board-section">
        <h2>Custom UI</h2>
        <HexBoard :game-view="gameView" ... />
      </div>
      <div class="board-section">
        <h2>Auto-Generated UI</h2>
        <AutoUI :game-view="gameView || null" :player-seat="playerSeat" ... />
      </div>
    </div>
  </template>
</GameShell>
```

**Replace with** auto-UI-only + presentation prop for each game:
```vue
<GameShell
  game-type="hex"
  display-name="Hex"
  :player-count="2"
  :presentation="hexPresentationOverlay"
>
  <template #game-board="{ state, gameView, playerSeat }">
    <AutoUI
      :game-view="gameView || null"
      :player-seat="playerSeat"
      :flow-state="state?.flowState as any"
    />
  </template>
</GameShell>
```

Import `hexPresentationOverlay` from `'./presentation.js'`.

*(The `actionController` slot prop can be dropped from destructuring — AutoUI gets it via inject. The `players`, `isMyTurn`, `availableActions` props that fed HexBoard are no longer needed.)*

---

### Playability Gate: Game `src/rules/actions.ts` — D-01 boardRefs migration

**Analog:** `~/BoardSmithGames/checkers/src/rules/actions.ts` lines 139-154

**Current Checkers pattern** (lines 139-154):
```typescript
boardRefs: (choice) => {
  return {
    sourceRef: { notation: choice.fromNotation },
    targetRef: { notation: choice.toNotation },
  };
},
```

**Replace with**:
```typescript
boardRefs: (choice) => ({
  refs: [
    { ref: { notation: choice.fromNotation }, role: 'source' as const },
    { ref: { notation: choice.toNotation }, role: 'target' as const },
  ],
}),
```

**Current Go Fish pattern** (lines 38-46):
```typescript
boardRefs: (choice, ctx) => ({
  targetRef: { id: hand.id },
}),
```

**Replace with**:
```typescript
boardRefs: (choice, ctx) => ({
  refs: [{ ref: { id: hand.id }, role: 'target' as const }],
}),
```

**Hex boardRef** (line 22-27): No change needed — `boardRef` on element selections returns a `BoardElementRef`; the pick-handler wraps it internally as `refs: [{ ref, role: 'highlight' }]`. Hex game author code is unchanged.

---

### New Presentation Overlay Files (`~/BoardSmithGames/{game}/src/ui/presentation.ts`)

**Analog:** `src/ui/components/auto-ui/presentation.ts` (new, same module)

**Pattern:** plain TypeScript export, import type from `boardsmith/ui`:
```typescript
// ~/BoardSmithGames/checkers/src/ui/presentation.ts
import type { PresentationOverlay } from 'boardsmith/ui';

export const checkersPresentationOverlay: PresentationOverlay = {
  byClass: {
    CheckerPiece: { label: '' },  // suppress name; player color distinguishes pieces
    Square: { label: '' },         // suppress name; notation shown as board label
  },
};
```

**Hex overlay:**
```typescript
export const hexPresentationOverlay: PresentationOverlay = {
  byClass: {
    Cell: { label: '' },  // suppress cell name; coordinate notation already shown
  },
};
```

**Go Fish overlay:**
```typescript
export const goFishPresentationOverlay: PresentationOverlay = {
  byClass: {
    PlayerHand: { label: 'Hand' },  // show "Hand" for hand zones
  },
};
```

---

### New Test Files (test, request-response / transform)

**Analog:** `src/ui/composables/useActionController.test.ts` (lines 1-56)

**Test file structure pattern**:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';

describe('subject', () => {
  let dep: ...;
  beforeEach(() => {
    dep = ...;
  });

  describe('feature name', () => {
    it('should ...', async () => {
      ...
      expect(...).toBe(...);
    });
  });
});
```

**`src/session/pick-handler.test.ts`** — new file. Test that:
- Choice pick with `boardRefs` callback produces `choice.refs` array with correct `{ ref, role }` entries.
- Element pick with `boardRef` callback produces `validElem.refs = [{ ref, role: 'highlight' }]`.
- Element pick without `boardRef` produces default `refs = [{ ref: { id, notation? }, role: 'highlight' }]`.

**`src/ui/components/auto-ui/ActionPanel.test.ts`** — new file. Test that:
- `filteredChoices` excludes choices with `refs.length > 0` when at least one choice is anchored (D-03).
- `filteredChoices` includes all choices when no choice has refs (panel-only mode).
- `filteredChoices` includes all choices when choice pick type is element (D-03 filter only for 'choice').

**`src/ui/components/auto-ui/presentation.test.ts`** — new file. Test that:
- `resolvePresentation` returns `byName` entry when `element.name` matches.
- `resolvePresentation` returns `byClass` entry when class matches (name absent).
- `resolvePresentation` returns `byAttribute` entry when attribute matches.
- `resolvePresentation` strips `image` and `stats` when `element.__hidden === true` (PRESENT-02).
- `resolvePresentation` returns `null` when no match.
- `resolvePresentation` returns `null` when `overlay === undefined`.

**`src/ui/composables/useActionController.test.ts`** — add 3 cases to existing suite:
- `allCurrentChoicesAnchored` is `false` when `currentPick === null`.
- `allCurrentChoicesAnchored` is `true` for element pick type.
- `allCurrentChoicesAnchored` is `false` for choice pick where no choice has refs.

**`src/ui/composables/useDragDropTargets.test.ts`** — update existing drag tests:
- Replace `{ targetRef: {...} }` choice shapes with `{ refs: [{ ref: {...}, role: 'target' }] }`.
- Replace `{ ref: {...} }` validElement shapes with `{ refs: [{ ref: {...}, role: 'highlight' }] }`.

---

## Shared Patterns

### Board Interaction Access
**Source:** `src/ui/components/auto-ui/renderers/GridBoardRenderer.vue` line 34; `PieceRenderer.vue` line 38
**Apply to:** All 8 renderer files that need interaction wiring
```typescript
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
const boardInteraction = tryUseBoardInteraction();
```
`tryUseBoardInteraction()` (not `useBoardInteraction()`) — renderers can be mounted outside GameShell context in tests; the `try` variant returns `undefined` instead of throwing.

### Element Identity Object
**Source:** `GridBoardRenderer.vue` lines 86-125 (`{ id: cell.id, name: cell.name }`)
**Apply to:** All renderer click/highlight calls; extend with `notation` from attributes when available
```typescript
function elementIdentity(el: GameElement) {
  return {
    id: el.id,
    name: el.name,
    notation: el.attributes?.notation as string | undefined,
  };
}
```

### Refs Role Filter Helper
**Source:** D-01 migration — used in ActionPanel (9 sites) and useDragDropTargets (2 sites)
**Apply to:** Every call-site that currently reads `sourceRef`/`targetRef`
```typescript
// Canonical role-filter helper (can be inlined at each call site):
const refsByRole = (refs: RefWithRole[] | undefined, role: string) =>
  (refs ?? []).filter(r => r.role === role).map(r => r.ref);
```

### Pure-module TypeScript pattern
**Source:** `src/ui/components/auto-ui/renderer-registry.ts` (entire file)
**Apply to:** `src/ui/components/auto-ui/presentation.ts` (new)
Rules: no Vue imports other than `type Component`, no `import from 'vue'` (reactivity), no DOM access, local `GameElement` interface (never imported from engine), exported functions are pure.

### Provide/inject reactivity pattern
**Source:** `AutoRenderer.vue` lines 68-77 (existing `provide()` calls)
**Apply to:** `GameShell.vue` (provide `presentation`), `AutoRenderer.vue` (provide `presentation` as computed)
```typescript
// Reactive provide: wraps in computed so injectors re-render when prop changes
provide('presentation', computed(() => props.presentation));

// Consumer inject pattern (in per-element renderers):
const overlay = inject<ComputedRef<PresentationOverlay | undefined>>('presentation');
```

### Prop declaration pattern (Vue `<script setup>`)
**Source:** `GameShell.vue` `GameShellProps` interface (lines 75-98)
**Apply to:** Adding `suppressActionPanel` and `presentation` props to GameShell; `presentation` to AutoUI and AutoRenderer
All boolean props with defaults use `withDefaults(defineProps<...>(), { ... })`. Optional object props (PresentationOverlay) are declared with `?:` and no default.

---

## No Analog Found

No files in this phase lack a codebase analog. All 33 files have either an exact self-analog (modifications to existing files) or a role-match from existing files.

---

## Metadata

**Analog search scope:** `src/engine/`, `src/session/`, `src/types/`, `src/ui/composables/`, `src/ui/components/auto-ui/`, `~/BoardSmithGames/`
**Files scanned:** 22 source files read in full or by targeted range
**Pattern extraction date:** 2026-06-21

### Key pitfalls captured (from RESEARCH.md — reference in plan actions)
- **Pitfall 2 (`v-show` vs `v-if`):** Footer must use `v-if` at `<footer>` level — not `v-show`, not on `<ActionPanel>` inside the footer.
- **Pitfall 4 (`allCurrentChoicesAnchored` null guard):** Return `false` when `currentPick === null` — do not default to `true`.
- **Pitfall 6 (notation in attributes):** Pass `notation: el.attributes?.notation` when calling interaction methods — `notation` is NOT a top-level field on GameElement from renderer context.
- **Pitfall 3 (overlay hidden guard):** `resolvePresentation` strips `image` and `stats` when `element.__hidden === true`; only `label` and `render` are safe for hidden elements.
