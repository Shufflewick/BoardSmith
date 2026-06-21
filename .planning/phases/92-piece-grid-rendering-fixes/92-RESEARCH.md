# Phase 92: Piece & Grid Rendering Fixes - Research

**Researched:** 2026-06-20
**Domain:** Vue 3 SFC / AutoElement.vue rendering logic, extractable TS helpers
**Confidence:** HIGH — all findings verified directly from codebase inspection

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Build fixes as extractable helpers (composables/functions) that AutoElement.vue calls now and Phase 93 renderer reuses. Proposed shapes: `useGameGrid(element) -> { rows, cols }` or error sentinel; `resolvePieceVisual(element) -> { kind: 'image', src } | { kind: 'token', color, label }`. Lift existing `$images` extraction logic (~320–405) into shared helper.
- **D-02:** Both inference paths remain valid: explicit `$rowCoord`/`$colCoord` → inferred `gridCoordNames` → loud error. The 8×8 hardcoded fallback is removed from every path.
- **D-03:** Loud failure = visible in-board error panel (names element id + exact prop to add) AND `console.error`. Do NOT throw. Message: `Grid "{id}" can't render — declare $rowCoord/$colCoord on the Grid element`.
- **D-04:** Pieces reuse the `$images` convention — no new `$image` singular prop. A piece's image comes from `$images.face` (or a bare string treated as the single image). Same helper used for cards.
- **D-05:** Default token = colored disc + centered label. Owner color from `player.color` (engine first-class). Pieces with no owner fall back to neutral token color. Token shape/style and neutral color are planner's discretion (UI-SPEC specifies `#888888` neutral).

### Claude's Discretion

- Helper file locations/names, token neutral color, whether shape varies by element type (default: disc for all), and exact error-panel markup.

### Deferred Ideas (OUT OF SCOPE)

- Ranked-tester dispatch, archetype templates, full renderer rebuild (Phase 93), interaction/presentation rewiring (Phase 94).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIECE-01 | A piece renders its `$images` as an image rather than a text label | `resolvePieceVisual` helper replaces bare `{{ displayLabel }}` in piece template; reads `$images.face` using lifted `getImageInfo` logic |
| PIECE-02 | A piece with no image renders as labeled token with owner color/shape — not bare text | `resolvePieceVisual` returns `kind: 'token'` with `player.color` from serialized player attribute; CSS disc from `.piece-token` class |
| PIECE-03 | Grid boards size from declared coords; 8×8 fallback removed; missing coords fail loudly | `resolveGridSize` helper replaces `boardSize` computed; two fallback lines (609, 619) become error sentinels; board template gets conditional error panel branch |
</phase_requirements>

---

## Summary

Phase 92 is a focused surgical refactor of two areas in `AutoElement.vue`: the piece template branch (currently renders only `{{ displayLabel }}`) and the `boardSize` computed property (has two hardcoded `{ rows: 8, columns: 8 }` fallbacks that must become loud errors). `AutoGameBoard.vue` has NO hardcoded grid dimensions and needs no changes for PIECE-03.

All changes flow through two new extractable helper functions — `resolvePieceVisual` and `resolveGridSize` — which encapsulate the existing logic currently inlined in `AutoElement.vue`. Extracting to helpers means Phase 93's new renderer can import and reuse them without touching Phase 92's work. The key risk is `getSpriteStyle` being tightly coupled to card-specific native dimensions (238×333, `NATIVE_CARD_WIDTH/HEIGHT` constants); sprite pieces need pixel-exact dimensions from the `ImageRef` object itself, not card-derived scaling.

Player color is confirmed to flow through the engine's serialization: when a game element has a `player` attribute pointing to a Player instance, the serialized form is `{ __playerRef, seat, color, name }` (game-element.ts:773–776). So `element.attributes?.player?.color` is always a string (or undefined) in the game view. The `hex-piece-circle` SVG circles currently use CSS class selectors (`player-0`, `player-1`) with hardcoded colors — those are out of scope for this phase (they live inside the SVG rendering path, not the regular piece template path).

