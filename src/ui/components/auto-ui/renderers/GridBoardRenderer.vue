<script setup lang="ts">
/**
 * GridBoardRenderer — CSS-grid board renderer for $layout='grid' elements.
 *
 * Delegates all grid sizing to resolveGridSize(). Never falls back to 8×8.
 * When coordinates are missing/undeclared, renders the locked error panel.
 * Provides gridCoords to child cells so they can position via grid-row/grid-column.
 */

import { computed, provide, watchEffect, ref, inject, type ComputedRef } from 'vue';
import { resolveGridSize } from '../auto-ui-helpers.js';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
import ElementRenderer from './ElementRenderer.vue';
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
}>();

// Board interaction for cell states
const boardInteraction = tryUseBoardInteraction();

// Delegate all grid sizing to the Phase 92 helper — DO NOT re-implement
const gridResult = computed(() => resolveGridSize(props.element));

// One-shot console.error when grid cannot resolve
const _lastGridError = ref<string | null>(null);
watchEffect(() => {
  const result = gridResult.value;
  if (!result.ok && result.error !== _lastGridError.value) {
    console.error(`[BoardSmith] ${result.error}`);
    _lastGridError.value = result.error;
  }
});

// Provide coordinate names to child cells (inherited from parent grid provide pattern)
// Children use these to set grid-row / grid-column from their own coordinate attributes
const rowCoord = props.element.attributes?.$rowCoord as string | undefined;
const colCoord = props.element.attributes?.$colCoord as string | undefined;
if (rowCoord && colCoord) {
  provide('gridCoords', { rowCoord, colCoord });
}

// Dynamic grid-template-columns from resolveGridSize — no hardcoded fallback
const gridStyle = computed(() => {
  if (!gridResult.value.ok) return {};
  return { 'grid-template-columns': `repeat(${gridResult.value.cols}, 1fr)` };
});

// Column labels from game designer or auto-generated indices
const columnLabels = computed(() => {
  if (!gridResult.value.ok) return [];
  const declared = props.element.attributes?.$columnLabels as string[] | undefined;
  return declared ?? Array.from({ length: gridResult.value.cols }, (_, i) => String(i));
});

// Row labels from game designer or auto-generated indices
const rowLabels = computed(() => {
  if (!gridResult.value.ok) return [];
  const declared = props.element.attributes?.$rowLabels as string[] | undefined;
  return declared ?? Array.from({ length: gridResult.value.rows }, (_, i) => String(i));
});

// Presentation overlay injection (D-04)
// GridBoardRenderer is a container — overlay affects the board header label.
// Individual cells are rendered via ElementRenderer → their renderer handles their own overlay.
const overlay = inject<ComputedRef<PresentationOverlay | undefined>>('presentation');
const presentationEntry = computed(() =>
  resolvePresentation(props.element, overlay?.value)
);

// Display label for board header — overlay label wins, then engine fallback
const displayLabel = computed(
  () => presentationEntry.value?.label ?? props.element.name ?? props.element.className
);

// All children passed to ElementRenderer for rendering
const children = computed(() => props.element.children ?? []);

// Element identity helper — passes notation from attributes (Pitfall 6: notation is not a top-level
// field on GameElement in renderer context; it lives in attributes for notation-keyed elements
// like Checkers squares). Routing all interaction calls through this helper ensures matchesRef
// can match by notation when a boardRef specifies { notation: 'e5' }.
function cellIdentity(cell: GameElement) {
  return {
    id: cell.id,
    name: cell.name,
    notation: cell.attributes?.notation as string | undefined,
  };
}

// Per-cell board interaction states — all six required states (UI-SPEC Interaction Affordance Contract)
function isCellHighlighted(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted(cellIdentity(cell));
}

function isCellSelected(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected(cellIdentity(cell));
}

function isCellActionSelectable(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  if (isCellSelected(cell)) return false;
  return boardInteraction.isSelectableElement(cellIdentity(cell));
}

function isCellDropTarget(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isDropTarget(cellIdentity(cell));
}

function isCellDisabled(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isDisabledElement(cellIdentity(cell)) !== false;
}

function handleCellClick(cell: GameElement) {
  if (!boardInteraction) return;
  if (isCellDisabled(cell)) return;
  if (boardInteraction.isSelectableElement(cellIdentity(cell))) {
    boardInteraction.triggerElementSelect(cellIdentity(cell));
  } else if (cell.name) {
    boardInteraction.selectElement(cellIdentity(cell));
  }
}

function handleDragOver(event: DragEvent, cell: GameElement) {
  if (!boardInteraction?.isDragging) return;
  if (!isCellDropTarget(cell)) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'move';
}

function handleDrop(event: DragEvent, cell: GameElement) {
  if (!boardInteraction?.isDragging) return;
  event.preventDefault();
  boardInteraction.triggerDrop(cellIdentity(cell));
}
</script>

