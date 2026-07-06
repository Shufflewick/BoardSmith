<script setup lang="ts">
/**
 * PieceRenderer — Piece visual renderer for leaf elements.
 *
 * Delegates all visual dispatch to resolvePieceVisual() (Phase 92 helper).
 * Three render branches: image / sprite / labeled token.
 *
 * Carry-forward requirements (Phase 92 review):
 *   #1: .piece:hover { transform: scale(1.05) } — MUST be present for affordance.
 *   #2: Single shadow on outermost .piece only — no stacking on inner elements.
 */

import { computed, inject, ref, watch, type ComputedRef } from 'vue';
import { resolvePieceVisual, type PieceVisual } from '../auto-ui-helpers.js';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
import { useSelectable } from '../../../composables/useSelectable.js';
import { setTransformAwareDragImage } from '../../../composables/dragImage.js';
import { resolvePresentation } from '../presentation.js';
import type { PresentationOverlay } from '../presentation.js';

// ---------------------------------------------------------------------------
// Local GameElement interface — do NOT import from engine (module is dependency-free)
// Mirrors auto-ui-helpers.ts lines 12-19.
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
}

const props = defineProps<{
  element: GameElement;
  depth: number;
  hexPieceSize?: number;
}>();

// Board interaction for selectable/dragging state
const boardInteraction = tryUseBoardInteraction();

// ── Core: delegate all visual logic to Phase 92 helper ───────────────────────
const pieceVisual = computed((): PieceVisual => resolvePieceVisual(props.element));

// ── Presentation overlay injection (D-04) ────────────────────────────────────
// Resolved AFTER visibility filtering; resolvePresentation strips image/stats
// for __hidden elements (PRESENT-02). Pieces don't have __hidden but guard is
// still routed through resolver for correctness.
const overlay = inject<ComputedRef<PresentationOverlay | undefined>>('presentation');
const presentationEntry = computed(() =>
  resolvePresentation(props.element, overlay?.value)
);

// Element identity helper — passes notation from attributes (Pitfall 6).
// Piece elements may use a notation attribute for board-ref matching.
function elementIdentity() {
  return {
    id: props.element.id,
    name: props.element.name,
    notation: props.element.attributes?.notation as string | undefined,
  };
}

// ── Board interaction states (all six required — CF-1: piece MUST get action-selectable) ──
const isBoardSelected = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected(elementIdentity());
});

const isActionSelectable = computed(() => {
  if (!boardInteraction) return false;
  if (isBoardSelected.value) return false;
  return boardInteraction.isSelectableElement(elementIdentity());
});

const isHighlighted = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted(elementIdentity());
});

const isDisabled = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDisabledElement(elementIdentity()) !== false;
});

const isDragged = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDraggedElement(elementIdentity());
});

// aria-label: piece name/notation + current interaction state
const ariaLabel = computed(() => {
  const notation = props.element.attributes?.notation as string | undefined;
  const name = notation || props.element.name || props.element.className;
  if (isDisabled.value) return `${name}, unavailable`;
  if (isBoardSelected.value) return `${name}, selected`;
  if (isActionSelectable.value) return `${name}, selectable`;
  return name;
});

// ── Keyboard + click wiring — single composable is the ONLY activation point ──
const { attrs: selectableAttrs, onActivate, onKeydown } =
  useSelectable(elementIdentity, boardInteraction, isActionSelectable, isDisabled, 'piece');

// ── Drag-and-drop handlers ────────────────────────────────────────────────────
function handleDragStart(event: DragEvent) {
  if (!boardInteraction || !isActionSelectable.value) {
    event.preventDefault();
    return;
  }
  setTransformAwareDragImage(event, event.currentTarget as HTMLElement);
  event.dataTransfer?.setData('boardsmith/element', JSON.stringify({
    id: props.element.id,
    name: props.element.name,
  }));
  event.dataTransfer!.effectAllowed = 'move';
  boardInteraction.startDrag(elementIdentity());
}

function handleDragEnd() {
  if (boardInteraction?.isDragging) {
    boardInteraction.endDrag();
  }
}

// ---------------------------------------------------------------------------
// Load-guarded image reveal — DEF-A guard.
// presentationEntry.image (overlay override, D-04) wins over the engine's own
// pieceVisual image; both were the same unguarded <img> shape, so they share
// one effective-src computed and one load-guard.
// ---------------------------------------------------------------------------
const effectivePieceImage = computed((): string | null => {
  if (presentationEntry.value?.image) return presentationEntry.value.image;
  if (pieceVisual.value.kind === 'image') return pieceVisual.value.src;
  return null;
});

// Drawn piece-token fallback data, available even when pieceVisual itself
// isn't 'token' kind (e.g. an overlay image override on a sprite/image piece).
const pieceFallbackLabel = computed(() => {
  if (presentationEntry.value?.label) return presentationEntry.value.label;
  if (pieceVisual.value.kind === 'token') return pieceVisual.value.label;
  return (props.element.attributes?.notation as string | undefined) ?? props.element.name ?? props.element.className;
});

const pieceFallbackColor = computed(() => {
  if (pieceVisual.value.kind === 'token') return pieceVisual.value.color;
  return 'var(--bsg-ink-3)';
});

// Reset the reveal when the resolved src changes so a piece reused for a
// different asset re-guards (mirrors CardRenderer's src-watch).
const loaded = ref(false);
watch(effectivePieceImage, () => {
  loaded.value = false;
});
</script>