**Primary recommendation:** Create `src/ui/components/auto-ui/auto-ui-helpers.ts` with `resolvePieceVisual` and `resolveGridSize` as pure functions. Update the piece template and board template in `AutoElement.vue`. Add unit tests for both helpers (pure functions, no DOM needed, compatible with existing `environment: 'node'` vitest config).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Piece visual resolution ($images → image/token) | Frontend (SFC) | Helper (TS pure function) | Visual dispatch is a UI concern; pure function enables testability and Phase 93 reuse |
| Grid dimension resolution ($rowCoord/$colCoord) | Frontend (SFC) | Helper (TS pure function) | Reading element attributes and scanning children is a UI rendering concern |
| Player color propagation | Engine serialization | Frontend read | Engine already serializes `player.color` into the game view; UI reads it directly |
| Error panel display | Frontend (SFC) | — | Rendered in-place where the board would be; no backend involvement |

---

## Standard Stack

No new packages are introduced in this phase. [VERIFIED: codebase inspection]

### Existing Stack (Already Present)

| Library | Version | Purpose | Relevance to Phase |
|---------|---------|---------|---------------------|
| Vue 3 (SFC) | workspace | Component system | `AutoElement.vue` is a Vue SFC with `<script setup>` |
| TypeScript | workspace | Type safety | New helper file is `.ts` |
| vitest | workspace | Test runner | Existing config: `environment: 'node'`, `include: src/**/*.test.ts` |

### No New Installations

This phase makes no `npm install` calls. All capabilities exist in the current stack.

---

## Package Legitimacy Audit

Not applicable — no new packages installed in this phase.

---

## Architecture Patterns

### System Architecture Diagram

```
GameElement (serialized from engine)
  └─ attributes.$images  ─────────────────┐
  └─ attributes.player.color ─────────────┤──> resolvePieceVisual(element)
  └─ attributes.$rowCoord / $colCoord ────┤         │
  └─ children[].attributes[coord]         │    { kind:'image',src } → <img class="piece-image" />
                                          │    { kind:'sprite',...} → <div class="piece-sprite" />
resolveGridSize(element)  ←──────────────┘    { kind:'token',color,label } → <div class="piece-token" :style="{background:color}">
  │
  { ok:true, rows, cols } ──────> .board-grid (grid-template-columns: repeat(cols, 1fr))
  { ok:false, error }     ──────> <div class="grid-error-panel"> + console.error(error)
```

### Recommended Project Structure

New file:
```
src/ui/components/auto-ui/
├── AutoElement.vue         # Modified: piece template + board template + import helpers
├── AutoGameBoard.vue       # No changes needed
├── auto-ui-helpers.ts      # NEW: resolvePieceVisual + resolveGridSize (pure functions)
└── auto-ui-helpers.test.ts # NEW: unit tests for both helpers
```

Note: `src/ui/composables/useGameGrid.ts` is a DIFFERENT composable — it is the PUBLIC API for custom UI developers (provides `getCellAt`, `toNotation`, `findCells`, etc.). Do NOT modify it for this phase. The new `resolveGridSize` is an INTERNAL auto-ui rendering helper.

### Pattern 1: resolvePieceVisual — Pure Function

**What:** Takes a serialized `GameElement`, returns a discriminated union describing how to render it.
**When to use:** Called from the piece template branch in AutoElement.vue; importable by Phase 93.

```typescript
// Source: CONTEXT.md D-01, UI-SPEC.md helper API contract
// File: src/ui/components/auto-ui/auto-ui-helpers.ts

type PieceVisual =
  | { kind: 'image'; src: string }
  | { kind: 'sprite'; sprite: string; x: number; y: number; width: number; height: number }
  | { kind: 'token'; color: string; label: string };

function resolvePieceVisual(element: GameElement): PieceVisual {
  const attrs = element.attributes ?? {};
  const images = attrs.$images;

  // Bare string: treat as face image URL
  if (typeof images === 'string') {
    return { kind: 'image', src: images };
  }

  // Object: look for .face key (matching card convention, D-04)
  if (images !== null && typeof images === 'object') {
    const imagesObj = images as Record<string, unknown>;
    const face = imagesObj['face'];
    if (typeof face === 'string') {
      return { kind: 'image', src: face };
    }
    if (face !== null && typeof face === 'object') {
      const s = face as { sprite?: string; x?: number; y?: number; width?: number; height?: number };
      if (s.sprite && typeof s.x === 'number' && typeof s.y === 'number' && s.width && s.height) {
        return { kind: 'sprite', sprite: s.sprite, x: s.x, y: s.y, width: s.width, height: s.height };
      }
    }
  }

  // No image — return token with owner color (D-05)
  const player = attrs.player as { color?: string } | undefined;
  return {
    kind: 'token',
    color: player?.color ?? '#888888',
    label: element.name ?? element.className,
  };
}
```

