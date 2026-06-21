# Phase 92: Piece & Grid Rendering Fixes - Pattern Map

**Mapped:** 2026-06-20
**Files analyzed:** 4 (2 new, 2 modified)
**Analogs found:** 4 / 4

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/components/auto-ui/auto-ui-helpers.ts` | utility (pure functions) | transform | `src/ui/composables/useGameViewHelpers.ts` | role-match (same: element attrs → derived value, no Vue reactivity, no DOM) |
| `src/ui/components/auto-ui/auto-ui-helpers.test.ts` | test | — | `src/ui/composables/useGameViewEnrichment.test.ts` | exact (same: node env, vitest, inline object factories, no Vue reactivity needed) |
| `src/ui/components/auto-ui/AutoElement.vue` (piece template, lines 1277–1289) | component fragment | request-response | existing card template in `AutoElement.vue` (lines 927–976) | exact (same file; card branch is the direct precedent for piece image/sprite/fallback dispatch) |
| `src/ui/components/auto-ui/AutoElement.vue` (board computed + error panel, lines 607–657, 1131–1157) | component fragment | request-response | existing `watchEffect` at line 706 (side-effect from computed); existing `boardSize` computed (lines 607–657) itself | exact (same file; watchEffect-for-side-effect and discriminated template branch patterns already present) |

---

## Pattern Assignments

### `src/ui/components/auto-ui/auto-ui-helpers.ts` (utility, transform)

**Analog:** `src/ui/composables/useGameViewHelpers.ts`

**Imports pattern** (`useGameViewHelpers.ts` lines 17–18):
```typescript
import type { GameElement, ElementMatchOptions, BaseElementAttributes } from '../types.js';
```
New file uses the local `GameElement` interface already defined in `AutoElement.vue` (lines 23–32). Since helpers live in the same `auto-ui/` directory they can import from `AutoElement.vue`'s sibling or re-declare the minimal interface. The research recommends co-locating the type inline in the helpers file (no external import needed — the interface is small and already duplicated across the SFC family).

**File structure pattern** (`useGameViewHelpers.ts` lines 1–30):
```typescript
/**
 * auto-ui-helpers - Internal rendering helpers for AutoElement / AutoGameBoard
 *
 * These are pure functions: no Vue reactivity, no DOM access.
 * Intended for use by the current renderer (AutoElement.vue) and Phase 93 renderer.
 */

// Minimal GameElement interface (mirrors AutoElement.vue local definition)
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
}

// --- resolvePieceVisual ---
export type PieceVisual =
  | { kind: 'image'; src: string }
  | { kind: 'sprite'; sprite: string; x: number; y: number; width: number; height: number }
  | { kind: 'token'; color: string; label: string };

export function resolvePieceVisual(element: GameElement): PieceVisual { ... }

// --- resolveGridSize ---
export type GridResult =
  | { ok: true; rows: number; cols: number }
  | { ok: false; error: string };

export function resolveGridSize(element: GameElement): GridResult { ... }
```

**Core pure-function pattern** (`useGameViewHelpers.ts` lines 32–50 — `findElementById`):
```typescript
// Pattern: typed attribute access + early return + no side effects
function getAttrs(element: GameElement): BaseElementAttributes & Record<string, unknown> {
  return (element.attributes ?? {}) as BaseElementAttributes & Record<string, unknown>;
}

export function findElementById(
  gameView: GameElement | null | undefined,
  id: number
): GameElement | undefined {
  if (!gameView) return undefined;
  if (gameView.id === id) return gameView;
  if (gameView.children) {
    for (const child of gameView.children) {
      const found = findElementById(child, id);
      if (found) return found;
    }
  }
  return undefined;
}
```
Apply the same `attrs ?? {}` defensive pattern and early-return style in both `resolvePieceVisual` and `resolveGridSize`.

**Image extraction to lift** (`AutoElement.vue` lines 315–341 — `getImageInfo`):
```typescript
// Source: AutoElement.vue lines 315–341
// This function is LIFTED (moved) into auto-ui-helpers.ts.
// The $images extraction it implements is the core of resolvePieceVisual.
type ImageInfo =
  | { type: 'url'; src: string }
  | { type: 'sprite'; sprite: string; x: number; y: number; width: number; height: number };