<template>
  <!-- Error path: grid coords undeclared/unresolvable — render error verbatim from helper -->
  <div v-if="!gridResult.ok" class="grid-error-panel">
    <span class="grid-error-panel__text">{{ gridResult.error }}</span>
  </div>

  <!-- Happy path: board renders when gridResult resolves successfully -->
  <div v-else class="board-container">
    <div class="board-header">{{ displayLabel }}</div>
    <div class="board-with-labels">
      <!-- Column labels (from game designer or numeric indices) -->
      <div class="board-column-labels">
        <span class="board-label corner"></span>
        <span
          v-for="(label, index) in columnLabels"
          :key="index"
          class="board-label"
        >{{ label }}</span>
      </div>
      <div class="board-row-wrapper">
        <!-- Row labels (from game designer or numeric indices) -->
        <div class="board-row-labels">
          <span
            v-for="(label, index) in rowLabels"
            :key="index"
            class="board-label"
          >{{ label }}</span>
        </div>
        <!-- CSS grid — template-columns set dynamically from resolveGridSize result -->
        <div class="board-grid" :style="gridStyle">
          <div
            v-for="cell in children"
            :key="cell.id"
            class="grid-cell"
            :class="{
              'has-children': (cell.children?.length ?? 0) > 0,
              'is-clickable': (cell.children?.length ?? 0) > 0,
              'action-selectable': isCellActionSelectable(cell),
              'is-board-highlighted': isCellHighlighted(cell),
              'is-board-selected': isCellSelected(cell),
              'is-drop-target': isCellDropTarget(cell),
              'is-disabled': isCellDisabled(cell),
            }"
            :title="cell.name ?? undefined"
            @click.stop="handleCellClick(cell)"
            @dragover="handleDragOver($event, cell)"
            @drop="handleDrop($event, cell)"
          >
            <!-- Coordinate notation label (shown on hover) -->
            <span v-if="cell.name" class="cell-notation">{{ cell.name }}</span>
            <!-- Children dispatched through registry -->
            <ElementRenderer
              v-for="child in (cell.children ?? [])"
              :key="child.id"
              :element="child"
              :depth="depth + 2"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Board container ── */
.board-container {
  background: var(--bsg-surface);
  border-radius: 12px;
  padding: 16px;
}

.board-header {
  font-weight: bold;
  margin-bottom: 12px;
  color: var(--bsg-ink);
}

.board-with-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Row/column labels ── */
.board-column-labels {
  display: flex;
  gap: 2px;
}

.board-label {
  width: 50px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--bsg-ink-3);
  font-weight: bold;
  text-transform: uppercase;
}

.board-label.corner {
  width: 20px;
}

.board-row-wrapper {
  display: flex;
  gap: 4px;
}

.board-row-labels {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.board-row-labels .board-label {
  width: 20px;
  height: 50px;
}

/* ── Grid — template-columns injected inline from resolveGridSize ── */
.board-grid {
  display: grid;
  gap: 2px;
  /* grid-template-columns set dynamically via :style binding */
}

/* ── Grid cell ── */
.grid-cell {
  width: 50px;
  height: 50px;
  background: var(--bsg-cell);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all 0.15s ease;
}

.grid-cell.is-clickable {
  cursor: pointer;
}

.grid-cell.is-clickable:hover {
  background: var(--bsg-selectable);
}

/* Cell states */
.grid-cell.action-selectable {
  outline: 2px dashed var(--bsg-accent);
  outline-offset: -2px;
  background: var(--bsg-selectable);
}

.grid-cell.is-board-highlighted {
  background: var(--bsg-selectable);
}

.grid-cell.is-board-selected {
  outline: 2px solid var(--bsg-accent);
  outline-offset: -2px;
  background: var(--bsg-selected);
  box-shadow: var(--bsg-ring);
  transform: scale(1.04);
}

.grid-cell.is-drop-target {
  background: var(--bsg-droptarget);
  outline: 2px dotted var(--bsg-accent-2);
  outline-offset: -2px;
  animation: pulse-drop-target 1s ease-in-out infinite;
}

.grid-cell.is-drop-target:hover {
  background: var(--bsg-droptarget-hover);
}

@keyframes pulse-drop-target {
  0%, 100% { background: var(--bsg-droptarget); }
  50% { background: var(--bsg-droptarget-hover); }
}

/* ── Coordinate notation corner label ── */
.cell-notation {
  position: absolute;
  bottom: 2px;
  right: 2px;
  font-size: 10px;
  color: var(--bsg-ink-3);
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.grid-cell:hover .cell-notation {
  opacity: 1;
}

/* ── Disabled state (UI-SPEC: opacity 0.35, cursor not-allowed, no hover effect) ── */
.grid-cell.is-disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.grid-cell.is-disabled:hover {
  background: var(--bsg-cell);
}

/* ── Error panel ── */
.grid-error-panel {
  background: color-mix(in srgb, var(--bsg-danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-danger) 40%, transparent);
  border-radius: 8px;
  padding: 16px;
}

.grid-error-panel__text {
  color: var(--bsg-danger);
  font-size: 14px;
  font-weight: 700;
}
</style>