### Pattern 2: resolveGridSize — Pure Function

**What:** Takes a serialized grid `GameElement`, returns `{ ok: true, rows, cols }` or `{ ok: false, error }`.
**When to use:** Replaces the `boardSize` computed in AutoElement.vue.

```typescript
// Source: CONTEXT.md D-02, UI-SPEC.md helper API contract
// File: src/ui/components/auto-ui/auto-ui-helpers.ts

type GridResult =
  | { ok: true; rows: number; cols: number }
  | { ok: false; error: string };

function resolveGridSize(element: GameElement): GridResult {
  const attrs = element.attributes ?? {};
  const children = element.children ?? [];

  if (children.length === 0) {
    return {
      ok: false,
      error: `Grid "${element.name ?? element.id}" can't render — declare $rowCoord/$colCoord on the Grid element`,
    };
  }

  const rowCoord = attrs.$rowCoord as string | undefined;
  const colCoord = attrs.$colCoord as string | undefined;

  // Path 1: explicit $rowCoord/$colCoord
  if (rowCoord && colCoord) {
    let maxRow = 0, maxCol = 0;
    for (const child of children) {
      const ca = child.attributes ?? {};
      if (typeof ca[rowCoord] === 'number') maxRow = Math.max(maxRow, ca[rowCoord] as number);
      if (typeof ca[colCoord] === 'number') maxCol = Math.max(maxCol, ca[colCoord] as number);
    }
    return { ok: true, rows: maxRow + 1, cols: maxCol + 1 };
  }

  // Path 2: infer from first two numeric child attributes (gridCoordNames)
  const firstChild = children[0];
  const numericAttrs = Object.entries(firstChild.attributes ?? {})
    .filter(([k, v]) => typeof v === 'number' && !k.startsWith('_'))
    .map(([k]) => k)
    .slice(0, 2);

  if (numericAttrs.length >= 2) {
    const [first, second] = numericAttrs;
    let maxFirst = 0, maxSecond = 0;
    for (const child of children) {
      const ca = child.attributes ?? {};
      if (typeof ca[first] === 'number') maxFirst = Math.max(maxFirst, ca[first] as number);
      if (typeof ca[second] === 'number') maxSecond = Math.max(maxSecond, ca[second] as number);
    }
    return { ok: true, rows: maxFirst + 1, cols: maxSecond + 1 };
  }

  // Path 3: neither available — loud error (D-02, D-03)
  return {
    ok: false,
    error: `Grid "${element.name ?? element.id}" can't render — declare $rowCoord/$colCoord on the Grid element`,
  };
}
```

### Pattern 3: Piece Template in AutoElement.vue

Replace the current piece template (lines 1277–1289) which renders only `{{ displayLabel }}`:

```html
<!-- Source: UI-SPEC.md Component Inventory §1 and §2 -->
<!-- BEFORE (line 1287): {{ displayLabel }} -->
<!-- AFTER: -->
<template v-else-if="elementType === 'piece'">
  <div
    :class="['piece', { 'is-draggable': isActionSelectable, 'is-dragging': isDragged, 'hex-piece': !!props.hexPieceSize }]"
    :style="pieceStyle"
    :data-element-id="element.id"
    :data-animatable="true"
    :draggable="isActionSelectable"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
  >
    <img
      v-if="pieceVisual.kind === 'image'"
      class="piece-image"
      :src="pieceVisual.src"
      alt=""
      aria-hidden="true"
    />
    <div
      v-else-if="pieceVisual.kind === 'sprite'"
      class="piece-sprite"
      :style="{
        backgroundImage: `url(${pieceVisual.sprite})`,
        backgroundPosition: `-${pieceVisual.x}px -${pieceVisual.y}px`,
        backgroundSize: `${pieceVisual.width}px ${pieceVisual.height}px`,
        backgroundRepeat: 'no-repeat',
      }"
    />
    <div
      v-else
      class="piece-token"
      :style="{ background: pieceVisual.color }"
    >
      <span class="piece-token-label">{{ pieceVisual.label }}</span>
    </div>
  </div>