function getImageInfo(image: unknown): ImageInfo | null {
  if (!image) return null;
  if (typeof image === 'string') return { type: 'url', src: image };
  if (typeof image === 'object' && image !== null) {
    const spriteObj = image as { sprite?: string; x?: number; y?: number; width?: number; height?: number };
    if (spriteObj.sprite && typeof spriteObj.x === 'number' && typeof spriteObj.y === 'number') {
      return {
        type: 'sprite',
        sprite: spriteObj.sprite,
        x: spriteObj.x,
        y: spriteObj.y,
        width: spriteObj.width ?? 238,   // ← card default; for pieces use ImageRef.width (always present)
        height: spriteObj.height ?? 333, // ← card default; for pieces use ImageRef.height (always present)
      };
    }
    if (spriteObj.sprite) {
      return { type: 'url', src: spriteObj.sprite };
    }
  }
  return null;
}
```
IMPORTANT: The `width ?? 238` / `height ?? 333` defaults are card-specific. `resolvePieceVisual` must use `s.width` and `s.height` directly from the sprite object — they are non-optional on `ImageRef` for pieces. Do NOT fall back to 238/333 in the helper.

**Grid-size extraction to lift** (`AutoElement.vue` lines 607–657 — `boardSize` computed):
```typescript
// Source: AutoElement.vue lines 607–657 (the logic inside the computed is lifted, the computed itself is replaced)
// Lines 621–637: inferred coord path (gridCoordNames)
const { first, second } = gridCoordNames.value;
let maxFirst = 0;
let maxSecond = 0;
for (const child of visibleChildren.value) {
  const childAttrs = child.attributes ?? {};
  const firstVal = childAttrs[first];
  const secondVal = childAttrs[second];
  if (typeof firstVal === 'number') maxFirst = Math.max(maxFirst, firstVal);
  if (typeof secondVal === 'number') maxSecond = Math.max(maxSecond, secondVal);
}
return { rows: maxFirst + 1, columns: maxSecond + 1 };

// Lines 640–656: explicit coord path ($rowCoord / $colCoord)
let maxRow = 0;
let maxCol = 0;
for (const child of visibleChildren.value) {
  const childAttrs = child.attributes ?? {};
  const rowVal = childAttrs[rowCoord];
  const colVal = childAttrs[colCoord];
  if (typeof rowVal === 'number') maxRow = Math.max(maxRow, rowVal);
  if (typeof colVal === 'number') maxCol = Math.max(maxCol, colVal);
}
return { rows: maxRow + 1, columns: maxCol + 1 };
```
In `resolveGridSize`, the resolution order is: check explicit `$rowCoord`/`$colCoord` FIRST (before the children-length guard per Pitfall 6), then inferred coords, then error sentinel.

**Player color access pattern** (verified from `game-element.ts` serialization, line 775):
```typescript
// element.attributes.player is serialized as: { __playerRef, seat, color?, name? }
const player = element.attributes?.player as { color?: string } | undefined;
const tokenColor = player?.color ?? '#888888'; // neutral per UI-SPEC
```

---

### `src/ui/components/auto-ui/auto-ui-helpers.test.ts` (test)

**Analog:** `src/ui/composables/useGameViewEnrichment.test.ts`

**Imports pattern** (lines 1–5):
```typescript
import { describe, it, expect, vi } from 'vitest';
// No 'ref', no 'vue' imports needed — helpers are pure functions, no reactivity
import { resolvePieceVisual, resolveGridSize } from './auto-ui-helpers.js';
```

**Test file structure pattern** (`useGameViewEnrichment.test.ts` lines 7–17):
```typescript
// Inline factory functions build minimal GameElement objects — no mocking framework needed
function buildView(): GameElement {
  return {
    id: 1,
    className: 'Game',
    attributes: {},
    children: [
      { id: 2, className: 'Card', attributes: { rank: 'A' }, children: [] },
    ],
  };
}
```
Apply the same pattern for test helpers:
```typescript
function buildPiece(attributes: Record<string, unknown> = {}): GameElement {
  return { id: 1, className: 'Piece', name: 'pawn', attributes, children: [] };
}

function buildBoard(attributes: Record<string, unknown>, children: GameElement[] = []): GameElement {
  return { id: 2, className: 'Board', name: 'board', attributes, children };
}

function buildCell(row: number, col: number, rowAttr = 'row', colAttr = 'col'): GameElement {
  return { id: Math.random(), className: 'Cell', attributes: { [rowAttr]: row, [colAttr]: col }, children: [] };
}
```

**console.error spy pattern** (`useGameViewEnrichment.test.ts` lines 20–28):
```typescript
describe('resolveGridSize', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  beforeEach(() => errorSpy.mockClear());
  afterAll(() => errorSpy.mockRestore());

  it('...', () => { ... });
});
```
Use this pattern when testing that `console.error` fires (the watcher in AutoElement.vue calls it, but the helper itself does not — tests of the helper's `{ ok: false }` return value do not need the spy; only integration tests that exercise the watcher do).

**Assertion pattern** (`useGameViewEnrichment.test.ts` lines 34–44):
```typescript
// Plain assertions — no async, no DOM
it('returns kind:image for string $images.face', () => {
  const piece = buildPiece({ $images: { face: 'http://example.com/pawn.png' } });
  const result = resolvePieceVisual(piece);
  expect(result.kind).toBe('image');
  expect((result as { kind: 'image'; src: string }).src).toBe('http://example.com/pawn.png');
});
```

---

### `AutoElement.vue` — piece template replacement (lines 1277–1289)

**Analog:** Card template in `AutoElement.vue` (lines 927–976)

**Discriminated template dispatch pattern** (lines 945–975):
```html
<!-- Card analog: three-branch dispatch on image type -->
<template v-if="currentCardImage">
  <img
    v-if="currentCardImage.type === 'url'"
    :src="currentCardImage.src"
    class="card-image"
    :alt="displayLabel"
  />
  <div
    v-else-if="currentCardImage.type === 'sprite'"
    class="card-image card-sprite"
    :style="getSpriteStyle(currentCardImage)"
  ></div>
