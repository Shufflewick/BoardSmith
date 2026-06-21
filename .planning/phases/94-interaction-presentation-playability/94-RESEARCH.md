# Phase 94: Interaction, Presentation & Playability Gate — Research

**Researched:** 2026-06-21
**Domain:** Vue 3 UI interaction wiring, TypeScript protocol types, board-centric affordances, per-UI presentation overlays
**Confidence:** HIGH (all findings verified against live code on disk)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Multi-ref highlight metadata (INTERACT-03)**
Replace `sourceRef`/`targetRef` (singular) on `ChoiceWithRefs` and `ref` (singular) on `ValidElement`
in `protocol.ts` + `buildActionMetadata` with a single
`refs: { ref: ElementRef; role: 'source' | 'target' | 'highlight' }[]`.
No Backward Compatibility — singular fields are deleted, not preserved.
Update all consumers (`useBoardInteraction` ref-matching, ActionPanel, renderer highlight logic).

**D-02 — ActionPanel suppression (INTERACT-02)**
Footer ActionPanel is **automatically absent** (not merely hidden) when every active choice has a
board anchor. Board UIs can additionally force-suppress via `:suppress-action-panel` prop and/or a
`#action-panel` slot override on `GameShell`. Currently mounted unconditionally at `GameShell.vue:1280-1295`.

**D-03 — Board-centric default + mixed anchors (INTERACT-01)**
Anchored choices get on-board affordances. Panel shows ONLY the remaining non-anchored choices —
never duplicating what's already actionable on the board. All anchored → board only. None anchored →
panel only. Mixed → hybrid.

**D-04 — Presentation overlay (PRESENT-01/02/03)**
Plain object exported from a sibling file, keyed by element className / name / attribute →
`{ image, label, stats, render }`. Passed to auto-UI / GameShell as `:presentation` prop. Resolved
AFTER engine visibility filtering (overlay for a hidden element is never in payload). Engine carries
NO value-bearing `$`-presentation props. `$owner` rejected — ownership stays on `.player`.

### Claude's Discretion
- Exact prop/slot names, `ElementRef`/`refs` field naming, overlay key-resolution precedence
  (instance > name > class), and per-game presentation overlay contents.
- Playability-gate verification is human-driven browser testing (full game start-to-finish).

### Deferred Ideas (OUT OF SCOPE)
- Shippable-peer reframe + single-UI export + scaffold reframe → Phase 95.
- Cross-repo migration of all games + MERC canary + old-path deletion + `npm run audit` clean → Phase 96.
- General layout solver (S2), responsive primitives (S2b), phase/scoring renderers (S7),
  N-UI live switcher (S12c), auto-eject (S10), engine model additions (S11) → later milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INTERACT-01 | Action choices that carry a board anchor are actioned directly on the board by default; footer panel is fallback | D-03 hybrid logic; board renderers wire `tryUseBoardInteraction()` clicks; ActionPanel filters to unanchored choices |
| INTERACT-02 | Footer ActionPanel is suppressible; GameShell no longer mounts it unconditionally | D-02: `GameShell.vue:1279-1295` is the insertion point; `allCurrentChoicesAnchored` drives auto-absent; `:suppress-action-panel` prop for explicit override |
| INTERACT-03 | Multi-ref highlight metadata — `protocol.ts` + `buildActionMetadata` extended beyond singular refs | D-01: full 7-layer migration map documented below; all insertion points exact |
| PRESENT-01 | UI declares presentation overlay mapping class/name/attribute → visuals | D-04: overlay type + provide/inject path through `GameShell → AutoUI → AutoRenderer → renderers` |
| PRESENT-02 | Overlay resolved *after* engine visibility filtering — cannot expose what viewer can't see | `toJSONForPlayer` (Phase 91) runs server-side before `gameView` reaches UI; overlay applied in UI layer only; hidden elements appear as `{ __hidden: true }` with no class/name to match overlay keys |
| PRESENT-03 | Auto-UI reads overlay for visuals; custom UIs supply their own; engine elements carry no value-bearing `$`-props | Overlay passed as `:presentation` prop — per-UI by construction; engine `$`-props remain layout-only per Phase 91 `SAFE_LAYOUT_KEYS` allowlist |
</phase_requirements>

---

## Summary

Phase 94 completes the playability chain: Phase 93 shipped the new renderer; this phase wires
interaction affordances into it, extends the protocol type to carry multi-element ref arrays,
makes the ActionPanel conditional rather than permanent, and installs the per-UI presentation
overlay. The milestone ends with a human-verified playthrough of Hex, Go Fish, and Checkers
using ONLY the auto-UI slot.

All four locked decisions are mechanical changes to existing code — no new architecture is
invented. The changes are self-contained: D-01 is a type migration across 7 layers; D-02 is a
`v-if` + new computed; D-03 is an ActionPanel filter + renderer click handlers; D-04 is a prop
and a provide/inject chain. The primary risk is D-01's breadth (nine files touched) and verifying
that every consumer of the old singular fields is updated.

**Primary recommendation:** Execute D-01 first (it changes the types everything else reads), then
D-02/D-03 together (interaction), then D-04 (overlay), then games update, then playability gates.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Multi-ref protocol wire format | API / Session (`session/pick-handler.ts`) | Engine action types (`engine/action/types.ts`) | Protocol is server-side; engine defines the author-facing callback signature |
| Board-anchor detection (auto-absent) | Frontend / UI (`useActionController.ts`) | GameShell (`GameShell.vue`) | Controller has visibility into current pick + choices; GameShell reads a computed |
| Board-centric click affordances | Frontend / UI (per-element renderers) | `useBoardInteraction` | Renderers own visual affordance; board interaction owns state |
| ActionPanel hybrid filter | Frontend / UI (`ActionPanel.vue`) | — | ActionPanel owns its own rendering; filters unanchored choices in-place |
| Presentation overlay resolution | Frontend / UI (auto-ui renderer tree) | — | Overlay is applied in the UI layer, never in engine or session |
| Visibility filtering (SEC) | API / Backend (`engine/element/game.ts`) | — | `toJSONForPlayer` runs server-side; overlay only sees already-filtered output |
| Playability gate verification | Browser / Client (human-verified) | — | Cannot be automated end-to-end per project testing rules |