</template>
```

Add to `<script setup>`:
```typescript
import { resolvePieceVisual } from './auto-ui-helpers.js';
const pieceVisual = computed(() => resolvePieceVisual(props.element));
```

### Pattern 4: Board Template Error Panel Branch

The current board template (lines 1131–1157) uses `boardSize.rows` / `boardSize.columns` unconditionally. Replace the `boardSize` computed and add a branch:

Replace `boardSize` computed (lines 607–657) with:
```typescript
import { resolveGridSize } from './auto-ui-helpers.js';
const gridResult = computed(() => resolveGridSize(props.element));
```

Board template becomes:
```html
<template v-else-if="elementType === 'board'">
  <!-- Error path: grid coords missing/undeclared -->
  <template v-if="!gridResult.ok">
    <!-- console.error side-effect via watchEffect or in resolveGridSize caller -->
    <div class="grid-error-panel">
      <span class="grid-error-panel__heading">{{ gridResult.error.split(' — ')[0] }}</span>
      <span class="grid-error-panel__hint">{{ gridResult.error.split(' — ')[1] }}</span>
    </div>
  </template>
  <!-- Happy path: render grid as before -->
  <template v-else>
    <div class="board-container">
      <!-- ... existing board markup using gridResult.rows / gridResult.cols ... -->
    </div>
  </template>
</template>
```

`console.error` must fire once per render when `!gridResult.ok`. Use `watchEffect` or a computed side-effect pattern — do NOT call `console.error` directly in a computed getter.

### Anti-Patterns to Avoid

- **Modifying `getSpriteStyle` for pieces:** `getSpriteStyle` uses `NATIVE_CARD_WIDTH = 238 / NATIVE_CARD_HEIGHT = 333` as the scaling base — it is correct for cards. Piece sprites have their own `width`/`height` in the `ImageRef` object. Use those pixel values directly as `background-size` rather than scaling through card-native dimensions. The UI-SPEC sprite CSS contract shows direct `width`/`height` application, not `getSpriteStyle`.
- **Using CSS class `player-${seat}` for piece tokens:** The hex-piece-circle precedent uses seat-indexed CSS classes with hardcoded colors. D-05 explicitly says NOT to do this for piece tokens — read `player.color` as an inline `background` style instead.
- **Throwing on missing grid coords:** D-03 requires the error panel + `console.error`. Never `throw` — the rest of the UI must remain usable.
- **Changing the public `useGameGrid` composable:** It is a public API for custom UI developers and has different semantics (takes config options, not an element). Leave it untouched.
- **Removing `.piece` CSS background:** The `.piece` CSS rule (line 1902) has `background: #e74c3c`. This is effectively a hardcoded player-0-red that will show through unless the `.piece` wrapper's `background` is cleared. The piece wrapper div should lose its `background` CSS property (or set it to `transparent`), since visual fill now lives in `.piece-token` (inline), `.piece-image`, or `.piece-sprite`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| $images parsing | New extraction logic | Lift existing `getImageInfo` (AutoElement.vue:321–341) into helper | Already handles string/sprite-object/null cases correctly |
| Grid coord scanning | New child-scan loop | Lift existing `boardSize` logic (AutoElement.vue:640–656) | Already iterates children and finds max values |
| Sprite rendering | Custom CSS calc | Use `backgroundImage/Position/Size` directly from `ImageRef.{sprite,x,y,width,height}` | These are pixel-exact — no scaling needed for pieces |
| Player color lookup | Searching game view tree | Read `element.attributes?.player?.color` directly | Engine serialization guarantees it's present at `attributes.player.color` (game-element.ts:775) |

**Key insight:** The code to be extracted already exists and works correctly. The task is to lift it, not rewrite it.

---

## Common Pitfalls

### Pitfall 1: `resolveGridSize` called on non-board elements

**What goes wrong:** `elementType` detection runs before `resolveGridSize` is called, but `gridResult` is a computed that always runs.
**Why it happens:** Vue's `computed` eagerly evaluates. Calling `resolveGridSize` on a card or piece element will return `ok: false` (no children with coords) or misleading dimensions.
**How to avoid:** Guard the `gridResult` computed with `elementType.value === 'board'`. Use `const gridResult = computed(() => elementType.value === 'board' ? resolveGridSize(props.element) : null)` and check for null in the template.
**Warning signs:** Error panels appearing on card or hand containers.

### Pitfall 2: `console.error` in a computed getter