<template>
  <!--
    .piece: outermost element. Hover carries scale(1.05) (carry-forward #1).
    Shadow is on .piece ONLY — never on inner elements (carry-forward #2).
  -->
  <div
    :class="[
      'piece',
      {
        'action-selectable': isActionSelectable,
        'is-board-highlighted': isHighlighted,
        'is-board-selected': isBoardSelected,
        'is-disabled': isDisabled,
        'is-draggable': isActionSelectable,
        'is-dragging': isDragged,
      },
    ]"
    :data-element-id="element.id"
    :data-animatable="true"
    :draggable="isActionSelectable"
    v-bind="selectableAttrs"
    :aria-label="ariaLabel"
    :aria-pressed="isBoardSelected || undefined"
    @click="onActivate"
    @keydown="onKeydown"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
  >
    <!-- Overlay render override: full component replacement (D-04) -->
    <component
      v-if="presentationEntry?.render"
      :is="presentationEntry.render"
      :element="element"
    />

    <!-- Branch 1: image (overlay override or engine pieceVisual image, D-04).
         Zero-layout-diff (DEF-A guard): the drawn .piece-token fallback is
         always rendered underneath at the fixed piece box; the <img> overlays
         it absolutely and is revealed only on @load, reverting to the token
         fallback on @error. Neither element leaves flow, so toggling `loaded`
         never resizes the slot. -->
    <div v-else-if="effectivePieceImage" class="piece-image-container">
      <div class="piece-token" :style="{ background: pieceFallbackColor }">
        <span class="piece-token-label">{{ pieceFallbackLabel }}</span>
      </div>
      <img
        class="piece-image piece-image-overlay"
        :class="{ 'is-loaded': loaded }"
        :src="effectivePieceImage"
        alt=""
        aria-hidden="true"
        @load="loaded = true"
        @error="loaded = false"
      />
    </div>

    <!-- Branch 2: sprite sheet -->
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

    <!-- Branch 3: labeled token (player color or neutral ink) -->
    <!-- Token: no shadow — shadow lives on .piece only (carry-forward #2) -->
    <div
      v-else
      class="piece-token"
      :style="{ background: pieceVisual.color }"
    >
      <!-- Overlay label overrides engine label (D-04) -->
      <span class="piece-token-label">{{ presentationEntry?.label ?? pieceVisual.label }}</span>
    </div>
  </div>
</template>

<style scoped>
/*
 * .piece: outermost element.
 *
 * Carry-forward #1: .piece:hover { transform: scale(1.05) } — required affordance.
 * Carry-forward #2: single shadow here — never on inner .piece-token or image element.
 */
.piece {
  width: 40px;
  height: 40px;
  background: transparent;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  color: var(--bsg-ink);
  font-weight: bold;
  box-shadow: var(--bsg-shadow-sm);
  transition: transform var(--bsg-dur-base) var(--bsg-ease);
  cursor: default;
}

/* Carry-forward #1: piece hover affordance for non-hex pieces */
.piece:hover {
  transform: scale(1.05);
}

/* ── Board interaction states (CF-1: pieces get same six states as all other renderers) ── */
/* action-selectable: dashed accent outline + selectable fill; outline never border */
.piece.action-selectable {
  cursor: pointer;
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 2px;
  background: var(--bsg-selectable);
}

.piece.action-selectable:hover {
  outline-style: solid;
  transform: scale(1.1);
}

/* is-board-highlighted: dashed accent + selectable fill */
.piece.is-board-highlighted {
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 2px;
  background: var(--bsg-selectable);
}

/* is-board-selected: solid accent ring + selected fill + accent ring shadow */
.piece.is-board-selected {
  outline: 2px solid var(--bsg-accent);
  outline-offset: 2px;
  background: var(--bsg-selected);
  box-shadow: var(--bsg-ring);
  transform: scale(1.02);
}

/* Disabled state — hatch pattern (A11Y-09: non-color cue, not opacity alone) */
.piece.is-disabled {
  background-image: repeating-linear-gradient(45deg, var(--bsg-cell), var(--bsg-cell) 5px, transparent 5px, transparent 10px);
  opacity: 0.6;
  cursor: not-allowed;
}

.piece.is-disabled:hover {
  transform: none;
}

.piece.is-draggable {
  cursor: grab;
}

.piece.is-dragging {
  opacity: var(--bsg-dragging-opacity);
  transform: scale(var(--bsg-dragging-scale));
}

/* ── Image branch ── */
.piece-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  display: block;
}

/* Image branch load-guard: fixed-size container shared by the drawn token
   fallback and the overlay <img> (DEF-A guard, zero-layout-diff) */
.piece-image-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.piece-image-container .piece-token {
  width: 100%;
  height: 100%;
}

.piece-image-overlay {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--bsg-dur-base) var(--bsg-ease);
}

.piece-image-overlay.is-loaded {
  opacity: 1;
}

/* ── Sprite branch ── */
.piece-sprite {
  width: 100%;
  height: 100%;
  background-repeat: no-repeat;
  border-radius: 50%;
}

/* ── Token branch — no shadow (single shadow lives on .piece only; carry-forward #2) ── */
.piece-token {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.piece-token-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--bsg-ink);
  line-height: 1;
  text-align: center;
  pointer-events: none;
  user-select: none;
  overflow: hidden;
  max-width: 36px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