---

## Standard Stack

Phase 94 installs **no new packages**. All work is within the existing BoardSmith monorepo.

### Core (all existing)
| Library | Purpose | Where |
|---------|---------|-------|
| Vue 3 + `<script setup>` | Component reactivity, provide/inject | All `.vue` files |
| TypeScript | Types for the refs migration, overlay types | `.ts` throughout |
| Vitest 2.1 | Unit tests for new computed + overlay resolver | `*.test.ts` |

### No Package Legitimacy Audit Required
This phase adds zero external packages. All code changes are within the monorepo.

---

## Architecture Patterns

### System Architecture Diagram

```
Game Author
    │  boardRefs() → { refs: [{ ref, role }] }    (D-01 new API)
    ▼
Engine action/types.ts
    ChoiceBoardRefs = { refs: RefWithRole[] }
    BoardElementRef = { id?, name?, notation? }    (unchanged)
    │
    ▼
session/pick-handler.ts
    choice.refs = boardRefs(rawValue, ctx).refs     (builds protocol payload)
    validElem.refs = [{ ref: boardRef(el, ctx), role: 'highlight' }]
    │
    ▼
protocol.ts + session/types.ts
    ChoiceWithRefs.refs: RefWithRole[]              (no sourceRef/targetRef)
    ValidElement.refs: RefWithRole[]                (no ref)
    │
    ▼ WebSocket (server → client)
    ▼
useActionControllerTypes.ts
    (mirrors protocol shapes)
    │
    ▼
useActionController.ts
    allCurrentChoicesAnchored: ComputedRef<boolean> (new — drives D-02)
    │
    ├─────────────────────────────────────────────────────┐
    ▼                                                     ▼
ActionPanel.vue                              Per-element renderers
  filteredChoices: unanchored only (D-03)     (GridBoardRenderer,
  setHoveredChoice reads refs by role          HexBoardRenderer, etc.)
  Drag/drop: reads targetRef role ref          tryUseBoardInteraction()
                                               isSelectableElement → click → fill
    │
    ▼
GameShell.vue
  v-if="!suppressActionPanel && !allCurrentChoicesAnchored"
  :suppress-action-panel prop (D-02)
    │
    ▼
AutoRenderer.vue  ← :presentation prop (D-04)
  provide('presentation', overlay)
    │
    ▼
Per-element renderers
  applyOverlay(element, overlay)   ← after gameView (already filtered)
```

### Recommended Project Structure (additions only)
```
src/types/protocol.ts                     — modify: refs array on ChoiceWithRefs + ValidElement
src/engine/action/types.ts                — modify: ChoiceBoardRefs, BoardElementRef
src/session/pick-handler.ts               — modify: build refs array
src/session/types.ts                      — modify: mirror protocol.ts shapes
src/ui/composables/useActionControllerTypes.ts  — modify: mirror protocol.ts shapes
src/ui/composables/useActionController.ts — add: allCurrentChoicesAnchored computed
src/ui/composables/useDragDropTargets.ts  — modify: read refs by role
src/ui/components/GameShell.vue           — add: suppressActionPanel prop + v-if
src/ui/components/auto-ui/ActionPanel.vue — modify: read refs by role; filter unanchored
src/ui/components/auto-ui/AutoRenderer.vue — add: presentation prop + provide
src/ui/components/auto-ui/AutoUI.vue      — add: presentation prop pass-through
src/ui/components/auto-ui/renderers/*.vue — add: interaction affordances (click, highlight)
~/BoardSmithGames/hex/src/ui/App.vue      — update: auto-UI-only + presentation overlay
~/BoardSmithGames/go-fish/src/ui/App.vue  — update: auto-UI-only + presentation overlay
~/BoardSmithGames/checkers/src/rules/actions.ts — update: refs API
~/BoardSmithGames/go-fish/src/rules/actions.ts  — update: refs API
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Board element matching | Custom ID/name/notation lookup | `matchesRef()` in `useBoardInteraction.ts:207-217` | Precedence-based: id wins, then notation, then name — already handles all ref forms |
| Drag-drop target wiring | Custom watch in renderer | `useDragDropTargets.ts` (already wired in GameShell) | Covers all action shapes (element, element→choice+filterBy, choice+targetRef); re-wiring here duplicates and diverges |
| Animation events | New animation composable | `useAutoRendererAnimations.ts` (already wired in Phase 93) | Phase 93 D-04 explicitly delivered this; do NOT re-wire here |
| Overlay security | Pre-filter the overlay against hidden elements | Apply overlay only to elements present in `gameView` | `gameView` is already the filtered tree; hidden elements have `__hidden: true` and no className/name to match |

---

## D-01 Migration: Complete 7-Layer Map

This is the most mechanically broad change in the phase. Every insertion point is listed.

### Layer 1 — Engine author-facing types
**File:** `src/engine/action/types.ts:58-70`

Current:
```typescript
export interface BoardElementRef { id?: number; name?: string; notation?: string; }
export interface ChoiceBoardRefs { sourceRef?: BoardElementRef; targetRef?: BoardElementRef; }
```

Change to:
```typescript
export interface BoardElementRef { id?: number; name?: string; notation?: string; } // unchanged
export interface RefWithRole { ref: BoardElementRef; role: 'source' | 'target' | 'highlight'; }
export interface ChoiceBoardRefs { refs: RefWithRole[]; }
```

Also update `ElementSelection.boardRef` → return type stays `BoardElementRef` (single ref, wrapped
to `[{ ref, role: 'highlight' }]` in pick-handler). This keeps the element-selection author API
simple; only choice-selection authors need the full `{ refs: [...] }` shape.

**Also update:** `src/engine/index.ts:135-136` re-export, `src/engine/action/index.ts:19-20` re-export.

### Layer 2 — Session (server-side pick-handler)
**File:** `src/session/pick-handler.ts:228-240` (choice picks)

Current:
```typescript
if (choiceSel.boardRefs) {
  const refs = choiceSel.boardRefs(rawValue, ctx);
  if (refs.sourceRef) choice.sourceRef = refs.sourceRef;
  if (refs.targetRef) choice.targetRef = refs.targetRef;
}
```

Change to:
```typescript
if (choiceSel.boardRefs) {
  const result = choiceSel.boardRefs(rawValue, ctx);
  choice.refs = result.refs;
}
```

**File:** `src/session/pick-handler.ts:379-391` (element picks)

Current:
```typescript
if (elemSel.boardRef) {
  validElem.ref = elemSel.boardRef(element, ctx);
} else {
  validElem.ref = { id: element.id };
  if (element.notation) validElem.ref.notation = element.notation;
}
```

Change to:
```typescript
const rawRef = elemSel.boardRef
  ? elemSel.boardRef(element, ctx)
  : { id: element.id, ...(element.notation ? { notation: element.notation } : {}) };