</template>
<div v-else class="card-face">
  {{ displayLabel }}
</div>
```
Apply the same three-branch pattern for pieces using `pieceVisual.kind` (`'image'` / `'sprite'` / `'token'`). The piece template outer wrapper div (lines 1278–1286) keeps all existing attributes (`class`, `:style`, `:data-element-id`, `:draggable`, drag event handlers) — only the inner content changes.

**Script setup addition pattern** (existing computed pattern, e.g. lines 607–608):
```typescript
// Import helper (add to existing import block)
import { resolvePieceVisual, resolveGridSize } from './auto-ui-helpers.js';

// Piece visual (add alongside existing computeds)
const pieceVisual = computed(() =>
  elementType.value === 'piece' ? resolvePieceVisual(props.element) : null
);
```

**Sprite inline-style pattern** (lines 956–960 — card sprite, for reference only; pieces do NOT use `getSpriteStyle`):
```html
<!-- DO NOT copy getSpriteStyle for pieces — it uses NATIVE_CARD_WIDTH/HEIGHT constants -->
<!-- Instead, apply sprite coords directly as background CSS: -->
<div
  class="piece-sprite"
  :style="{
    backgroundImage: `url(${pieceVisual.sprite})`,
    backgroundPosition: `-${pieceVisual.x}px -${pieceVisual.y}px`,
    backgroundSize: `${pieceVisual.width}px ${pieceVisual.height}px`,
    backgroundRepeat: 'no-repeat',
  }"
/>
```

---

### `AutoElement.vue` — board computed + error panel (lines 607–657, 1131–1157)

**Analog A:** Existing `watchEffect` at line 706 (side-effect from reactive state without flooding)

**watchEffect side-effect pattern** (lines 706–711):
```typescript
// Existing precedent: watchEffect for a one-time provide when condition is first true
watchEffect(() => {
  if (elementType.value === 'hex-board' && !hexPropsProvided.value) {
    provide('hexGridProps', hexGridProps.value);
    hexPropsProvided.value = true;
  }
});
```
Apply the same pattern for `console.error` on grid error (fire once per unique error, not on every render):
```typescript
// gridResult computed (replaces boardSize)
const gridResult = computed(() =>
  elementType.value === 'board' ? resolveGridSize(props.element) : null
);

// Side-effect: console.error when grid cannot resolve — watchEffect, not in computed getter
const _lastGridError = ref<string | null>(null);
watchEffect(() => {
  const result = gridResult.value;
  if (result && !result.ok && result.error !== _lastGridError.value) {
    console.error(`[BoardSmith] ${result.error}`);
    _lastGridError.value = result.error;
  }
});
```

**Analog B:** Existing board template (lines 1131–1157) for the conditional branch structure

**Error panel template pattern** — no existing exact analog in codebase; closest precedent is inline `<div class="card-face">` fallback (line 972). Apply the UI-SPEC CSS contract directly:
```html
<!-- Board template: replace unconditional board-container with conditional -->
<template v-else-if="elementType === 'board'">
  <!-- Error path: grid coords undeclared/unresolvable -->
  <div v-if="gridResult && !gridResult.ok" class="grid-error-panel">
    <span class="grid-error-panel__heading">
      Grid "{{ element.name ?? element.id }}" can't render
    </span>
    <span class="grid-error-panel__hint">
      Declare $rowCoord and $colCoord on this Grid element
    </span>
  </div>
  <!-- Happy path: existing board markup, boardSize refs replaced with gridResult -->
  <div v-else class="board-container">
    <div class="board-header">{{ displayLabel }}</div>
    <div class="board-with-labels">
      <div class="board-column-labels">
        <span class="board-label corner"></span>
        <span
          v-for="(label, index) in (element.attributes?.$columnLabels as string[]
            || Array.from({length: gridResult?.cols ?? 0}, (_, i) => String(i)))"
          :key="index" class="board-label"
        >{{ label }}</span>
      </div>
      <div class="board-row-wrapper">
        <div class="board-row-labels">
          <span
            v-for="(label, index) in (element.attributes?.$rowLabels as string[]
              || Array.from({length: gridResult?.rows ?? 0}, (_, i) => String(i)))"
            :key="index" class="board-label"
          >{{ label }}</span>
        </div>
        <div class="board-grid"
          :style="{ 'grid-template-columns': `repeat(${gridResult?.cols ?? 0}, 1fr)` }">
          <AutoElement
            v-for="child in visibleChildren"
            :key="child.id"
            :element="child"
            :depth="depth + 1"
            @element-click="handleChildClick"
          />
        </div>
      </div>
    </div>
  </div>