**What goes wrong:** Calling `console.error(...)` inside a `computed(() => ...)` fires on every reactive re-evaluation, potentially flooding the console.
**Why it happens:** Vue recomputes reactive dependencies multiple times during rendering.
**How to avoid:** Fire `console.error` via a `watchEffect` that watches `gridResult` and logs when `!gridResult.value?.ok`. The error panel HTML is driven by the computed; the side-effect fires in the watcher.
**Warning signs:** Console flooded with repeated error messages.

### Pitfall 3: `boardSize` computed renamed but still referenced in template labels

**What goes wrong:** AutoElement.vue uses `boardSize.rows` and `boardSize.columns` in TWO places beyond the grid itself: the column labels generator (line 1138) and the row labels generator (line 1143). Both use `Array.from({length: boardSize.columns}, ...)` and `Array.from({length: boardSize.rows}, ...)`.
**Why it happens:** The `boardSize` computed is used in three places in the board template (labels + grid). Renaming requires updating all three.
**How to avoid:** Search for all uses of `boardSize` in the template before removing the computed. Lines: 1138 (column labels), 1143 (row labels), 1145 (grid-template-columns). All must switch to `gridResult.cols` / `gridResult.rows`.
**Warning signs:** TypeScript errors on `boardSize.columns` after rename; or blank label arrays.

### Pitfall 4: `.piece` CSS `background: #e74c3c` bleeds through

**What goes wrong:** The `.piece` CSS rule (line 1902) sets `background: #e74c3c`. If the piece template's inner content is transparent, this red bleeds through and looks like player-0's color even for ownerless pieces.
**Why it happens:** The `.piece` div is the wrapper for all three visual kinds (image, sprite, token). Its background must not be visible in the image/sprite cases.
**How to avoid:** Change `.piece { background: transparent; }` (or remove `background` from the rule entirely). Inner `.piece-token` sets its own background via inline style. Images and sprites cover the area via `width: 100%; height: 100%`.
**Warning signs:** Pieces with images showing a red tint or halo.

### Pitfall 5: Sprite display size for pieces vs cards

**What goes wrong:** `getSpriteStyle` (line 353) scales sprite coordinates using `displayWidth / NATIVE_CARD_WIDTH` where `NATIVE_CARD_WIDTH = 238`. For a piece sprite (e.g., 40×40), this scaling produces wrong `background-position` values.
**Why it happens:** `getSpriteStyle` was written card-first — the "native" coordinate system is a 238×333 card face.
**How to avoid:** For piece sprites, do NOT call `getSpriteStyle`. Use the sprite's own `{width, height}` from `ImageRef` as the display size AND as the native size. The background-position is pixel-exact from the `ImageRef.{x, y}` values.
**Warning signs:** Sprite pieces showing wrong portion of sprite sheet.

### Pitfall 6: No children edge case in resolveGridSize

**What goes wrong:** A grid board element arrives with `children === []` (empty grid). `resolveGridSize` returns `ok: false` (no children to infer coords from). The error panel shows even though the board is just empty, not misconfigured.
**Why it happens:** The inference path needs children to discover coord attribute names.
**How to avoid:** Distinguish the empty-board case from the misconfigured-board case. If `$rowCoord` and `$colCoord` ARE declared but children is empty, return `{ ok: true, rows: 0, cols: 0 }` (board is declared and valid, just empty). Only trigger the error when both inference paths fail with non-empty children. Update `resolveGridSize` to check explicit attrs BEFORE the children-length guard.
**Warning signs:** Error panel on a legitimately empty (but properly declared) grid board.

---

## Code Examples

### Existing `getImageInfo` to Lift (AutoElement.vue:321–341)

```typescript
// Source: AutoElement.vue (verified lines 321-341)
// This exact logic goes into auto-ui-helpers.ts as the image extraction core
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
        width: spriteObj.width ?? 238,
        height: spriteObj.height ?? 333,
      };
    }
    if (spriteObj.sprite) {
      return { type: 'url', src: spriteObj.sprite };
    }
  }
  return null;
}
```

Note: The `width ?? 238` / `height ?? 333` defaults are card-specific. For pieces, the `ImageRef` type guarantees `width` and `height` are present (non-optional). The helper should not rely on card-default fallbacks for piece sprites.

### Player Color Access Pattern (Verified)

```typescript
// Source: game-element.ts:773-776 (engine serialization) — VERIFIED
// When element.attributes.player is a serialized Player reference, shape is:
// { __playerRef: number, seat: number, color?: string, name?: string }

const player = element.attributes?.player as { color?: string } | undefined;
const tokenColor = player?.color ?? '#888888'; // neutral fallback per UI-SPEC
```