validElem.refs = [{ ref: rawRef, role: 'highlight' }];
```

### Layer 3 — Session types
**File:** `src/session/types.ts:230-252`

Change `ChoiceWithRefs.sourceRef/targetRef` → `refs?: RefWithRole[]`
Change `ValidElement.ref` → `refs?: RefWithRole[]`

### Layer 4 — Protocol wire types
**File:** `src/types/protocol.ts:459-481`

Change `ChoiceWithRefs`:
- Remove `sourceRef?: ElementRef` and `targetRef?: ElementRef`
- Add `refs?: { ref: ElementRef; role: 'source' | 'target' | 'highlight' }[]`

Change `ValidElement`:
- Remove `ref?: ElementRef`
- Add `refs?: { ref: ElementRef; role: 'source' | 'target' | 'highlight' }[]`

### Layer 5 — UI controller types
**File:** `src/ui/composables/useActionControllerTypes.ts:24-45`

Same changes as Layer 4 (mirrors protocol shapes).

### Layer 6 — ActionPanel consumers
**File:** `src/ui/components/auto-ui/ActionPanel.vue`

Nine sites to update — all currently do pattern `choice.sourceRef ? [choice.sourceRef] : []`:

| Line range | Current | Change to |
|------------|---------|-----------|
| 355-360 | `sourceRefs: choice.sourceRef ? [choice.sourceRef] : [], targetRefs: choice.targetRef ? [...]` | `sourceRefs: (choice.refs??[]).filter(r=>r.role==='source').map(r=>r.ref), targetRefs: ...target` |
| 589-597 | `choicesWithRefs = choices.filter(c => c.sourceRef \|\| c.targetRef)` | `filter(c => c.refs?.length)` |
| 596-597 | `const ref = choice.targetRef \|\| choice.sourceRef` | `choice.refs?.find(r=>r.role==='target')?.ref ?? choice.refs?.[0]?.ref` |
| 856-873 | builds `sourceRefs`/`targetRefs` arrays from all choices | build from `choice.refs` filtered by role |
| 989-990 | `if (choice && (choice.sourceRef \|\| choice.targetRef))` | `if (choice?.refs?.length)` |
| 1048-1052 | singular wrap | role-filtered |
| (drag logic) | `choice.targetRef` for drop targets | `choice.refs?.find(r=>r.role==='target')?.ref` |

**D-03 filter (new logic at line ~250 in filteredChoices computed):**
```typescript
// Anchored choices can be actioned on the board — exclude from panel (D-03)
const isAnchored = (c: ChoiceWithRefs) => (c.refs ?? []).some(r => r.role === 'target' || r.role === 'source');
choices = choices.filter(c => !isAnchored(c));
```

Apply ONLY when some choices are anchored (not all — that's D-02 auto-absent). When ALL are
anchored, the panel is absent; when none are, all show normally.

### Layer 7 — useDragDropTargets
**File:** `src/ui/composables/useDragDropTargets.ts:86-87, 105`

Current line 86-87: `if (el.id === undefined || !el.ref) continue; targets.push({ id: el.id, ref: el.ref });`
Change to: read the highlight-role ref from `el.refs ?? []`

Current line 105: `const ref = choice.targetRef;`
Change to: `const ref = choice.refs?.find(r => r.role === 'target')?.ref;`

### Layer 7b — Game author callbacks (cross-repo)
**Files:** `~/BoardSmithGames/checkers/src/rules/actions.ts:139-155`

Current:
```typescript
boardRefs: (choice) => ({ sourceRef: { notation: choice.fromNotation }, targetRef: { notation: choice.toNotation } })
```

Change to:
```typescript
boardRefs: (choice) => ({
  refs: [
    { ref: { notation: choice.fromNotation }, role: 'source' },
    { ref: { notation: choice.toNotation }, role: 'target' },
  ]
})
```

**For multi-jump (the D-01 motivation):** Checkers multi-jump can add intermediate squares as
`role: 'highlight'` entries: `{ ref: { notation: sq }, role: 'highlight' }` for each
intermediate captured square. This is the new capability — previously impossible with singular refs.

**File:** `~/BoardSmithGames/go-fish/src/rules/actions.ts:38-46, 59-...`
Same `boardRefs` pattern change: `{ sourceRef/targetRef }` → `{ refs: [{ ref, role }] }`.

**File:** `~/BoardSmithGames/hex/src/rules/actions.ts:22-27` — `boardRef` on element selection:
The `boardRef` callback return type (`BoardElementRef`) is unchanged. Pick-handler wraps it in
`refs: [{ ref, role: 'highlight' }]` internally. Game author code untouched for element picks.

---

## D-02: ActionPanel Auto-Absent — Insertion Map

### New computed in `useActionController.ts`

The controller already has `currentPick` (current `PickMetadata`) and `getCurrentChoices()`.
Add a new exported computed `allCurrentChoicesAnchored: ComputedRef<boolean>`:

```typescript
// Returns true when every available choice for the current pick has at least one refs entry.
// When true, GameShell omits the ActionPanel entirely (D-02).
const allCurrentChoicesAnchored = computed((): boolean => {
  const pick = currentPick.value;
  if (!pick) return false;                          // no action → show panel
  if (pick.type === 'element' || pick.type === 'elements') return true; // always anchored
  if (pick.type !== 'choice') return false;         // number/text → panel only
  const choices = getCurrentChoices();
  if (choices.length === 0) return false;
  return choices.every(c => (c as ChoiceWithRefs).refs?.length);
});
```

Add to `UseActionControllerReturn` type.

### GameShell.vue changes

1. Add prop to `GameShellProps` interface:
   ```typescript
   suppressActionPanel?: boolean;
   ```

2. Add to `withDefaults`:
   ```typescript
   suppressActionPanel: false,
   ```

3. Inject `actionController.allCurrentChoicesAnchored` (already injected at line ~25).

4. Update footer at line 1279-1296 (currently unconditional):
   ```vue
   <!-- Bottom Action Bar — absent when all choices are board-anchored (D-02) -->
   <footer
     v-if="!props.suppressActionPanel && !actionController.allCurrentChoicesAnchored.value"
     class="game-shell__action-bar"
   >
     <slot name="action-panel">
       <ActionPanel ... />
     </slot>
     ...
   </footer>
   ```

The `#action-panel` slot allows complete override (escape hatch per D-02).

