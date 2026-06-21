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

import { computed, inject, type ComputedRef } from 'vue';
import { resolvePieceVisual, type PieceVisual } from '../auto-ui-helpers.js';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
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

// ── Click handler — dispatch board action on selectable pieces (CF-1) ─────────
function handleClick() {
  if (!boardInteraction || !isActionSelectable.value) return;
  if (isDisabled.value) return;
  boardInteraction.triggerElementSelect(elementIdentity());
}

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
    @click="handleClick"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
  >
    <!-- Overlay render override: full component replacement (D-04) -->
    <component
      v-if="presentationEntry?.render"
      :is="presentationEntry.render"
      :element="element"
    />

    <!-- Overlay image override for visible pieces (D-04) -->
    <img
      v-else-if="presentationEntry?.image"
      class="piece-image"
      :src="presentationEntry.image"
      alt=""
      aria-hidden="true"
    />

    <!-- Branch 1: engine image URL -->
    <img
      v-else-if="pieceVisual.kind === 'image'"
      class="piece-image"
      :src="pieceVisual.src"
      alt=""
      aria-hidden="true"
    />

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

    <!-- Branch 3: labeled token (player color or neutral #888) -->
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
  color: #fff;
  font-weight: bold;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s ease;
  cursor: default;
}

/* Carry-forward #1: piece hover affordance for non-hex pieces */
.piece:hover {
  transform: scale(1.05);
}

/* ── Board interaction states (CF-1: pieces get same six states as all other renderers) ── */
.piece.action-selectable {
  cursor: pointer;
  outline: 2px solid rgba(46, 204, 113, 0.6);
  outline-offset: 2px;
  animation: pulse-piece 2s ease-in-out infinite;
}

.piece.action-selectable:hover {
  outline-color: rgba(46, 204, 113, 1);
  outline-width: 3px;
  transform: scale(1.1);
}

@keyframes pulse-piece {
  0%, 100% { outline-color: rgba(46, 204, 113, 0.6); }
  50% { outline-color: rgba(46, 204, 113, 1); }
}

.piece.is-board-highlighted {
  box-shadow: 0 0 0 3px rgba(0, 217, 255, 0.8), 0 2px 8px rgba(0, 0, 0, 0.3);
  background: rgba(0, 217, 255, 0.15);
}

.piece.is-board-selected {
  box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.8), 0 2px 8px rgba(0, 0, 0, 0.3);
  background: rgba(0, 255, 136, 0.15);
}

.piece.is-disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.piece.is-disabled:hover {
  transform: none;
}

.piece.is-draggable {
  cursor: grab;
}

.piece.is-dragging {
  opacity: 0.5;
  transform: scale(0.95);
}

/* ── Image branch ── */
.piece-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  display: block;
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
  color: #ffffff;
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