### Exact boardSize Fallback Lines to Remove

```typescript
// Source: AutoElement.vue:607-620 (verified by direct inspection)
// LINE 609 — remove this return:
return { rows: 8, columns: 8 }; // Default fallback  ← REMOVE

// LINE 617-620 — remove this block:
if (!rowCoord || !colCoord) {
  if (!gridCoordNames.value) {
    return { rows: 8, columns: 8 };  ← REMOVE
  }
```

### Error Panel Template (UI-SPEC Contract)

```html
<!-- Source: UI-SPEC.md Component Inventory §3 + Copywriting Contract -->
<div class="grid-error-panel">
  <span class="grid-error-panel__heading">Grid "{{ element.name ?? element.id }}" can't render</span>
  <span class="grid-error-panel__hint">Declare $rowCoord and $colCoord on this Grid element</span>
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Piece renders `{{ displayLabel }}` only | Must render image or token | Phase 92 | Pieces become visually meaningful |
| `boardSize` returns `{ rows: 8, columns: 8 }` silently | `resolveGridSize` returns error sentinel; board shows error panel | Phase 92 | Misconfigured grids fail loudly |

**Deprecated/outdated in Phase 92:**
- `boardSize` computed in AutoElement.vue: replaced by `gridResult` computed using `resolveGridSize`
- `background: #e74c3c` on `.piece` CSS rule: must be removed (hardcoded red overrides owner color)
- `player-${seat}` class on piece tokens: not introduced (hex-piece-circle uses this pattern for SVG circles, which is out of scope)

---

## Exact Line Inventory (AutoElement.vue)

| Location | Lines | Current Code | Action Required |
|----------|-------|-------------|-----------------|
| `getImageInfo` function | 321–341 | Image parsing for cards | **LIFT** into `auto-ui-helpers.ts` |
| `boardSize` computed | 607–657 | Returns `{rows,columns}` or `{8,8}` | **REPLACE** with `gridResult = computed(() => resolveGridSize(...))` |
| Line 609 | 609 | `return { rows: 8, columns: 8 };` | **REMOVE** (first fallback) |
| Line 619 | 619 | `return { rows: 8, columns: 8 };` | **REMOVE** (second fallback) |
| Board template — column labels | 1138 | `boardSize.columns` | Change to `gridResult.cols` |
| Board template — row labels | 1143 | `boardSize.rows` | Change to `gridResult.rows` |
| Board template — grid CSS | 1145 | `boardSize.columns` | Change to `gridResult.cols` |
| Board template (add branch) | ~1131 | No error panel exists | **ADD** `v-if="!gridResult.ok"` error panel before happy path |
| Piece template | 1277–1289 | `{{ displayLabel }}` | **REPLACE** with image/sprite/token dispatch |
| `.piece` CSS | 1902–1915 | `background: #e74c3c;` | **REMOVE** background declaration (or set `transparent`) |
| CSS additions | after `.piece` | nothing | **ADD** `.piece-image`, `.piece-sprite`, `.piece-token`, `.piece-token-label`, `.grid-error-panel`, `.grid-error-panel__heading`, `.grid-error-panel__hint` |

**No changes required in AutoGameBoard.vue.** [VERIFIED: confirmed no grid dimension logic in that file]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `element.attributes?.player?.color` reliably returns the player's color string as configured by the game designer | Pattern 3 / D-05 | Low — confirmed from engine serialization code (game-element.ts:775); engine guarantees `color` is serialized when set on Player |
| A2 | `$images` as a bare string on a piece should be treated as the face URL (not a keyed object) | resolvePieceVisual pattern | Low — CONTEXT.md D-04 states "a bare string treated as the single image" |
| A3 | The "no children" edge case for grid (empty board) should NOT show an error panel when `$rowCoord`/`$colCoord` are explicitly declared | Pitfall 6 | Medium — if wrong, empty but properly configured boards show spurious errors; verify against real game usage |

---

## Open Questions

1. **Empty-board edge case in resolveGridSize**
   - What we know: Current `boardSize` returns 8×8 when `visibleChildren.length === 0` (line 608–610)
   - What's unclear: Should an empty-but-declared grid return `{ ok: true, rows: 0, cols: 0 }` or wait until children appear?
   - Recommendation: Return `{ ok: true, rows: 0, cols: 0 }` when `$rowCoord`/`$colCoord` are declared (board is validly configured); show error only when children exist but no coord system can be determined.