---

## D-03: Board-Centric Affordances in Renderers

The per-element renderers (from Phase 93) currently dispatch to the right Vue component but add
no interaction affordances. Phase 94 wires click/highlight via `tryUseBoardInteraction()`.

### Pattern for each renderer that renders individually-interactive elements

**File:** `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue` (and GridBoardRenderer, PieceRenderer, CardRenderer, HandRenderer)

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';

const props = defineProps<{ element: GameElement; depth: number; ... }>();
const boardInteraction = tryUseBoardInteraction();

const isSelectable = computed(() =>
  boardInteraction ? boardInteraction.isSelectableElement(props.element) : false
);
const isHighlighted = computed(() =>
  boardInteraction ? boardInteraction.isHighlighted(props.element) : false
);
const isSelected = computed(() =>
  boardInteraction ? boardInteraction.isSelected(props.element) : false
);
const isDisabled = computed(() =>
  boardInteraction ? boardInteraction.isDisabledElement(props.element) : false
);

function handleClick() {
  if (!boardInteraction || !isSelectable.value || isDisabled.value) return;
  boardInteraction.triggerElementSelect(props.element);
}
</script>

<template>
  <div
    :class="{ selectable: isSelectable, highlighted: isHighlighted, selected: isSelected, disabled: !!isDisabled }"
    @click="handleClick"
  >
    <!-- renderer content -->
  </div>
</template>
```

**Drag-drop:** `useDragDropTargets` is already wired in GameShell and feeds into
`useBoardInteraction` (drop targets, drag state). Renderers read `boardInteraction.isDropTarget`,
`boardInteraction.isDraggedElement` for drag visual feedback. This is already the existing pattern
from custom UIs — just extending it to the auto-UI element renderers.

**Which renderers need interaction wiring:**

| Renderer | Interaction needed |
|----------|--------------------|
| `HexBoardRenderer.vue` | Click cells (Hex placeStone, Checkers square selection) |
| `GridBoardRenderer.vue` | Click cells/squares |
| `PieceRenderer.vue` | Click pieces (element picks) |
| `CardRenderer.vue` | Click cards (Go Fish hand cards) |
| `HandRenderer.vue` | Click/highlight the hand zone itself |
| `SpaceRenderer.vue` | Click spaces (drop zones) |
| `DeckRenderer.vue` | Click for draws (if deck is a valid element) |
| `DieRenderer.vue` | Click for die selection (element picks) |

---

## D-04: Presentation Overlay — Implementation Map

### Overlay types (new file or `src/ui/types.ts` addition)

```typescript
// src/ui/components/auto-ui/presentation.ts (new)
export interface PresentationEntry {
  /** URL for the element's image */
  image?: string;
  /** Override display label */
  label?: string;
  /** Stats to display alongside element */
  stats?: Record<string, unknown>;
  /** Custom Vue component for full render override */
  render?: Component;
}

export interface PresentationOverlay {
  /** Keyed by element className */
  byClass?: Record<string, PresentationEntry>;
  /** Keyed by element name (instance-level, highest precedence) */
  byName?: Record<string, PresentationEntry>;
  /** Keyed by attribute name → attribute value → entry */
  byAttribute?: Record<string, Record<string, PresentationEntry>>;
}

/**
 * Resolve the presentation entry for a given element.
 * Precedence: byName > byClass > byAttribute
 */
export function resolvePresentation(
  element: { name?: string; className: string; attributes?: Record<string, unknown> },
  overlay: PresentationOverlay | undefined
): PresentationEntry | null {
  if (!overlay) return null;
  if (element.name && overlay.byName?.[element.name]) return overlay.byName[element.name];
  if (overlay.byClass?.[element.className]) return overlay.byClass[element.className];
  if (overlay.byAttribute) {
    for (const [attrKey, valueMap] of Object.entries(overlay.byAttribute)) {
      const attrVal = String(element.attributes?.[attrKey] ?? '');
      if (valueMap[attrVal]) return valueMap[attrVal];
    }
  }
  return null;
}
```

### Provide/inject chain

```
GameShell.vue
  props.presentation?: PresentationOverlay
  provide('presentation', toRef(props, 'presentation'))   // reactive