</template>
```
Note: All three `boardSize.columns`/`boardSize.rows` references (lines 1138, 1143, 1145) switch to `gridResult?.cols` / `gridResult?.rows`.

---

## Shared Patterns

### Discriminated Union Dispatch
**Source:** `AutoElement.vue` card template, lines 945–975
**Apply to:** Piece template inner content (`pieceVisual.kind` switch)
```html
<!-- The v-if / v-else-if / v-else chain on a computed discriminated union -->
<img v-if="visual.kind === 'image'" ... />
<div v-else-if="visual.kind === 'sprite'" ... />
<div v-else class="piece-token" :style="{ background: visual.color }">...</div>
```

### Defensive Attribute Access
**Source:** `useGameViewHelpers.ts` line 24–26 + `AutoElement.vue` boardSize lines 612–613
**Apply to:** Both `resolvePieceVisual` and `resolveGridSize`
```typescript
const attrs = element.attributes ?? {};
```

### `watchEffect` for One-Shot Side Effects
**Source:** `AutoElement.vue` lines 706–711
**Apply to:** `console.error` call when `!gridResult.ok`
```typescript
watchEffect(() => {
  // Only fire when condition first becomes true (or changes to a new error)
  if (someCondition.value && !alreadyDone.value) { ... }
});
```

### Inline Style for Dynamic Color
**Source:** `AutoElement.vue` grid-cell template, lines 1175–1179
**Apply to:** `.piece-token` background color from `player.color`
```html
<!-- Pattern: inline style for data-driven color, not CSS class -->
:style="{
  'background-image': `url(${element.attributes?.image})`,
  'background-size': 'cover',
}"
<!-- Piece token equivalent: -->
:style="{ background: pieceVisual.color }"
```

### Scoped CSS New Class Addition
**Source:** `AutoElement.vue` lines 1851–1915 (`.hex-piece-circle`, `.piece` rules)
**Apply to:** New CSS classes at the bottom of `<style scoped>` after existing `.piece` rule (line 1902):
```css
/* New classes after .piece block (line ~1915): */
.piece { background: transparent; /* CHANGE from #e74c3c */ }
.piece-image { ... }
.piece-sprite { ... }
.piece-token { ... }
.piece-token-label { ... }
.grid-error-panel { ... }
.grid-error-panel__heading { ... }
.grid-error-panel__hint { ... }
```
All values from UI-SPEC CSS contract. Scoped styles in Vue SFCs do not use any CSS preprocessor — plain CSS only, hex/rgba values, no variables.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.piece-token` disc (CSS) | style | — | No existing non-SVG colored disc token in codebase; closest is `.hex-piece-circle` (SVG fill) which uses `player-${seat}` class pattern explicitly rejected for this feature (D-05). UI-SPEC values apply directly. |
| `.grid-error-panel` (CSS + template) | style + component fragment | — | No existing error panel inside a board container. `console.error` messages exist throughout codebase (GameShell.vue) but none render an in-place visual error panel. UI-SPEC values apply directly. |

---

## Key Anti-Patterns (Do Not Copy)

| Anti-Pattern | Location in Codebase | Why Not to Copy |
|---|---|---|
| `getSpriteStyle(info)` for piece sprites | `AutoElement.vue` lines 353–375 | Uses `NATIVE_CARD_WIDTH = 238` as scaling base — wrong for piece sprites; use `background-size: ${width}px ${height}px` directly |
| `player-${seat}` CSS class for token color | `AutoElement.vue` lines 1234–1238 (`hex-piece-circle`) | Hardcodes colors per seat; D-05 requires inline `background: player.color` |
| `return { rows: 8, columns: 8 }` fallback | `AutoElement.vue` lines 609, 619 | These two lines are the exact target of PIECE-03; they are removed, not copied |
| `console.error(...)` inside `computed(() => ...)` | No example in codebase (correctly avoided) | Vue recomputes multiple times; use `watchEffect` for side effects |

---

## Metadata

**Analog search scope:** `src/ui/components/auto-ui/`, `src/ui/composables/`
**Files scanned:** 8
**Pattern extraction date:** 2026-06-20