2. **console.error placement for `!gridResult.ok`**
   - What we know: D-03 requires `console.error` in addition to the panel
   - What's unclear: Whether to use `watchEffect` (may fire multiple times) or one-shot detection
   - Recommendation: Use `watchEffect` with a guard so it only logs once per unique error message.

---

## Environment Availability

Step 2.6: SKIPPED — this phase makes no external tool calls, installs no packages, and touches only TypeScript/Vue source files.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | `vitest.config.ts` (root) |
| Environment | `node` (no DOM — confirmed) |
| Quick run command | `npm test -- --reporter=verbose auto-ui-helpers` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIECE-01 | `resolvePieceVisual` returns `kind:'image'` for string `$images.face` | unit | `npm test -- auto-ui-helpers` | ❌ Wave 0 |
| PIECE-01 | `resolvePieceVisual` returns `kind:'sprite'` for sprite-object `$images.face` | unit | `npm test -- auto-ui-helpers` | ❌ Wave 0 |
| PIECE-02 | `resolvePieceVisual` returns `kind:'token'` with `player.color` when `$images` absent | unit | `npm test -- auto-ui-helpers` | ❌ Wave 0 |
| PIECE-02 | `resolvePieceVisual` returns `kind:'token'` with `#888888` when no owner | unit | `npm test -- auto-ui-helpers` | ❌ Wave 0 |
| PIECE-03 | `resolveGridSize` returns `{ok:true, rows, cols}` when `$rowCoord`/`$colCoord` declared | unit | `npm test -- auto-ui-helpers` | ❌ Wave 0 |
| PIECE-03 | `resolveGridSize` returns `{ok:true}` via inferred gridCoordNames | unit | `npm test -- auto-ui-helpers` | ❌ Wave 0 |
| PIECE-03 | `resolveGridSize` returns `{ok:false, error}` when neither coord path resolves | unit | `npm test -- auto-ui-helpers` | ❌ Wave 0 |
| PIECE-03 | Error message names element id and mentions `$rowCoord/$colCoord` | unit | `npm test -- auto-ui-helpers` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- --reporter=verbose auto-ui-helpers`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/ui/components/auto-ui/auto-ui-helpers.test.ts` — covers all PIECE-01/02/03 unit cases above

*(No existing test file for AutoElement or AutoGameBoard — none needed since all testable logic is extracted to the pure helper file)*

---

## Security Domain

Not applicable to this phase. Phase 92 makes no changes to data visibility, authorization, or network transmission. Security changes (SEC-01, SEC-02) are handled in Phase 91.

---

## Sources

### Primary (HIGH confidence)

- `AutoElement.vue` — direct inspection of lines 321–341, 607–657, 1131–1157, 1277–1289, 1851–1872, 1902–1915
- `AutoGameBoard.vue` — confirmed no grid dimension logic
- `src/engine/element/game-element.ts:769–776` — player serialization (color confirmed in output)
- `src/engine/element/types.ts:11–24` — `ImageRef` type definition
- `src/engine/element/grid.ts:82–89` — `$rowCoord`/`$colCoord` defined on `Grid` class
- `src/engine/player/player.ts:107–119` — `Player.color` property definition
- `src/ui/composables/useGameGrid.ts` — confirmed this is public API, not to be modified
- `vitest.config.ts` — confirmed `environment: 'node'`, no DOM
- `.planning/phases/92-piece-grid-rendering-fixes/92-CONTEXT.md` — locked decisions D-01..D-05
- `.planning/phases/92-piece-grid-rendering-fixes/92-UI-SPEC.md` — helper API shapes + CSS contracts

### Secondary (MEDIUM confidence)

- None — all findings verified directly from codebase.

### Tertiary (LOW confidence)

- None.

---

## Metadata

**Confidence breakdown:**

- Exact line numbers: HIGH — read directly from source
- `player.color` data flow: HIGH — traced through serialization in game-element.ts
- Helper file location recommendation: HIGH (auto-ui-helpers.ts is a natural home for auto-ui-internal code distinct from the public `composables/` directory)
- `getSpriteStyle` inapplicability to pieces: HIGH — confirmed NATIVE_CARD_WIDTH/HEIGHT constants are card-specific

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable codebase, low churn risk)