AutoUI.vue
  props.presentation?: PresentationOverlay
  passes to :presentation on AutoRenderer

AutoRenderer.vue
  props.presentation?: PresentationOverlay
  provide('presentation', computed(() => props.presentation))

Per-element renderers:
  const overlay = inject<ComputedRef<PresentationOverlay | undefined>>('presentation')
  const entry = computed(() => resolvePresentation(props.element, overlay?.value))
  // Use entry.value?.image ?? element.attributes?.$images?.face
  // Use entry.value?.label ?? element.name
```

### Security guarantee for PRESENT-02

The `gameView` prop flowing into `AutoRenderer.vue` is the output of `toJSONForPlayer` — already
filtered by Phase 91's `redactHiddenElementAttrs`. Hidden elements appear as
`{ __hidden: true, className: ... }` BUT the `className` IS present (it's a layout descriptor).

**Risk:** If `overlay.byClass` has an entry for a hidden element's class, the overlay entry
IS matched — but the overlay only provides presentation metadata (image URL, label). It cannot
expose game state (card values, player positions) because the overlay is pure visual metadata
authored by the game's UI layer, not the engine. The element's attributes are already redacted.

**Mitigation:** The resolver runs in the UI layer on `gameView` data. Overlay `image`/`label`
values are author-provided strings, not derived from hidden element state. Security holds by
construction: the overlay cannot say "show this hidden card's face image" because the face image
URL was stripped from `$images.face` by Phase 91. The overlay's `image` field would need to be
hardcoded by the author, which is their intent for generic art (e.g., a card-back).

**To fully satisfy PRESENT-02:** When an element has `__hidden: true`, skip overlay `image`
and `stats` application (only layout-neutral `render` is safe). Apply this guard in
`resolvePresentation` or in the renderer before using the entry.

---

## Playability Gate — What Each Game Needs

### Shared requirement: App.vue update

All three game `App.vue` files currently use split-screen (Custom UI + AutoUI). For the playability
gate, the `#game-board` slot body must be ONLY `<AutoUI>`. The Phase 96 migration is the permanent
version; this is the gate-proving change (temporary or permanent — Claude's Discretion).

### Hex (simplest)
- **Renderer path:** `GridBoardTemplate` (hex-grid layout, `$layout === 'hex-grid'`)
  OR `HexBoardRenderer` via the renderer registry — needs checking which archetype Phase 93 wired
  for hex topology.
- **Interaction:** `placeStone` → `chooseElement('cell', { boardRef })`. After D-01, this becomes
  `refs: [{ ref: { id, notation }, role: 'highlight' }]`. `HexBoardRenderer` needs click →
  `triggerElementSelect(cell)`.
- **Presentation overlay:** Minimal — stones use player color (already from `.player.color`).
  Optional: stone image per player color. Overlay content at Claude's Discretion.
- **Playability blockers:** None beyond D-01 + D-03 interaction wiring.

### Go Fish (cards)
- **Renderer path:** `CardTemplate` archetype (dominant card/hand zones).
- **Interaction:** `ask` action → step 1 `chooseFrom('target', { boardRefs })` highlights opponent
  hand; step 2 `chooseFrom('rank')` has no board anchor (unanchored → stays in panel). Hybrid
  case: rank choice shows in panel while target is board-anchored.
- **Presentation overlay:** Cards render via `$images`/`$type==='card'` already. Overlay may add
  player hand labels or rank labels. Claude's Discretion.
- **Playability blockers:** Hybrid D-03 logic must correctly filter: `target` pick is board-anchored
  (hand zone highlighted), `rank` pick is unanchored (shows in panel). Both picks must work.

### Checkers (grid + multi-ref)
- **Renderer path:** `GridBoardTemplate` archetype (grid-board with `$layout === 'grid'`).
- **Interaction:** `move` → step 1 `chooseElement('piece', { boardRef })` → click piece on board.
  Step 2 `chooseFrom('destination', { boardRefs, filterBy })` → click destination square on board.
  Multi-jump: multiple refs in `refs` array highlight all source+target squares simultaneously.
- **Presentation overlay:** CheckerPiece by player color; King status (optional label). No images
  needed for a playable demo (player color distinguishes pieces).
- **Playability blockers:** D-01 multi-ref must be wired end-to-end. The `filterBy` on destinations
  is already handled by the controller; board interaction just highlights the target squares.

---

## Common Pitfalls

### Pitfall 1: Refs migration misses useDragDropTargets
**What goes wrong:** `useDragDropTargets.ts:105` reads `choice.targetRef` directly. After D-01,
this field no longer exists — drag-drop silently produces no drop targets.
**How to avoid:** Grep for `\.targetRef\b` + `\.sourceRef\b` + `\.ref\b` after migration and verify
all sites are updated. The test in `useDragDropTargets.test.ts` will catch this if it covers drag scenarios.
**Warning signs:** Cards can't be dragged; drop zones don't highlight.

### Pitfall 2: ActionPanel hidden ≠ absent
**What goes wrong:** Using `v-show` instead of `v-if` on the footer — panel takes DOM space, obscures
board content.
**Why it happens:** `v-show` is the "hide" reflex; D-02 explicitly requires `v-if` ("absent, not
merely hidden").
**How to avoid:** Use `v-if` at the `<footer>` level, not on `<ActionPanel>` itself (so the full
footer chrome vanishes, not just the panel within the footer).

### Pitfall 3: Overlay applied to hidden elements exposes visual cues
**What goes wrong:** A card is hidden (`__hidden: true`) but has `className: 'Card'` in gameView.
The overlay has a `byClass.Card.image` entry. The renderer shows the image, visually revealing
"there's something here" — worse, if image URL encodes identity, it leaks.
**How to avoid:** Guard in `resolvePresentation`: if `element.__hidden`, skip `image` and `stats`.
Only `label` for "hidden" and `render` for a custom hidden-placeholder are safe.
**Warning signs:** Opponent's face-down cards show art in auto-UI.

### Pitfall 4: allCurrentChoicesAnchored returns true during no-action state
**What goes wrong:** When no action is in progress (`currentPick === null`), the panel auto-hides
because the computed returns `true` by some default. Player can't start any action.
**How to avoid:** `allCurrentChoicesAnchored` must return `false` when `currentPick === null`
(no action in progress = show panel so player can start one).
**Warning signs:** Board loads, ActionPanel never shows, player can't start actions.

### Pitfall 5: Mixed-anchor ActionPanel shows anchored choices too
**What goes wrong:** D-03 hybrid logic incorrectly shows ALL choices in panel even when some are
board-anchored — duplicating affordances.
**How to avoid:** The `filteredChoices` computed in ActionPanel must filter OUT choices that have
`refs.length > 0`. Apply this ONLY for the 'choice' pick type.
**Warning signs:** Clicking a board square AND seeing the same move appear as a button in the panel.

### Pitfall 6: ElementRenderer passes element without `notation` to matchesRef
**What goes wrong:** `matchesRef` in `useBoardInteraction` checks `element.notation`, but the element
object passed from `GameElement` tree has notation as `element.attributes?.notation` — not at top level.
**Why it happens:** `GameElement` stores all game attributes inside `.attributes`; the board renderers
need to expose `notation` from `attributes.$colCoord`/`attributes.$rowCoord` or element `name` to
the interaction system.
**How to avoid:** When calling `isSelectableElement(element)` or `isHighlighted(element)`, pass an
object that flattens the relevant identity fields: `{ id: el.id, name: el.name, notation: el.notation }`.
Check how `element.notation` surfaces for squares in the Checkers game.

---

## Code Examples

### Refs array in a choice pick (D-01 new author API)

```typescript
// ~/BoardSmithGames/checkers/src/rules/actions.ts — after D-01
// Source: live code pattern, migrated per D-01
boardRefs: (choice: DestinationChoice) => ({
  refs: [
    { ref: { notation: choice.fromNotation }, role: 'source' as const },
    { ref: { notation: choice.toNotation },   role: 'target' as const },
    // Multi-jump: additional captured squares
    ...choice.capturedNotations.map(n => ({ ref: { notation: n }, role: 'highlight' as const })),
  ],
})
```

### allCurrentChoicesAnchored computed (D-02)

```typescript
// src/ui/composables/useActionController.ts — new computed
// Source: derived from existing currentPick + getCurrentChoices() pattern
const allCurrentChoicesAnchored = computed((): boolean => {
  const pick = currentPick.value;
  if (!pick) return false;
  if (pick.type === 'element' || pick.type === 'elements') return true;
  if (pick.type !== 'choice') return false;
  const choices = getCurrentChoices() as ChoiceWithRefs[];
  return choices.length > 0 && choices.every(c => c.refs && c.refs.length > 0);
});
```

### Renderer interaction affordances (D-03)

```vue
<!-- src/ui/components/auto-ui/renderers/GridBoardRenderer.vue (example cell) -->
<!-- Source: derived from useBoardInteraction.ts API, existing pattern -->
<script setup lang="ts">
const boardInteraction = tryUseBoardInteraction();
const isSelectable = computed(() => boardInteraction?.isSelectableElement(elementIdentity.value) ?? false);
const handleClick = () => {
  if (isSelectable.value) boardInteraction?.triggerElementSelect(elementIdentity.value);
};
</script>
<template>
  <div
    :class="{ 'board-cell--selectable': isSelectable, 'board-cell--highlighted': isHighlighted }"
    @click="handleClick"
  >
    <slot />
  </div>
</template>
```

### Presentation overlay (D-04 per-game usage)

```typescript
// ~/BoardSmithGames/checkers/src/ui/presentation.ts (new sibling file)
// Source: D-04 design decision; PresentationOverlay type from this phase
import type { PresentationOverlay } from 'boardsmith/ui';

export const checkersPresentationOverlay: PresentationOverlay = {
  byClass: {
    CheckerPiece: {
      // No image needed — player color distinguishes pieces via .player.color
      label: '', // suppress name display
    },
    Square: {
      label: '', // suppress name; notation is the display
    },
  },
};
```

---

## Runtime State Inventory

Not applicable — this is a frontend-only feature phase. No rename, no data migration.

---

## Open Questions

1. **Does notation surface on GameElement nodes in the renderer tree?**
   - What we know: `matchesRef` checks `element.notation`; `GameElement.notation` is not a standard
     field in the auto-ui type (`id`, `name`, `className`, `attributes`, `children`, `childCount`).
     Notations for board squares come from `element.attributes?.notation` or from coordinated refs.
   - What's unclear: Whether existing Phase 93 renderers expose `.notation` at the top level, or
     whether the interaction calls need to dig into attributes.
   - Recommendation: Grep `element.notation` usage in Phase 93 renderer files before planning
     the interaction wiring tasks. If notation is buried in attributes, create a local helper
     `getElementIdentity(el): { id, name, notation }` used consistently in all renderers.

2. **Does Phase 93's HexBoardRenderer use `HexBoardTemplate` or `GridBoardTemplate`?**
   - What we know: `GridBoardTemplate` filters on `$layout === 'hex-grid'` (it catches both grid
     and hex layouts at the archetype level). But there is a dedicated `HexBoardRenderer.vue`.
   - What's unclear: Whether the hex renderer is dispatched via the registry (per-element) or via
     the archetype template (per-board). The archetype `GridBoardTemplate` handles the grid-board
     level; `HexBoardRenderer` may handle individual cells within it.
   - Recommendation: Read `GridBoardTemplate.vue` and `HexBoardRenderer.vue` in full before
     planning the board-centric interaction task, to understand which component owns the "click
     a hex cell" event.

3. **Does Checkers `DestinationChoice` have `capturedNotations` for multi-jump?**
   - What we know: The current `DestinationChoice` interface has only `pieceId`, `fromNotation`,
     `toNotation`, `isCapture`, `becomesKing` (lines 38-44 of actions.ts).
   - What's unclear: Whether multi-jump intermediate squares are tracked or just implied.
   - Recommendation: If multi-jump intermediate squares are needed in `refs`, extend
     `DestinationChoice` to include `capturedNotations?: string[]` in Checkers `actions.ts`.
     This is a game-side change; the protocol infrastructure (D-01) handles it without needing
     to know about Checkers specifically.

---

## Environment Availability

Step 2.6: No new external tools required. All dependencies are existing monorepo tools.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build/test | ✓ | (monorepo standard) | — |
| Vitest | Unit tests | ✓ | ^2.1.0 | — |
| boardsmith dev server | Playability gate browser test | Must be started per gate | — | None — required |
| convex dev (if used) | Multiplayer sessions | Required if multiplayer gates | — | Use `--ai` single-player mode |

**Missing dependencies with no fallback:** None.

The three games (`hex`, `go-fish`, `checkers`) must each be runnable as `boardsmith dev` for the
playability gate. They are already functional games — the gate is a browser-verify step, not an
install step.

---

## Validation Architecture

> `workflow.nyquist_validation` key absent from `.planning/config.json` → treat as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1 |
| Config file | Root `package.json` `"test": "vitest run"` |
| Quick run command | `npx vitest run src/ui/composables/useBoardInteraction.test.ts src/ui/composables/useDragDropTargets.test.ts` |
| Full suite command | `npm run test` (or `npx vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| INTERACT-03 | `refs` array built correctly by pick-handler for choice picks | unit | `npx vitest run src/session/pick-handler.test.ts` | ❌ Wave 0 |
| INTERACT-03 | `refs` array built for element picks (wrapped single ref) | unit | same file | ❌ Wave 0 |
| INTERACT-03 | `useDragDropTargets` reads target ref from `refs` array | unit | `npx vitest run src/ui/composables/useDragDropTargets.test.ts` | ✅ existing (needs update) |
| INTERACT-02 | `allCurrentChoicesAnchored` false when no action | unit | `npx vitest run src/ui/composables/useActionController.test.ts` | ✅ existing (needs new case) |
| INTERACT-02 | `allCurrentChoicesAnchored` true for element pick | unit | same | ✅ existing (needs new case) |
| INTERACT-02 | `allCurrentChoicesAnchored` false for choice pick with no refs | unit | same | ✅ existing (needs new case) |
| INTERACT-01 | `filteredChoices` excludes anchored choices in ActionPanel | unit | `npx vitest run src/ui/components/auto-ui/ActionPanel.test.ts` | ❌ Wave 0 |
| PRESENT-02 | `resolvePresentation` skips image/stats for `__hidden` elements | unit | `npx vitest run src/ui/components/auto-ui/presentation.test.ts` | ❌ Wave 0 |
| PRESENT-01/03 | Overlay injects into renderer tree and resolves by class/name | unit | same | ❌ Wave 0 |
| Playability gate (Hex) | Full game start-to-finish in browser, auto-UI only | manual | Human verification | manual-only |
| Playability gate (Go Fish) | Full game start-to-finish in browser, auto-UI only | manual | Human verification | manual-only |
| Playability gate (Checkers) | Full game start-to-finish in browser, auto-UI only | manual | Human verification | manual-only |

**Manual-only justification for playability gates:** End-to-end browser automation of a full board
game requires Playwright setup against the live dev server. The project testing rule is "verify
behavior by running the application, not just reviewing code structure" — human verification in the
browser is the stated method for this type of gate (per Phase 92 precedent). A Playwright test
setup is beyond this phase's scope.

### Sampling Rate
- **Per task commit:** `npx vitest run src/ui/composables/ src/session/` (fast, covers interaction substrate)
- **Per wave merge:** `npm run test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work` + human playability checks

### Wave 0 Gaps
- [ ] `src/session/pick-handler.test.ts` — covers INTERACT-03 refs construction (new file)
- [ ] `src/ui/components/auto-ui/ActionPanel.test.ts` — covers D-03 filtered choices (new file)
- [ ] `src/ui/components/auto-ui/presentation.test.ts` — covers PRESENT-01/02/03 resolver (new file)
- [ ] `src/ui/composables/useActionController.test.ts` — add 3 cases for `allCurrentChoicesAnchored`
- [ ] `src/ui/composables/useDragDropTargets.test.ts` — update existing drag tests for `refs` shape

---

## Security Domain

> `security_enforcement` absent from config → treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | partial | Overlay applied only to already-filtered `gameView` (Phase 91 `toJSONForPlayer`) |
| V5 Input Validation | no | Overlay is author-provided static metadata, not user input |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Overlay entry for hidden-element class exposes art | Information Disclosure | Guard in `resolvePresentation`: if `element.__hidden`, skip `image` and `stats` fields |
| Game author puts game state (card values) in `PresentationEntry.stats` for a hidden card class | Information Disclosure | Stat blocks must be static/declarative (not derived from game state at resolve time). Resolver never has access to hidden attribute values — they're already stripped. |
| `refs` array carries element IDs that weren't in `validElements` | Tampering | `triggerElementSelect` validates against `validElements` before calling `onElementSelect` (existing guard in `useBoardInteraction.ts:287-290`) |

**Phase 91 link (PRESENT-02 guarantee):**
`game.ts:2271, 2306, 2326` — all three hidden-element branches call `redactHiddenElementAttrs()`,
stripping `$image` and `$images.face`. The UI overlay's `image` field could only expose art if the
game author hardcoded an image URL for a hidden class — which is the same as writing the URL in the
game rules file, an acceptable deliberate author choice (e.g., a card-back URL is fine; it's the
face URL that was the leak). The `resolvePresentation` guard for `__hidden` elements closes the
accidental case.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `allCurrentChoicesAnchored` can safely be added to `UseActionControllerReturn` without breaking existing consumers | D-02 insertion map | Low — new property, no existing consumer expects it to be absent |
| A2 | Checkers does not currently express multi-jump intermediate squares in `DestinationChoice` | Open Questions #3 | Low — worst case adds a field to `DestinationChoice`; D-01 protocol change handles it |
| A3 | `element.notation` is NOT a top-level field on `GameElement` in renderer context; notation is in attributes | Common Pitfalls #6 | Medium — if notation IS at top level (set by Phase 93 renderers), Pitfall 6 is a non-issue |
| A4 | Phase 93 dispatches hex cells through `HexBoardRenderer` as per-element renderer, not as a monolithic archetype | Open Questions #2 | Medium — affects which file owns the "click a hex cell" handler; doesn't block D-03 conceptually |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Singular `sourceRef`/`targetRef` on choices | `refs: { ref, role }[]` array | This phase (D-01) | Multi-jump Checkers, area effects, any multi-element action now expressible |
| ActionPanel mounted unconditionally | Auto-absent when all choices anchored | This phase (D-02) | Board games get board-only UI by default; footer no longer wastes space |
| AutoUI as passive "render then click a button" | Board-centric interaction wired into renderers | This phase (D-03) | Clicking the board IS the action, not clicking a footer button |
| No presentation overlay | Per-UI `PresentationOverlay` prop | This phase (D-04) | Game UI author adds visual polish without touching engine; security preserved |

**Deprecated/outdated after this phase:**
- `ChoiceWithRefs.sourceRef` / `ChoiceWithRefs.targetRef` (singular) — deleted, not deprecated
- `ValidElement.ref` (singular) — deleted, not deprecated
- `ChoiceBoardRefs = { sourceRef?, targetRef? }` type — deleted, replaced with `{ refs: RefWithRole[] }`

---

## Sources

### Primary (HIGH confidence — verified against live code on disk)

- `src/types/protocol.ts` — full file read; confirmed `ChoiceWithRefs.sourceRef/targetRef` and `ValidElement.ref` at lines 460-481
- `src/session/pick-handler.ts:228-240, 379-391` — confirmed singular ref construction from `boardRefs()`/`boardRef()` callbacks
- `src/session/types.ts:230-252` — confirmed server-side mirror of protocol types
- `src/engine/action/types.ts:58-70` — confirmed `ChoiceBoardRefs = { sourceRef?, targetRef? }` and `BoardElementRef` definitions
- `src/ui/composables/useBoardInteraction.ts` — full file read; confirmed `HighlightableChoice.sourceRefs/targetRefs` (plural arrays) and `matchesRef` precedence logic
- `src/ui/composables/useActionControllerTypes.ts:24-45` — confirmed UI-side mirror of protocol types
- `src/ui/composables/useDragDropTargets.ts:63, 86-87, 105` — confirmed singular `choice.targetRef` read for drag targets
- `src/ui/components/GameShell.vue:1279-1301` — confirmed unconditional `<ActionPanel>` in footer
- `src/ui/components/auto-ui/ActionPanel.vue:355-360, 589-597, 856-873, 989-990, 1048-1052` — confirmed all 9 sites reading singular refs
- `src/ui/components/auto-ui/AutoRenderer.vue` — full file read; confirmed Phase 93 structure, no `presentation` prop
- `src/ui/components/auto-ui/AutoUI.vue` — full file read; confirmed no `presentation` prop
- `src/ui/components/auto-ui/renderer-registry.ts` — full file read; confirmed registry API
- `src/ui/components/auto-ui/renderers/ElementRenderer.vue` — confirmed dispatch-only; no interaction
- `~/BoardSmithGames/checkers/src/rules/actions.ts:105-155` — confirmed current `boardRef`/`boardRefs` usage (singular)
- `~/BoardSmithGames/go-fish/src/rules/actions.ts:38-46` — confirmed singular `targetRef` in `boardRefs`
- `~/BoardSmithGames/hex/src/rules/actions.ts:22-27` — confirmed `boardRef` on element selection
- `src/engine/element/game.ts` (via Phase 91 VERIFICATION.md) — `toJSONForPlayer` branches at lines 2271, 2306, 2326 all call `redactHiddenElementAttrs`; `SAFE_LAYOUT_KEYS` whitelist at line 239
- `.planning/phases/91-security-leak-fix/91-VERIFICATION.md` — full read; confirmed SEC-01/02 satisfied

### Secondary (MEDIUM confidence)
- `docs/auto-ui-redesign-research.md` §0 C1, C7, §5 S6 — design decisions authoritative but written before Phase 93 execution
- `.planning/phases/93-renderer-rebuild/93-CONTEXT.md` — Phase 93 decisions (renderer structure, animation already wired)

---

## Metadata

**Confidence breakdown:**
- D-01 migration map: HIGH — every source file and line range verified on disk
- D-02 insertion point: HIGH — `GameShell.vue:1279-1295` confirmed; `allCurrentChoicesAnchored` logic is new but follows existing `computed` patterns in the controller
- D-03 renderer wiring: HIGH — `tryUseBoardInteraction()` API is verified; renderer files confirmed to lack interaction; pattern is identical to custom UIs
- D-04 overlay: HIGH — no existing infrastructure; new types and provide/inject chain; PRESENT-02 security analysis verified against Phase 91 code
- Playability gates: MEDIUM — games exist and render; full playthrough depends on D-01+D-02+D-03 all working together

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (stable codebase; 30-day horizon appropriate)
